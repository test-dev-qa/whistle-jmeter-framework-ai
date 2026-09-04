const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const fs = require('fs');
const path = require('path');
const {
  getRecords,
  getRecordByIdAsync,
  getRecordSummaries,
  clearRecords,
  getRecordsByIds,
  getRecordsByIdsAsync,
  getRecordsAsync,
  deleteRecordsByIds,
  getStorageType,
  getStorageInfo,
  ensureStorageReady,
  applyStorageSettings,
  testMysqlConnection,
  testPostgresConnection,
  onConnectionDeleted
} = require('../lib/dataStore');
const { getCaptureConfig, setCaptureConfig } = require('../lib/captureConfig');
const { generateJMX } = require('../lib/jmxGenerator');
const { generateK6Script } = require('../lib/k6Generator');
const { generatePostmanCollection } = require('../lib/postmanGenerator');
const { generateCSV } = require('../lib/csvGenerator');
const stressTest = require('../lib/stressTest');
const stressReportStore = require('../lib/stressReportStore');
const stressThresholds = require('../lib/stressThresholds');
const generalNotify = require('../lib/generalNotify');
const projectSettings = require('../lib/projectSettings');
const stressBaseline = require('../lib/stressBaseline');
const { buildStressReportPdf } = require('../lib/pdfReport');
const { correlateTokens } = require('../lib/tokenCorrelate');
const {
  listForRecord,
  setForRecord,
  resolveItemValue,
  normalizeItem,
  buildPreviewRecord,
  getExtractorsForRecords
} = require('../lib/extractVars');
const {
  listForRecord: listAssertions,
  setForRecord: setAssertions,
  evaluateAssertion,
  normalizeItem: normalizeAssertion
} = require('../lib/assertions');
const {
  listPublicConnections,
  upsertConnection,
  persistRemote,
  deleteConnection,
  publicConnection,
  testConnection,
  getConnection,
  TYPES: DB_TYPES
} = require('../lib/dbConnections');
const {
  listForRecord: listDbOps,
  setForRecord: setDbOps,
  listConnectionDatabases,
  executeSql
} = require('../lib/dbOps');
const { extractJsonPath } = require('../lib/jsonPath');
const postOpStore = require('../lib/postOpStore');
const { setLastError, getLastError, clearLastError } = require('../lib/pluginStatus');
const {
  DEFAULT_RULES,
  loadRules,
  saveRules,
  resetRules,
  syncPluginRulesFile,
  applyStoredRules
} = require('../lib/pluginRules');
const { markdownToHtml, wrapReadmePage, wrapSharePage } = require('../lib/markdown');
const shareDocs = require('../lib/shareDocs');
const { PLUGIN_WEB_ROOT } = require('../lib/pluginPaths');
const websocketFrames = require('../lib/websocketFrameCapture');

const app = new Koa();
const router = new Router();
const HTML_PATH = path.join(__dirname, 'index.html');
const README_PATH = path.join(__dirname, '..', 'README.md');

let updateRulesFn = null;

function notifyWhistleReloadRules() {
  if (typeof updateRulesFn === 'function') {
    try {
      updateRulesFn();
    } catch (e) {
      // ignore
    }
  }
}

let htmlCache = '';
let htmlMtime = 0;
let readmeCache = '';
let readmeHtml = '';
let readmeMtime = 0;

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error('[jmeter-exporter] ui error:', err && err.message ? err.message : err);
    setLastError('ui', err);
    if (ctx.headerSent) return;
    ctx.status = err.status || 500;
    ctx.body = { code: -1, msg: 'Internal error' };
  }
});
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/api/share/sync/import/binary') {
    const chunks = [];
    await new Promise((resolve, reject) => {
      ctx.req.on('data', (chunk) => chunks.push(chunk));
      ctx.req.on('end', resolve);
      ctx.req.on('error', reject);
    });
    ctx.request.rawBody = Buffer.concat(chunks);
    ctx.state.skipBodyParser = true;
  }
  await next();
});
app.use(async (ctx, next) => {
  if (ctx.state.skipBodyParser) return next();
  return bodyParser({ enableTypes: ['json'], jsonLimit: '48mb' })(ctx, next);
});
app.on('error', (err) => {
  setLastError('ui', err);
  console.error('[jmeter-exporter] ui error:', err && err.message ? err.message : err);
});

