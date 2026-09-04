'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');
const { normalizeHeaders, resourceName, createRecordId } = require('./utils');
const stressReportStore = require('./stressReportStore');
const stressPostOps = require('./stressPostOps');
const stressThresholds = require('./stressThresholds');
const stressNotify = require('./stressNotify');
const stressReportLabel = require('./stressReportLabel');

const CONFIG_FILE = path.join(DATA_DIR, 'stressConfig.json');
const SERIES_INTERVAL_MS = 1000;
const MAX_SERIES_POINTS = 600;
// Report execution details are diagnostic data, not a full traffic archive.
// Keep the report usable when a high-RPS test generates millions of samples.
const MAX_REPORT_EXECUTIONS = 2000;
const MAX_EXECUTION_BODY_CHARS = 8192;
const SKIP_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'accept-encoding',
  'transfer-encoding',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
  'expect'
]);

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 512, maxFreeSockets: 64 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 512, maxFreeSockets: 64 });

const DEFAULT_CONFIG = {
  users: 10,
  durationMin: 1,
  rampUpMin: 0
};

let savedConfig = Object.assign({}, DEFAULT_CONFIG);
let runState = null;
let lastReportId = '';

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function normalizeConfig(src) {
  const body = src && typeof src === 'object' ? src : {};
  return {
    users: clampInt(body.users, DEFAULT_CONFIG.users, 1, 5000),
    durationMin: clampInt(body.durationMin, DEFAULT_CONFIG.durationMin, 1, 60),
    rampUpMin: clampInt(body.rampUpMin, DEFAULT_CONFIG.rampUpMin, 0, 30)
  };
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      savedConfig = normalizeConfig(parsed);
    }
  } catch (e) {
    savedConfig = Object.assign({}, DEFAULT_CONFIG);
  }
  return getConfig();
}

function getConfig() {
  return Object.assign({}, savedConfig);
}

function saveConfig(src) {
  savedConfig = normalizeConfig(src);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFile(CONFIG_FILE, JSON.stringify(savedConfig, null, 2));
  } catch (e) {
    // ignore
  }
  return getConfig();
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function requestPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch (e) {
    return String(url || '');
  }
}

function buildRequest(record) {
  const url = String(record && record.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('仅支持 http/https 请求回放');
  }
  const method = String(record.method || 'GET').toUpperCase();
  const headers = {};
  const raw = normalizeHeaders(record.requestHeaders || record.headers || {});
  Object.keys(raw).forEach((key) => {
    if (SKIP_HEADERS.has(String(key).toLowerCase())) return;
    headers[key] = raw[key];
  });
  let body;
  if (record.requestBodyBinary) {
    throw new Error('暂不支持二进制请求体回放，请换用文本/JSON 请求');
  }
  if (method !== 'GET' && method !== 'HEAD') {
    if (record.requestBody != null && record.requestBody !== '') body = String(record.requestBody);
    else if (record.body != null && record.body !== '') body = String(record.body);
  }
  const pathText = requestPath(url);
  return {
    id: String(record.id || ''),
    name: String(record.name || resourceName(url) || pathText || 'request'),
    url,
    path: pathText,
    method,
    headers,
    body
  };
}

// A completed HTTP response is considered failed by default only when the
// server reports a client or server error. Transport errors and timeouts are
// handled separately as failed requests in sendOnce.
function isHttpFailureStatus(status) {
  const code = Number(status) || 0;
  return code >= 400 && code <= 599;
}

function elapsedMsBetween(startedHr, endedHr) {
  return Number((Number(endedHr - startedHr) / 1e6).toFixed(3));
}

function elapsedMsSince(startedHr) {
  return elapsedMsBetween(startedHr, process.hrtime.bigint());
}

function sendOnce(req, state, options) {
  const capture = Boolean(options && options.capture);
  const requestedLimit = Number(options && options.captureLimit);
  const captureLimit = Number.isFinite(requestedLimit) && requestedLimit >= 0
    ? requestedLimit
    : stressPostOps.MAX_CAPTURE_BODY;
  return new Promise((resolve) => {
    const started = Date.now();
    const startedHr = process.hrtime.bigint();
    let settled = false;
    const finish = (ok, status, error, extra) => {
      if (settled) return;
      settled = true;
      if (state && state.activeRequests && request) {
        state.activeRequests.delete(request);
      }
      resolve(Object.assign({
        ok,
        status: status || 0,
        startedAt: started,
        latencyMs: elapsedMsSince(startedHr),
        error: error || '',
        body: '',
        headers: {}
      }, extra || {}));
    };
    let target;
    let request = null;
    try {
      target = new URL(req.url);
    } catch (e) {
      finish(false, 0, 'URL 无效');
      return;
    }
    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;
    const optionsReq = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers: req.headers,
      timeout: 30000,
      agent: isHttps ? httpsAgent : httpAgent
    };
    request = lib.request(optionsReq, (res) => {
      const chunks = [];
      let size = 0;
      const captureResponse = capture || isHttpFailureStatus(res.statusCode);
      res.on('data', (chunk) => {
        if (!captureResponse) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (size >= captureLimit) return;
        const remain = captureLimit - size;
        chunks.push(buf.length > remain ? buf.slice(0, remain) : buf);
        size += Math.min(buf.length, remain);
      });
      res.on('end', () => {
        const code = Number(res.statusCode) || 0;
        const body = captureResponse && chunks.length
          ? Buffer.concat(chunks).toString('utf8')
          : '';
        const failedByStatus = isHttpFailureStatus(code);
        finish(
          !failedByStatus,
          code,
          failedByStatus ? `HTTP ${code}` : '',
          captureResponse ? { body, headers: res.headers || {} } : null
        );
      });
    });
    if (state && state.activeRequests) state.activeRequests.add(request);
    request.on('timeout', () => {
      request.destroy();
      finish(false, 0, '请求超时');
    });
    request.on('error', (err) => {
      const msg = err && err.message ? err.message : '请求失败';
      if (/aborted|socket hang up|ECONNRESET/i.test(msg) && state && state.stopRequested) {
        finish(false, 0, '已停止');
        return;
      }
      finish(false, 0, msg);
    });
    if (req.body != null) request.write(req.body);
    request.end();
  });
}

function abortActiveRequests(state) {
  if (!state || !state.activeRequests) return;
  state.activeRequests.forEach((req) => {
    try {
      req.destroy(new Error('stress stop'));
    } catch (e) {
      // ignore
    }
  });
  state.activeRequests.clear();
}

function downsampleSeries(points, maxPoints) {
  const list = Array.isArray(points) ? points : [];
  const max = Math.max(2, maxPoints || MAX_SERIES_POINTS);
  if (list.length <= max) return list.slice();
  const out = [];
  const last = list.length - 1;
  for (let i = 0; i < max; i += 1) {
    const idx = i === max - 1 ? last : Math.round((i * last) / (max - 1));
    out.push(list[idx]);
  }
  return out;
}

function emptyEndpointStats(req) {
  return {
    method: req.method,
    name: req.name,
    url: req.url,
    path: req.path,
    total: 0,
    success: 0,
    failed: 0,
    latencySum: 0,
    minLatencyMs: null,
    maxLatencyMs: 0,
    latencies: [],
    request: {
      id: req.id || '',
      url: req.url || '',
      headers: Object.assign({}, req.headers || {}),
      body: req.body == null ? '' : String(req.body)
    },
    failureSamples: []
  };
}

function emptyStats(requests) {
  const byKey = {};
  (requests || []).forEach((req) => {
    const key = req.statsKey || `${req.method} ${req.url}`;
    if (!byKey[key]) byKey[key] = emptyEndpointStats(req);
  });
  return {
    total: 0,
    success: 0,
    failed: 0,
    latencySum: 0,
    latencies: [],
    byKey,
    windowTotal: 0,
    windowSuccess: 0,
    windowFailed: 0,
    windowLatencySum: 0,
    dbTotal: 0,
    dbLatencySum: 0,
    dbLatencies: []
  };
}