async function readPluginHtml() {
  try {
    const stat = await fs.promises.stat(HTML_PATH);
    if (htmlCache && stat.mtimeMs === htmlMtime) return htmlCache;
    htmlCache = await fs.promises.readFile(HTML_PATH, 'utf8');
    htmlMtime = stat.mtimeMs;
    return htmlCache;
  } catch (err) {
    htmlCache = '';
    htmlMtime = 0;
    throw err;
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

async function resolveRecords(body) {
  const ids = body && body.ids;
  if (Array.isArray(ids) && ids.length > 0) {
    return getRecordsByIdsAsync(ids);
  }
  return getRecordsAsync();
}

function resolveExportOptions(body) {
  const src = body || {};
  return {
    threads: clampInt(src.threads, 1, 1, 1000),
    loops: clampInt(src.loops, 1, 1, 10000),
    rampTime: clampInt(src.rampTime, 1, 0, 3600),
    correlateToken: src.correlateToken !== false,
    correlateEdits: src.correlateEdits && typeof src.correlateEdits === 'object'
      ? src.correlateEdits
      : undefined
  };
}

function sendExportError(ctx, error, fallbackMsg) {
  const detail = (error && error.message) || fallbackMsg;
  ctx.status = /no records|no valid/i.test(detail) ? 400 : 500;
  ctx.body = { code: -1, msg: fallbackMsg, error: detail };
}

async function attachMysqlFlush(data) {
  try {
    const remote = await postOpStore.flushMysql();
    return Object.assign({}, data, {
      mysql: Boolean(remote && remote.mysql),
      mysqlDatabase: (remote && remote.mysqlDatabase) || '',
      mysqlError: (remote && remote.mysqlError) || '',
      mysqlSkipped: Boolean(remote && remote.skipped)
    });
  } catch (e) {
    return Object.assign({}, data, {
      mysql: false,
      mysqlDatabase: '',
      mysqlError: e && e.message ? e.message : '写入 MySQL 失败'
    });
  }
}

async function readReadmePage() {
  const stat = await fs.promises.stat(README_PATH);
  if (readmeHtml && stat.mtimeMs === readmeMtime) return readmeHtml;
  readmeCache = await fs.promises.readFile(README_PATH, 'utf8');
  readmeMtime = stat.mtimeMs;
  readmeHtml = wrapReadmePage(markdownToHtml(readmeCache), '帮助文档 · whistle.jmeter-exporter');
  return readmeHtml;
}

async function sendReadmePage(ctx) {
  try {
    ctx.type = 'html';
    ctx.body = await readReadmePage();
  } catch (err) {
    ctx.status = 404;
    ctx.body = 'README.md not found';
  }
}

async function sendPluginHtml(ctx) {
  try {
    let html = await readPluginHtml();
    // 避免在 /share/ 等子路径下 ./xxx.js 404
    html = html.replace(/src="\.\/([^"]+)"/g, 'src="' + PLUGIN_WEB_ROOT + '$1"');
    html = html.replace(/__PLUGIN_WEB_ROOT__/g, PLUGIN_WEB_ROOT);
    ctx.type = 'html';
    ctx.body = html;
  } catch (err) {
    ctx.status = 500;
    ctx.body = 'Internal Server Error loading UI';
  }
}

router.get('/', sendPluginHtml);
router.get('/index.html', sendPluginHtml);
router.get('/readme', sendReadmePage);
router.get('/readme.html', sendReadmePage);

router.get('/bootstrap-ui.js', (ctx) => {
  ctx.type = 'application/javascript; charset=utf-8';
  ctx.body = fs.readFileSync(path.join(__dirname, 'bootstrap-ui.js'), 'utf8');
});

router.get('/records-core-ui.js', (ctx) => {
  ctx.type = 'application/javascript; charset=utf-8';
  ctx.body = fs.readFileSync(path.join(__dirname, 'records-core-ui.js'), 'utf8');
});

router.get('/postops-ui.js', (ctx) => {
  ctx.type = 'application/javascript; charset=utf-8';
  ctx.body = fs.readFileSync(path.join(__dirname, 'postops-ui.js'), 'utf8');
});

router.get('/rules-correlate-ui.js', (ctx) => {
  ctx.type = 'application/javascript; charset=utf-8';
  ctx.body = fs.readFileSync(path.join(__dirname, 'rules-correlate-ui.js'), 'utf8');
});

router.get('/general-settings-ui.js', (ctx) => {
  ctx.type = 'application/javascript; charset=utf-8';
  ctx.body = fs.readFileSync(path.join(__dirname, 'general-settings-ui.js'), 'utf8');
});

router.get('/websocket-ui.js', (ctx) => {
  ctx.type = 'application/javascript; charset=utf-8';
  ctx.body = fs.readFileSync(path.join(__dirname, 'websocket-ui.js'), 'utf8');
});

router.get('/stress-ui.js', (ctx) => {
  ctx.type = 'application/javascript; charset=utf-8';
  ctx.body = fs.readFileSync(path.join(__dirname, 'stress-ui.js'), 'utf8');
});

router.get('/share-ui.js', (ctx) => {
  ctx.type = 'application/javascript; charset=utf-8';
  ctx.body = fs.readFileSync(path.join(__dirname, 'share-ui.js'), 'utf8');
});

router.get('/share', (ctx) => {
  ctx.redirect('../');
});
router.get('/share/', (ctx) => {
  ctx.redirect('../');
});

router.get('/share/:slug', (ctx) => {
  const doc = shareDocs.getDocBySlug(ctx.params.slug, true);
  if (!doc) {
    ctx.status = 404;
    ctx.type = 'html';
    ctx.body = wrapSharePage('<p>分享不存在或已删除。</p>', '分享文档');
    return;
  }
  ctx.type = 'html';
  ctx.body = shareDocs.renderDocHtml(doc);
});

router.get('/api/share/overview', (ctx) => {
  ctx.body = {
    code: 0,
    data: {
      stations: shareDocs.listStations(),
      docs: shareDocs.listDocs({ q: ctx.query.q || '' }),
      formats: shareDocs.FORMATS
    }
  };
});

router.get('/api/share/stations', (ctx) => {
  ctx.body = { code: 0, data: shareDocs.listStations() };
});

router.post('/api/share/stations', (ctx) => {
  try {
    const data = shareDocs.createStation(ctx.request.body || {});
    ctx.body = { code: 0, data, msg: '文档站已创建' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '创建失败' };
  }
});

router.post('/api/share/stations/:id', (ctx) => {
  try {
    const data = shareDocs.updateStation(ctx.params.id, ctx.request.body || {});
    ctx.body = { code: 0, data, msg: '文档站已更新' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '更新失败' };
  }
});

router.post('/api/share/stations/:id/delete', (ctx) => {
  try {
    const ok = shareDocs.deleteStation(ctx.params.id);
    ctx.body = { code: ok ? 0 : -1, data: { deleted: ok } };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '删除失败' };
  }
});

router.get('/api/share/docs', (ctx) => {
  ctx.body = {
    code: 0,
    data: {
      items: shareDocs.listDocs({
        q: ctx.query.q || '',
        stationId: ctx.query.stationId || ''
      })
    }
  };
});

router.get('/api/share/docs/:id', (ctx) => {
  const doc = shareDocs.getDoc(ctx.params.id, true);
  if (!doc) {
    ctx.status = 404;
    ctx.body = { code: -1, msg: '文档不存在' };
    return;
  }
  ctx.body = { code: 0, data: doc };
});

router.post('/api/share/docs', (ctx) => {
  try {
    const data = shareDocs.createDoc(ctx.request.body || {});
    ctx.body = { code: 0, data, msg: '分享已创建', docsRoot: shareDocs.ROOT };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '创建失败' };
  }
});

// 统一保存入口，避免相对路径 / 路由歧义导致 Not Found
router.post('/api/share/save', (ctx) => {
  try {
    const body = ctx.request.body || {};
    const id = String(body.id || '').trim();
    const data = id
      ? shareDocs.updateDoc(id, body)
      : shareDocs.createDoc(body);
    ctx.body = {
      code: 0,
      data,
      msg: id ? '已保存' : '分享已创建',
      docsRoot: shareDocs.ROOT
    };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '保存失败' };
  }
});

router.post('/api/share/media', (ctx) => {
  try {
    const data = shareDocs.saveMedia(ctx.request.body || {});
    // 返回可在插件内直接引用的绝对插件路径友好 URL
    data.url = '/api/share/media/' + encodeURIComponent(data.name);
    ctx.body = { code: 0, data, msg: '媒体已上传' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '上传失败' };
  }
});

router.get('/api/share/media/:name', (ctx) => {
  const media = shareDocs.getMedia(ctx.params.name);
  if (!media) {
    ctx.status = 404;
    ctx.body = { code: -1, msg: '媒体不存在' };
    return;
  }
  ctx.set('Content-Type', media.mime);
  ctx.set('Cache-Control', 'public, max-age=86400');
  ctx.body = media.body;
});

router.post('/api/share/docs/import', (ctx) => {
  try {
    const data = shareDocs.importDoc(ctx.request.body || {});
    ctx.body = { code: 0, data, msg: '导入成功' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '导入失败' };
  }
});

router.post('/api/share/docs/:id', (ctx) => {
  try {
    const data = shareDocs.updateDoc(ctx.params.id, ctx.request.body || {});
    ctx.body = { code: 0, data, msg: '已保存' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '保存失败' };
  }
});

router.get('/api/share/docs/:id/versions', (ctx) => {
  const doc = shareDocs.getDoc(ctx.params.id, false);
  if (!doc) {
    ctx.status = 404;
    ctx.body = { code: -1, msg: '文档不存在' };
    return;
  }
  ctx.body = { code: 0, data: { items: shareDocs.listDocVersions(ctx.params.id) } };
});

router.get('/api/share/docs/:id/versions/diff', (ctx) => {
  try {
    const from = ctx.query.from;
    const to = ctx.query.to;
    ctx.body = {
      code: 0,
      data: shareDocs.compareDocVersions(ctx.params.id, from, to)
    };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '对比失败' };
  }
});

router.get('/api/share/docs/:id/versions/:vid', (ctx) => {
  try {
    ctx.body = { code: 0, data: shareDocs.getDocVersion(ctx.params.id, ctx.params.vid) };
  } catch (e) {
    ctx.status = 404;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '版本不存在' };
  }
});

router.post('/api/share/docs/:id/versions/:vid/restore', (ctx) => {
  try {
    const data = shareDocs.restoreDocVersion(ctx.params.id, ctx.params.vid);
    ctx.body = { code: 0, data, msg: '已恢复版本' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '恢复失败' };
  }
});

router.post('/api/share/docs/:id/delete', (ctx) => {
  const ok = shareDocs.deleteDoc(ctx.params.id);
  ctx.body = { code: ok ? 0 : -1, data: { deleted: ok } };
});

router.get('/api/share/docs/:id/download', (ctx) => {
  const doc = shareDocs.getDoc(ctx.params.id, true);
  if (!doc) {
    ctx.status = 404;
    ctx.body = { code: -1, msg: '文档不存在' };
    return;
  }
  const payload = shareDocs.downloadPayload(doc);
  ctx.set('Content-Type', payload.contentType);
  ctx.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(payload.filename)}`);
  ctx.body = payload.body;
});

router.get('/api/share/sync/export', async (ctx) => {
  try {
    const memoryBridge = require('../lib/memoryBridge');
    const ids = String(ctx.query.ids || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const payload = await shareDocs.exportSyncPackStream({
      docIds: ids.length ? ids : undefined,
      includeMedia: ctx.query.includeMedia !== '0'
    });
    let anchors = null;
    if (ctx.query.memoryAnchors === '1' || ctx.query.memoryAnchors === 'true') {
      const list = shareDocs.listDocs({});
      const targets = ids.length
        ? list.filter((d) => ids.includes(d.id))
        : list;
      const docs = targets.map((meta) => shareDocs.getDoc(meta.id, true)).filter(Boolean);
      anchors = await memoryBridge.pinShareDocAnchorsAsync(docs, { extraTags: ['sync-export'] });
    }
    ctx.set('Content-Type', payload.contentType);
    ctx.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(payload.filename)}`);
    ctx.set('X-Share-Sync-Meta', JSON.stringify(Object.assign({}, payload.meta, anchors ? { anchors } : {})));
    ctx.body = payload.stream;
    await payload.ready;
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e.message || '导出同步包失败' };
  }
});