function recordDbSample(state, latencies) {
  const list = Array.isArray(latencies) ? latencies : [];
  if (!list.length) return;
  const stats = state.stats;
  list.forEach((ms) => {
    const v = Math.max(0, Number(ms) || 0);
    stats.dbTotal += 1;
    stats.dbLatencySum += v;
    pushLatencySample(stats.dbLatencies, v, 4000);
  });
}

function pushLatencySample(list, value, cap) {
  if (!Object.prototype.hasOwnProperty.call(list, '_seen')) list._seen = 0;
  list._seen += 1;
  if (list.length < cap) {
    list.push(value);
    return;
  }
  const j = Math.floor(Math.random() * list._seen);
  if (j < cap) list[j] = value;
}

function recordSample(state, req, sample) {
  const stats = state.stats;
  const key = req.statsKey || `${req.method} ${req.url}`;
  if (!stats.byKey[key]) stats.byKey[key] = emptyEndpointStats(req);
  const ep = stats.byKey[key];
  stats.total += 1;
  stats.latencySum += sample.latencyMs;
  stats.windowTotal += 1;
  stats.windowLatencySum += sample.latencyMs;
  ep.total += 1;
  ep.latencySum += sample.latencyMs;
  if (ep.minLatencyMs == null || sample.latencyMs < ep.minLatencyMs) ep.minLatencyMs = sample.latencyMs;
  if (sample.latencyMs > ep.maxLatencyMs) ep.maxLatencyMs = sample.latencyMs;
  pushLatencySample(stats.latencies, sample.latencyMs, 8000);
  pushLatencySample(ep.latencies, sample.latencyMs, 4000);
  if (sample.ok) {
    stats.success += 1;
    stats.windowSuccess += 1;
    ep.success += 1;
  } else {
    stats.failed += 1;
    stats.windowFailed += 1;
    ep.failed += 1;
    state.lastError = sample.error || `HTTP ${sample.status}`;
    // Keep a small diagnostic sample: a stress run can contain hundreds of
    // thousands of requests, so retaining every response is not viable.
    if (ep.failureSamples.length < 5) {
      ep.failureSamples.push({
        at: Date.now(),
        status: Number(sample.status) || 0,
        latencyMs: Math.max(0, Number(sample.latencyMs) || 0),
        error: String(sample.error || ''),
        responseHeaders: Object.assign({}, sample.headers || {}),
        responseBody: String(sample.body || '')
      });
    }
  }
}

function truncateExecutionText(value) {
  const text = String(value == null ? '' : value);
  return text.length > MAX_EXECUTION_BODY_CHARS
    ? { text: text.slice(0, MAX_EXECUTION_BODY_CHARS), truncated: true }
    : { text, truncated: false };
}

function recordExecutionSample(state, req, sample) {
  if (!state || state.executionSamples.length >= MAX_REPORT_EXECUTIONS) {
    if (state) state.executionDropped += 1;
    return;
  }
  const requestBody = truncateExecutionText(req.body);
  const responseBody = truncateExecutionText(sample.body);
  state.executionSamples.push({
    id: `${state.reportId}-${state.executionSeq++}`,
    at: Number(sample.startedAt) || Date.now(),
    method: req.method || '',
    name: req.name || '',
    url: req.url || '',
    path: req.path || '',
    ok: Boolean(sample.ok),
    status: Number(sample.status) || 0,
    latencyMs: Math.max(0, Number(sample.latencyMs) || 0),
    error: String(sample.error || ''),
    requestHeaders: Object.assign({}, req.headers || {}),
    requestBody: requestBody.text,
    requestBodyTruncated: requestBody.truncated,
    responseHeaders: Object.assign({}, sample.headers || {}),
    responseBody: responseBody.text,
    responseBodyTruncated: responseBody.truncated
  });
}

function pushSeriesPoint(state) {
  const stats = state.stats;
  const now = Date.now();
  const elapsedSec = Math.max(0.001, (now - (state.lastSeriesAt || state.startedAt)) / 1000);
  const avg = stats.windowTotal ? Math.round(stats.windowLatencySum / stats.windowTotal) : 0;
  const rps = Number((stats.windowTotal / elapsedSec).toFixed(2));
  const failRate = stats.windowTotal
    ? Number(((stats.windowFailed / stats.windowTotal) * 100).toFixed(2))
    : 0;
  state.series.push({
    ts: now,
    rps,
    avgLatencyMs: avg,
    failRate,
    concurrentUsers: state.activeUsers
  });
  state.lastSeriesAt = now;
  stats.windowTotal = 0;
  stats.windowSuccess = 0;
  stats.windowFailed = 0;
  stats.windowLatencySum = 0;
}