router.post('/api/share/sync/import/binary', async (ctx) => {
  try {
    const memoryBridge = require('../lib/memoryBridge');
    const raw = ctx.request.rawBody;
    if (!raw || !raw.length) {
      ctx.status = 400;
      ctx.body = { code: -1, msg: '同步包为空' };
      return;
    }
    const data = shareDocs.importSyncPack({ content: raw });
    const withAnchors = String(ctx.query.memoryAnchors || '') === '1'
      || String(ctx.query.memoryAnchors || '') === 'true';
    if (withAnchors) {
      const docs = (data.items || [])
        .map((item) => shareDocs.getDoc(item.id, true))
        .filter(Boolean);
      data.anchors = await memoryBridge.pinShareDocAnchorsAsync(docs, { extraTags: ['sync-import'] });
    }
    ctx.body = { code: 0, data, msg: `已同步 ${data.docs} 篇文档` };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e.message || '导入同步包失败' };
  }
});

router.post('/api/share/sync/import', async (ctx) => {
  try {
    const memoryBridge = require('../lib/memoryBridge');
    const body = ctx.request.body || {};
    const data = shareDocs.importSyncPack(body);
    if (body.memoryAnchors === true || body.memoryAnchors === '1' || body.memoryAnchors === 1) {
      const docs = (data.items || [])
        .map((item) => shareDocs.getDoc(item.id, true))
        .filter(Boolean);
      data.anchors = await memoryBridge.pinShareDocAnchorsAsync(docs, { extraTags: ['sync-import'] });
    }
    ctx.body = { code: 0, data, msg: `已同步 ${data.docs} 篇文档` };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e.message || '导入同步包失败' };
  }
});

router.get('/api/memory-bridge/handoff', (ctx) => {
  try {
    const memoryBridge = require('../lib/memoryBridge');
    ctx.body = { code: 0, data: memoryBridge.getHandoffWorkbench() };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '读取工作台失败' };
  }
});

function writeMemoryHandover(ctx) {
  try {
    const memoryBridge = require('../lib/memoryBridge');
    const data = memoryBridge.addHandover(ctx.request.body || {});
    ctx.body = { code: 0, data, msg: '交接卡已写入 MemoryBridge' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '写入交接卡失败' };
  }
}

router.post('/api/memory-bridge/handover', writeMemoryHandover);
router.post('/api/memory-bridge/handoff', writeMemoryHandover);

router.get('/api/memory-bridge/status', (ctx) => {
  try {
    const memoryBridge = require('../lib/memoryBridge');
    const data = memoryBridge.getStatus();
    const wantHandoff = ctx.query.handoff === '1' || ctx.query.handoff === 'true';
    if (wantHandoff) {
      try {
        data.handoff = memoryBridge.getHandoffWorkbench();
      } catch (e) {
        data.handoff = {
          ok: false,
          text: '',
          error: e && e.message ? e.message : '读取工作台失败'
        };
      }
    }
    ctx.body = { code: 0, data };
  } catch (e) {
    ctx.status = 500;
    ctx.body = { code: -1, msg: e.message || 'MemoryBridge 状态读取失败' };
  }
});

router.get('/api/general/notify', (ctx) => {
  ctx.body = { code: 0, data: generalNotify.get() };
});

router.post('/api/general/notify', (ctx) => {
  const data = generalNotify.save(ctx.request.body || {});
  ctx.body = { code: 0, data, msg: '通知设置已保存' };
});

router.get('/api/general/project', (ctx) => {
  ctx.body = { code: 0, data: projectSettings.get() };
});

router.post('/api/general/project', (ctx) => {
  const data = projectSettings.save(ctx.request.body || {});
  ctx.body = { code: 0, data, msg: '项目设置已保存' };
});

router.post('/api/general/notify/test-webhook', async (ctx) => {
  try {
    const stressNotify = require('../lib/stressNotify');
    const body = ctx.request.body || {};
    const cfg = body.webhookUrl != null ? generalNotify.normalize(body) : generalNotify.get();
    const result = await stressNotify.probeWebhook(cfg);
    ctx.body = {
      code: result.ok ? 0 : -1,
      data: result,
      msg: result.ok ? 'Webhook 测试成功' : (result.error || 'Webhook 测试失败')
    };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e.message || 'Webhook 测试失败' };
  }
});