function startSeriesTimer(state) {
  state.lastSeriesAt = state.startedAt;
  state.seriesTimer = setInterval(() => {
    if (!runState || runState !== state) {
      clearInterval(state.seriesTimer);
      return;
    }
    if (state.status === 'running' || state.status === 'stopping') {
      pushSeriesPoint(state);
    }
  }, SERIES_INTERVAL_MS);
}

function effectiveEndedAt(state) {
  if (state.endedAt) return state.endedAt;
  if (state.status === 'finished' || state.status === 'stopped' || state.status === 'failed') {
    return Date.now();
  }
  return Date.now();
}

function buildApiRows(state) {
  const end = effectiveEndedAt(state);
  const elapsedSec = Math.max(0.001, (end - state.startedAt) / 1000);
  return Object.keys(state.stats.byKey).map((key) => {
    const ep = state.stats.byKey[key];
    const sorted = ep.latencies.slice().sort((a, b) => a - b);
    return {
      method: ep.method,
      name: ep.name,
      url: ep.url,
      path: ep.path,
      total: ep.total,
      success: ep.success,
      failed: ep.failed,
      failRate: ep.total ? Number(((ep.failed / ep.total) * 100).toFixed(2)) : 0,
      rps: Number((ep.total / elapsedSec).toFixed(2)),
      avgLatencyMs: ep.total ? Math.round(ep.latencySum / ep.total) : 0,
      minLatencyMs: ep.minLatencyMs == null ? 0 : ep.minLatencyMs,
      maxLatencyMs: ep.maxLatencyMs || 0,
      p90LatencyMs: percentile(sorted, 90),
      detail: {
        request: ep.request || {},
        failureSamples: ep.failureSamples || []
      }
    };
  });
}

function buildLiveSnapshot(state) {
  const stats = state.stats;
  const endedAt = state.endedAt || null;
  const now = endedAt || Date.now();
  const elapsedMs = Math.max(0, now - state.startedAt);
  const sorted = stats.latencies.slice().sort((a, b) => a - b);
  const dbSorted = (stats.dbLatencies || []).slice().sort((a, b) => a - b);
  const avg = stats.total ? Math.round(stats.latencySum / stats.total) : 0;
  const rps = elapsedMs > 0 ? Number((stats.total / (elapsedMs / 1000)).toFixed(2)) : 0;
  const plannedMs = Math.max(1, (state.plannedEndsAt || state.endsAt) - state.startedAt);
  const terminal = state.status === 'finished' || state.status === 'stopped' || state.status === 'failed';
  return {
    status: state.status,
    config: state.config,
    recordCount: state.requests.length,
    startedAt: state.startedAt,
    endsAt: state.endsAt,
    endedAt: endedAt || undefined,
    elapsedMs,
    remainMs: state.status === 'running' ? Math.max(0, state.endsAt - Date.now()) : 0,
    activeUsers: state.activeUsers,
    reportId: state.reportId,
    lastReportId: lastReportId || '',
    reportSaved: Boolean(state.reportSaved),
    progress: {
      percent: terminal ? 100 : Math.min(100, Math.round((elapsedMs / plannedMs) * 100))
    },
    result: {
      total: stats.total,
      success: stats.success,
      failed: stats.failed,
      successRate: stats.total ? Number(((stats.success / stats.total) * 100).toFixed(2)) : 0,
      failRate: stats.total ? Number(((stats.failed / stats.total) * 100).toFixed(2)) : 0,
      avgLatencyMs: avg,
      p50LatencyMs: percentile(sorted, 50),
      p90LatencyMs: percentile(sorted, 90),
      p95LatencyMs: percentile(sorted, 95),
      rps,
      dbTotal: stats.dbTotal || 0,
      avgDbLatencyMs: (stats.dbTotal || 0)
        ? Math.round((stats.dbLatencySum || 0) / stats.dbTotal)
        : 0,
      p90DbLatencyMs: percentile(dbSorted, 90),
      lastError: state.lastError || ''
    },
    postOps: state.postOps || { extracts: 0, asserts: 0, dbops: 0, enabled: false },
    error: state.error || ''
  };
}

function buildReport(state) {
  const snap = buildLiveSnapshot(state);
  const result = snap.result || {};
  const report = {
    id: state.reportId,
    createdAt: new Date().toISOString(),
    startedAt: state.startedAt,
    endedAt: state.endedAt || Date.now(),
    status: state.status,
    config: state.config,
    recordCount: state.requests.length,
    summary: {
      total: result.total || 0,
      success: result.success || 0,
      failed: result.failed || 0,
      failRate: result.total
        ? Number((((result.failed || 0) / result.total) * 100).toFixed(2))
        : 0,
      successRate: result.successRate || 0,
      rps: result.rps || 0,
      avgLatencyMs: result.avgLatencyMs || 0,
      p50LatencyMs: result.p50LatencyMs || 0,
      p90LatencyMs: result.p90LatencyMs || 0,
      p95LatencyMs: result.p95LatencyMs || 0,
      dbTotal: result.dbTotal || 0,
      avgDbLatencyMs: result.avgDbLatencyMs || 0,
      p90DbLatencyMs: result.p90DbLatencyMs || 0
    },
    series: downsampleSeries(state.series, MAX_SERIES_POINTS),
    apis: buildApiRows(state),
    executions: state.executionSamples.slice(),
    executionDropped: state.executionDropped || 0
  };
  return stressReportLabel.attachReportLabels(report);
}

function finalizeReport(state) {
  if (state.reportSaved) return state.savedReport || null;
  if (!state.endedAt) state.endedAt = Date.now();
  if (state.seriesTimer) {
    clearInterval(state.seriesTimer);
    state.seriesTimer = null;
  }
  pushSeriesPoint(state);
  try {
    const report = buildReport(state);
    const alerts = stressThresholds.evaluate(report);
    report.alerts = alerts;
    const saved = stressReportStore.saveReport(report);
    state.reportSaved = true;
    state.savedReport = saved;
    lastReportId = saved.id;
    state.frozenSnapshot = buildLiveSnapshot(state);
    // Fire-and-forget notify; do not block finalize
    Promise.resolve()
      .then(() => {
        const generalNotify = require('./generalNotify');
        return stressNotify.notifyThresholdResult(
          saved,
          alerts,
          generalNotify.resolveForThreshold(stressThresholds.get())
        );
      })
      .catch(() => {});
    return saved;
  } catch (e) {
    state.error = e && e.message ? e.message : '保存测试报告失败';
    state.frozenSnapshot = buildLiveSnapshot(state);
    return null;
  }
}

function snapshot(state) {
  if (!state) {
    return {
      status: 'idle',
      config: getConfig(),
      progress: null,
      result: null,
      lastReportId: lastReportId || '',
      reportSaved: false
    };
  }
  if (state.frozenSnapshot) {
    return Object.assign({}, state.frozenSnapshot, {
      lastReportId: lastReportId || state.frozenSnapshot.lastReportId || '',
      reportSaved: Boolean(state.reportSaved),
      error: state.error || state.frozenSnapshot.error || ''
    });
  }
  return buildLiveSnapshot(state);
}

function getStatus() {
  return snapshot(runState);
}