router.post('/api/stress/thresholds/test-webhook', async (ctx) => {
  try {
    const stressNotify = require('../lib/stressNotify');
    const body = ctx.request.body || {};
    const cfg = body.webhookUrl != null ? generalNotify.normalize(body) : generalNotify.get();
    const result = await stressNotify.probeWebhook(cfg);
    ctx.body = {
      code: result.ok ? 0 : -1,
      data: result,
      msg: result.ok ? 'Webhook 测试成功' : (result.error || 'Webhook 测试失败')
    };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e.message || 'Webhook 测试失败' };
  }
});

router.post('/api/share/docs/:id/memory-anchor', (ctx) => {
  try {
    const memoryBridge = require('../lib/memoryBridge');
    const doc = shareDocs.getDoc(ctx.params.id, true);
    if (!doc) {
      ctx.status = 404;
      ctx.body = { code: -1, msg: '文档不存在' };
      return;
    }
    const data = memoryBridge.addShareDocAnchor(doc, ctx.request.body || {});
    ctx.body = { code: 0, data, msg: '已写入 MemoryBridge 锚点（不改写文档正文）' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e.message || '写入记忆锚点失败' };
  }
});

router.get('/api/wiki/articles', (ctx) => {
  try {
    const wikiIngest = require('../lib/wikiIngest');
    ctx.body = { code: 0, data: { items: wikiIngest.listArticles() } };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '读取 Wiki 失败' };
  }
});

router.post('/api/wiki/ingest', (ctx) => {
  try {
    const wikiIngest = require('../lib/wikiIngest');
    const data = wikiIngest.ingest(ctx.request.body || {});
    ctx.body = { code: 0, data, msg: data.disposition === 'Update' ? '已更新 Wiki 文章' : '已入库 Wiki' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '入库失败' };
  }
});

router.post('/api/share/docs/:id/wiki-ingest', (ctx) => {
  try {
    const wikiIngest = require('../lib/wikiIngest');
    const data = wikiIngest.ingestFromShareDoc(ctx.params.id);
    ctx.body = { code: 0, data, msg: data.disposition === 'Update' ? '已更新 Wiki 文章' : '已入库 Wiki' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '入库失败' };
  }
});

router.get('/README.md', async (ctx) => {
  try {
    ctx.type = 'text/markdown; charset=utf-8';
    ctx.body = await fs.promises.readFile(README_PATH, 'utf8');
  } catch (err) {
    ctx.status = 404;
    ctx.body = 'README.md not found';
  }
});

router.get('/api/websocket-frames', (ctx) => {
  const result = websocketFrames.queryFrames({
    connectionId: ctx.query && ctx.query.connectionId,
    direction: ctx.query && ctx.query.direction,
    limit: ctx.query && ctx.query.limit,
    offset: ctx.query && ctx.query.offset
  });
  ctx.body = {
    code: 0,
    total: result.total,
    offset: result.offset,
    limit: result.limit,
    data: result.data
  };
});

router.post('/api/websocket-frames/clear', (ctx) => {
  websocketFrames.clearFrames();
  ctx.body = { code: 0 };
});

router.get('/api/records', async (ctx) => {
  await ensureStorageReady();
  const data = getRecordSummaries();
  ctx.body = {
    code: 0,
    total: data.length,
    storage: getStorageType(),
    storageInfo: getStorageInfo(),
    capture: getCaptureConfig(),
    lastError: getLastError(),
    data
  };
});

router.get('/api/records/:id', async (ctx) => {
  const record = await getRecordByIdAsync(ctx.params.id);
  if (!record) {
    ctx.status = 404;
    ctx.body = { code: -1, msg: '未找到捕获记录' };
    return;
  }
  ctx.body = { code: 0, data: record };
});

router.post('/api/clear', (ctx) => {
  clearRecords();
  ctx.body = { code: 0, msg: 'success' };
});

router.post('/api/delete', (ctx) => {
  const ids = ctx.request.body && ctx.request.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'No ids to delete' };
    return;
  }
  const removed = deleteRecordsByIds(ids);
  ctx.body = { code: 0, msg: 'success', removed };
});

router.get('/api/settings', (ctx) => {
  ctx.body = { code: 0, data: getCaptureConfig(), storage: getStorageInfo() };
});

router.post('/api/settings', async (ctx) => {
  const body = ctx.request.body || {};
  const prev = getCaptureConfig();
  const data = setCaptureConfig(body);
  const storageChanged = data.persistEngine !== prev.persistEngine
    || data.mysqlConnectionId !== prev.mysqlConnectionId
    || data.postgresConnectionId !== prev.postgresConnectionId;
  if (storageChanged) {
    try {
      await applyStorageSettings();
    } catch (e) {
      setCaptureConfig(prev);
      try {
        await applyStorageSettings();
      } catch (err) {
        // keep local fallback
      }
      ctx.status = 400;
      ctx.body = {
        code: -1,
        msg: e && e.message ? e.message : '切换存储失败',
        data: getCaptureConfig(),
        storage: getStorageInfo()
      };
      return;
    }
  }
  ctx.body = { code: 0, data, storage: getStorageInfo() };
});

router.post('/api/storage/test', async (ctx) => {
  const body = ctx.request.body || {};
  const connectionId = body.connectionId || body.id;
  try {
    const conn = getConnection(connectionId);
    const result = conn && conn.type === 'postgres'
      ? await testPostgresConnection(connectionId)
      : await testMysqlConnection(connectionId);
    ctx.body = { code: 0, data: result, msg: '已连接 ' + (result.database || '') };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '数据库连接失败' };
  }
});