async function vuLoop(state, vuIndex) {
  const rampMs = state.config.rampUpMin * 60 * 1000;
  const delay = state.config.users <= 1 || rampMs <= 0
    ? 0
    : Math.floor((vuIndex / Math.max(1, state.config.users - 1)) * rampMs);
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (state.status !== 'running') return;
  state.activeUsers += 1;
  const vars = Object.create(null);
  try {
    let cursor = 0;
    while (state.status === 'running' && Date.now() < state.endsAt) {
      const tpl = state.requests[cursor % state.requests.length];
      cursor += 1;
      const req = stressPostOps.applyRequestVars(tpl, vars);
      const keepExecutionDetail = state.executionSamples.length < MAX_REPORT_EXECUTIONS;
      const sample = await sendOnce(req, state, {
        capture: Boolean(tpl.needCapture) || keepExecutionDetail,
        captureLimit: tpl.needCapture ? stressPostOps.MAX_CAPTURE_BODY : MAX_EXECUTION_BODY_CHARS
      });
      if (state.stopRequested && sample.error === '已停止') break;
      if (state.status !== 'running' && state.status !== 'stopping') break;
      if (sample.ok && tpl.needCapture && !state.stopRequested) {
        const post = await stressPostOps.runPostOps(tpl, sample, vars, state);
        recordDbSample(state, post && post.dbLatencies);
        if (!post.ok) {
          sample.ok = false;
          sample.error = post.error || '后置操作失败';
        }
      }
      recordSample(state, tpl, sample);
      recordExecutionSample(state, req, sample);
    }
  } finally {
    state.activeUsers = Math.max(0, state.activeUsers - 1);
  }
}

async function start(records, options) {
  if (runState && (runState.status === 'running' || runState.status === 'stopping')) {
    throw new Error(runState.status === 'stopping'
      ? '上一轮压测正在停止，请稍后再启动'
      : '已有压测任务在运行，请先停止');
  }
  const list = Array.isArray(records) ? records : [];
  if (!list.length) throw new Error('请先勾选要回放的录制请求');
  const config = normalizeConfig(options);
  const requests = [];
  for (let i = 0; i < list.length; i += 1) {
    try {
      requests.push(buildRequest(list[i]));
    } catch (e) {
      throw new Error(`第 ${i + 1} 条请求无法回放：${e.message || e}`);
    }
  }
  const postOps = stressPostOps.attachPostOps(list, requests);
  const startedAt = Date.now();
  const plannedEndsAt = startedAt + config.durationMin * 60 * 1000;
  const state = {
    status: 'running',
    reportId: createRecordId(),
    config,
    requests,
    postOps,
    startedAt,
    endsAt: plannedEndsAt,
    plannedEndsAt,
    endedAt: null,
    activeUsers: 0,
    stats: emptyStats(requests),
    series: [],
    lastSeriesAt: startedAt,
    lastError: '',
    error: '',
    stopRequested: false,
    reportSaved: false,
    savedReport: null,
    frozenSnapshot: null,
    seriesTimer: null,
    activeRequests: new Set(),
    dbPools: new Map(),
    executionSamples: [],
    executionDropped: 0,
    executionSeq: 1
  };
  runState = state;
  startSeriesTimer(state);
  const runners = [];
  for (let i = 0; i < config.users; i += 1) {
    runners.push(vuLoop(state, i));
  }
  Promise.all(runners).then(async () => {
    if (runState === state) {
      state.status = state.stopRequested ? 'stopped' : 'finished';
      state.endedAt = Date.now();
      abortActiveRequests(state);
      await stressPostOps.closeDbPools(state);
      finalizeReport(state);
    }
  }).catch(async (err) => {
    if (runState === state) {
      state.status = 'failed';
      state.endedAt = Date.now();
      state.error = err && err.message ? err.message : '压测失败';
      abortActiveRequests(state);
      await stressPostOps.closeDbPools(state);
      finalizeReport(state);
    }
  });
  return snapshot(state);
}

function stop() {
  if (!runState || (runState.status !== 'running' && runState.status !== 'stopping')) {
    return snapshot(runState);
  }
  runState.stopRequested = true;
  runState.status = 'stopping';
  runState.endsAt = Date.now();
  abortActiveRequests(runState);
  return snapshot(runState);
}

loadConfig();

module.exports = {
  DEFAULT_CONFIG,
  MAX_SERIES_POINTS,
  MAX_REPORT_EXECUTIONS,
  normalizeConfig,
  getConfig,
  saveConfig,
  loadConfig,
  buildRequest,
  isHttpFailureStatus,
  elapsedMsBetween,
  elapsedMsSince,
  emptyStats,
  recordSample,
  buildApiRows,
  buildLiveSnapshot,
  start,
  stop,
  getStatus,
  percentile,
  finalizeReport,
  downsampleSeries
};