router.get('/api/rules', (ctx) => {
  ctx.body = {
    code: 0,
    data: {
      text: loadRules(),
      defaultText: DEFAULT_RULES
    }
  };
});

router.post('/api/rules', (ctx) => {
  const body = ctx.request.body || {};
  let text;
  try {
    if (body.reset === true) {
      text = resetRules();
    } else if (typeof body.text !== 'string') {
      ctx.status = 400;
      ctx.body = { code: -1, msg: 'text is required' };
      return;
    } else {
      text = saveRules(body.text);
    }
  } catch (err) {
    ctx.status = err.status || 400;
    ctx.body = { code: -1, msg: err.message || 'Failed to save rules' };
    return;
  }
  const sync = syncPluginRulesFile();
  notifyWhistleReloadRules();
  ctx.body = {
    code: 0,
    data: {
      text,
      defaultText: DEFAULT_RULES,
      packaged: sync.packaged,
      error: sync.error
    }
  };
});

router.post('/api/errors/ack', (ctx) => {
  clearLastError();
  ctx.body = { code: 0 };
});

router.get('/api/extract-vars', (ctx) => {
  const recordId = ctx.query && ctx.query.recordId;
  if (!recordId) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'recordId is required' };
    return;
  }
  ctx.body = { code: 0, data: { recordId, items: listForRecord(recordId) } };
});

router.post('/api/extract-vars', async (ctx) => {
  const body = ctx.request.body || {};
  const recordId = body.recordId;
  if (!recordId) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'recordId is required' };
    return;
  }
  const items = setForRecord(recordId, body.items);
  ctx.body = { code: 0, data: await attachMysqlFlush({ recordId, items }) };
});

router.post('/api/extract-vars/preview', async (ctx) => {
  const body = ctx.request.body || {};
  const loaded = body.recordId ? await getRecordByIdAsync(body.recordId) : null;
  const record = buildPreviewRecord(loaded, body);
  if (!record.responseBody && !(record.responseHeaders && Object.keys(record.responseHeaders).length)) {
    ctx.status = 404;
    ctx.body = { code: -1, msg: '未找到捕获记录' };
    return;
  }
  const item = normalizeItem(body);
  const result = resolveItemValue(record, item);
  ctx.body = {
    code: 0,
    data: {
      varName: item.varName,
      jsonPath: item.jsonPath,
      ...result
    }
  };
});

router.get('/api/assertions', (ctx) => {
  const recordId = ctx.query && ctx.query.recordId;
  if (!recordId) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'recordId is required' };
    return;
  }
  ctx.body = { code: 0, data: { recordId, items: listAssertions(recordId) } };
});

router.post('/api/assertions', async (ctx) => {
  const body = ctx.request.body || {};
  const recordId = body.recordId;
  if (!recordId) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'recordId is required' };
    return;
  }
  const items = setAssertions(recordId, body.items);
  ctx.body = { code: 0, data: await attachMysqlFlush({ recordId, items }) };
});

router.post('/api/assertions/preview', async (ctx) => {
  const body = ctx.request.body || {};
  const loaded = body.recordId ? await getRecordByIdAsync(body.recordId) : null;
  const record = buildPreviewRecord(loaded, body);
  if (!record.responseBody && record.responseStatus == null && !(record.responseHeaders && Object.keys(record.responseHeaders).length)) {
    ctx.status = 404;
    ctx.body = { code: -1, msg: '未找到捕获记录' };
    return;
  }
  const item = normalizeAssertion(body);
  ctx.body = { code: 0, data: evaluateAssertion(record, item) };
});

router.get('/api/db-connections', (ctx) => {
  ctx.body = { code: 0, data: { items: listPublicConnections(), types: Object.keys(DB_TYPES) } };
});

router.post('/api/db-connections', async (ctx) => {
  const body = ctx.request.body || {};
  if (!String(body.name || '').trim()) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'name is required' };
    return;
  }
  const item = upsertConnection(body);
  let mysql = false;
  let mysqlDatabase = '';
  let mysqlError = '';
  try {
    const remote = await persistRemote(item);
    mysql = Boolean(remote && remote.mysql);
    mysqlDatabase = (remote && remote.database) || '';
  } catch (e) {
    mysqlError = e && e.message ? e.message : '写入 MySQL 失败';
  }
  ctx.body = {
    code: 0,
    data: {
      item: publicConnection(item),
      sqlite: true,
      mysql,
      mysqlDatabase,
      mysqlError
    }
  };
});

router.post('/api/db-connections/delete', (ctx) => {
  const body = ctx.request.body || {};
  if (!body.id) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'id is required' };
    return;
  }
  const ok = deleteConnection(body.id);
  if (ok) onConnectionDeleted(body.id);
  ctx.body = { code: ok ? 0 : -1, data: { deleted: ok } };
});

router.post('/api/db-connections/test', async (ctx) => {
  const body = ctx.request.body || {};
  const result = await testConnection(body);
  const okMsg = result.message || (result.mode === 'mysql' ? 'MySQL 连接成功' : '主机端口可达');
  ctx.body = {
    code: result.ok ? 0 : -1,
    data: result,
    msg: result.ok ? okMsg : (result.error || '连接失败')
  };
});

router.get('/api/db-ops/databases', async (ctx) => {
  const connectionId = ctx.query && ctx.query.connectionId;
  if (!connectionId) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'connectionId is required' };
    return;
  }
  try {
    const data = await listConnectionDatabases(connectionId);
    ctx.body = { code: 0, data };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '读取数据库列表失败' };
  }
});

router.post('/api/db-ops/execute', async (ctx) => {
  const body = ctx.request.body || {};
  if (!String(body.connectionId || '').trim()) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: '请选择数据库连接' };
    return;
  }
  if (!String(body.sql || '').trim()) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: '请填写 SQL 命令' };
    return;
  }
  try {
    const data = await executeSql(body, { getRecordByIdAsync });
    let msg = '执行成功';
    if (data.truncated) msg += `（预览最多 ${data.previewLimit || data.rows.length} 行，已自动追加 LIMIT）`;
    else if (data.total != null) msg += `（${data.total} 行）`;
    if (data.unresolved && data.unresolved.length) {
      msg += `；未解析变量：${data.unresolved.join(', ')}`;
    }
    ctx.body = { code: 0, data, msg };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : 'SQL 执行失败' };
  }
});

router.post('/api/db-ops/extract-preview', async (ctx) => {
  const body = ctx.request.body || {};
  const rows = body.rows;
  const jsonPath = String(body.jsonPath || '$').trim() || '$';
  if (!Array.isArray(rows)) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: '请先执行 SQL 获取结果数组' };
    return;
  }
  const result = extractJsonPath(JSON.stringify(rows), jsonPath, {
    unpackArray: Boolean(body.arrayUnpack)
  });
  ctx.body = { code: 0, data: result };
});

router.get('/api/db-ops', (ctx) => {
  const recordId = ctx.query && ctx.query.recordId;
  if (!recordId) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'recordId is required' };
    return;
  }
  ctx.body = { code: 0, data: { recordId, items: listDbOps(recordId) } };
});

router.post('/api/db-ops', async (ctx) => {
  const body = ctx.request.body || {};
  const recordId = body.recordId;
  if (!recordId) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'recordId is required' };
    return;
  }
  const items = setDbOps(recordId, body.items);
  ctx.body = { code: 0, data: await attachMysqlFlush({ recordId, items }) };
});

router.post('/api/correlate-preview', async (ctx) => {
  const targetRecords = await resolveRecords(ctx.request.body);
  if (targetRecords.length === 0) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'No records to preview' };
    return;
  }
  const plans = correlateTokens(targetRecords, {
    edits: ctx.request.body && ctx.request.body.correlateEdits,
    manualExtractors: getExtractorsForRecords(targetRecords.map((item) => item.id))
  });
  ctx.body = {
    code: 0,
    data: plans.report || { vars: [], jwtClaims: [] }
  };
});

router.post('/api/export', async (ctx) => {
  const targetRecords = await resolveRecords(ctx.request.body);
  if (targetRecords.length === 0) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'No records to export' };
    return;
  }

  try {
    const xmlData = generateJMX(targetRecords, resolveExportOptions(ctx.request.body));
    ctx.set('Content-Disposition', `attachment; filename="whistle_generated_${Date.now()}.jmx"`);
    ctx.set('Content-Type', 'application/xml; charset=utf-8');
    ctx.body = xmlData;
  } catch (error) {
    sendExportError(ctx, error, 'Failed to generate JMX');
  }
});

router.post('/api/export-postman', async (ctx) => {
  const targetRecords = await resolveRecords(ctx.request.body);
  if (targetRecords.length === 0) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'No records to export' };
    return;
  }
  try {
    const collection = generatePostmanCollection(targetRecords, resolveExportOptions(ctx.request.body));
    ctx.set('Content-Disposition', `attachment; filename="whistle_postman_${Date.now()}.json"`);
    ctx.set('Content-Type', 'application/json; charset=utf-8');
    ctx.body = JSON.stringify(collection, null, 2);
  } catch (error) {
    sendExportError(ctx, error, 'Failed to generate Postman collection');
  }
});

router.post('/api/export-k6', async (ctx) => {
  const targetRecords = await resolveRecords(ctx.request.body);
  if (targetRecords.length === 0) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'No records to export' };
    return;
  }

  try {
    const script = generateK6Script(targetRecords, resolveExportOptions(ctx.request.body));
    ctx.set('Content-Disposition', `attachment; filename="whistle_k6_${Date.now()}.js"`);
    ctx.set('Content-Type', 'application/javascript; charset=utf-8');
    ctx.body = script;
  } catch (error) {
    sendExportError(ctx, error, 'Failed to generate k6 script');
  }
});

router.post('/api/export-csv', async (ctx) => {
  const targetRecords = await resolveRecords(ctx.request.body);
  if (targetRecords.length === 0) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'No records to export' };
    return;
  }

  try {
    const csvData = generateCSV(targetRecords);
    ctx.set('Content-Disposition', `attachment; filename="whistle_traffic_${Date.now()}.csv"`);
    ctx.set('Content-Type', 'text/csv; charset=utf-8');
    ctx.body = csvData;
  } catch (error) {
    sendExportError(ctx, error, 'Failed to generate CSV');
  }
});

router.get('/api/stress/config', (ctx) => {
  ctx.body = { code: 0, data: stressTest.getConfig() };
});

router.post('/api/stress/config', (ctx) => {
  const data = stressTest.saveConfig(ctx.request.body || {});
  ctx.body = { code: 0, data, msg: '已保存压测参数' };
});

router.get('/api/stress/status', (ctx) => {
  ctx.body = { code: 0, data: stressTest.getStatus() };
});

router.post('/api/stress/start', async (ctx) => {
  const body = ctx.request.body || {};
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: '请先勾选要回放的录制请求' };
    return;
  }
  const targetRecords = await resolveRecords({ ids });
  if (!targetRecords.length) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: '勾选的录制请求不存在或已删除' };
    return;
  }
  try {
    const data = await stressTest.start(targetRecords, body);
    ctx.body = { code: 0, data, msg: '压测已启动' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '启动压测失败' };
  }
});

router.post('/api/stress/stop', (ctx) => {
  const data = stressTest.stop();
  ctx.body = { code: 0, data, msg: '已请求停止压测' };
});

router.get('/api/stress/reports', (ctx) => {
  try {
    ctx.body = {
      code: 0,
      data: {
        items: stressReportStore.listReports(),
        mysqlSync: stressReportStore.getMysqlSyncStatus(),
        baseline: stressBaseline.get()
      }
    };
  } catch (e) {
    ctx.status = 500;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '读取报告失败' };
  }
});

router.get('/api/stress/baseline', (ctx) => {
  ctx.body = { code: 0, data: stressBaseline.get() };
});

router.post('/api/stress/baseline', (ctx) => {
  const body = ctx.request.body || {};
  try {
    if (body.clear) {
      ctx.body = { code: 0, data: stressBaseline.clearBaseline(), msg: '已取消基线' };
      return;
    }
    const reportId = body.reportId || body.id;
    if (!reportId) {
      ctx.status = 400;
      ctx.body = { code: -1, msg: 'reportId 必填' };
      return;
    }
    if (!stressReportStore.getReport(reportId)) {
      ctx.status = 404;
      ctx.body = { code: -1, msg: '报告不存在' };
      return;
    }
    const data = stressBaseline.setBaseline(reportId, { label: body.label });
    ctx.body = { code: 0, data, msg: '已设为基线报告' };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '设置基线失败' };
  }
});

router.get('/api/stress/reports/:id', (ctx) => {
  try {
    const report = stressReportStore.getReport(ctx.params.id);
    if (!report) {
      ctx.status = 404;
      ctx.body = { code: -1, msg: '报告不存在' };
      return;
    }
    const alerts = stressThresholds.evaluate(report);
    ctx.body = { code: 0, data: Object.assign({}, report, { alerts }) };
  } catch (e) {
    ctx.status = 500;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '读取报告失败' };
  }
});

router.get('/api/stress/reports/:id/pdf', (ctx) => {
  try {
    const report = stressReportStore.getReport(ctx.params.id);
    if (!report) {
      ctx.status = 404;
      ctx.body = { code: -1, msg: '报告不存在' };
      return;
    }
    const alerts = stressThresholds.evaluate(report);
    const buf = buildStressReportPdf(Object.assign({}, report, { alerts }));
    const safeId = String(report.id || 'report').replace(/[^\w.-]+/g, '_').slice(0, 80);
    ctx.set('Content-Type', 'application/pdf');
    ctx.set('Content-Disposition', `attachment; filename="stress-report-${safeId}.pdf"`);
    ctx.body = buf;
  } catch (e) {
    ctx.status = 500;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '生成 PDF 失败' };
  }
});

router.post('/api/stress/reports/delete', (ctx) => {
  const id = ctx.request.body && ctx.request.body.id;
  if (!id) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'id is required' };
    return;
  }
  const ok = stressReportStore.deleteReport(id);
  if (ok) stressBaseline.clearIfMatches(id);
  ctx.body = { code: ok ? 0 : -1, data: { deleted: ok } };
});

router.get('/api/stress/thresholds', (ctx) => {
  ctx.body = { code: 0, data: stressThresholds.get() };
});

router.post('/api/stress/thresholds', (ctx) => {
  const data = stressThresholds.save(ctx.request.body || {});
  ctx.body = { code: 0, data, msg: '阈值已保存' };
});

router.post('/api/stress/reports/compare', (ctx) => {
  const body = ctx.request.body || {};
  const baselineId = body.baselineId || body.leftId;
  const currentId = body.currentId || body.rightId;
  if (!baselineId || !currentId) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'baselineId 与 currentId 必填' };
    return;
  }
  try {
    const baseline = stressReportStore.getReport(baselineId);
    const current = stressReportStore.getReport(currentId);
    if (!baseline || !current) {
      ctx.status = 404;
      ctx.body = { code: -1, msg: '报告不存在' };
      return;
    }
    const data = stressThresholds.compareReports(baseline, current);
    data.baseline.alerts = stressThresholds.evaluate(baseline);
    data.current.alerts = stressThresholds.evaluate(current);
    ctx.body = { code: 0, data };
  } catch (e) {
    ctx.status = 500;
    ctx.body = { code: -1, msg: e && e.message ? e.message : '对比失败' };
  }
});

app.use(router.routes()).use(router.allowedMethods());
app.use(async (ctx) => {
  if ((ctx.method === 'GET' || ctx.method === 'HEAD') && !String(ctx.path || '').startsWith('/api')) {
    await sendPluginHtml(ctx);
    return;
  }
  ctx.status = 404;
  ctx.body = { code: -1, msg: 'Not Found' };
});

module.exports = (server, options) => {
  updateRulesFn = options && typeof options.updateRules === 'function'
    ? options.updateRules
    : null;
  applyStoredRules();
  server.on('request', app.callback());
};
