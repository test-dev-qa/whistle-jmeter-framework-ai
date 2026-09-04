'use strict';

/**
 * Thin bridge: share-doc metadata → MemoryBridge CLI (content freeze: never rewrite doc body).
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function probeMembridgeRunner(cmd, baseArgs) {
  const result = spawnSync(cmd, baseArgs.concat(['--version']), {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    env: process.env
  });
  return !result.error && result.status === 0;
}

function resolveMembridgeRunner() {
  if (process.env.MEMBRIDGE_BIN) {
    return { cmd: process.env.MEMBRIDGE_BIN, baseArgs: [], via: 'env' };
  }
  const home = os.homedir();
  const candidates = [
    path.join(process.env.APPDATA || '', 'Python', 'Python313', 'Scripts', 'membridge.exe'),
    path.join(home, 'AppData', 'Roaming', 'Python', 'Python313', 'Scripts', 'membridge.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'Scripts', 'membridge.exe'),
    path.join(home, '.local', 'bin', 'membridge')
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      return { cmd: p, baseArgs: [], via: 'path' };
    }
  }
  const pyCandidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];
  for (const py of pyCandidates) {
    if (probeMembridgeRunner(py, ['-m', 'membridge'])) {
      return { cmd: py, baseArgs: ['-m', 'membridge'], via: 'python-module' };
    }
  }
  return {
    cmd: process.platform === 'win32' ? 'membridge.exe' : 'membridge',
    baseArgs: [],
    via: 'fallback'
  };
}

function runnerLabel(runner) {
  if (!runner) return '';
  if (runner.baseArgs && runner.baseArgs.length) {
    return `${runner.cmd} ${runner.baseArgs.join(' ')}`;
  }
  return runner.cmd;
}

function resolveMembridgeCmd() {
  return runnerLabel(resolveMembridgeRunner());
}

function runMembridge(subArgs, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const runner = resolveMembridgeRunner();
  const args = runner.baseArgs.concat(subArgs);
  const result = spawnSync(runner.cmd, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs || 20000,
    windowsHide: true,
    env: process.env
  });
  return { runner, result };
}

function buildShareAnchorText(doc) {
  const title = String((doc && doc.title) || 'untitled').slice(0, 120);
  const slug = String((doc && doc.slug) || '').slice(0, 120);
  const id = String((doc && doc.id) || '').slice(0, 64);
  const format = String((doc && doc.format) || 'md');
  const stationId = String((doc && doc.stationId) || 'local');
  const viewPath = slug ? `/share/${slug}` : '';
  const content = String((doc && doc.content) || '');
  const excerpt = content
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return [
    `share-doc anchor: ${title}`,
    `id: ${id}`,
    `slug: ${slug}`,
    `format: ${format}`,
    `stationId: ${stationId}`,
    viewPath ? `path: ${viewPath}` : '',
    excerpt ? `excerpt: ${excerpt}` : '',
    'note: pointer only; original share doc body is authoritative and not rewritten'
  ].filter(Boolean).join('\n');
}

function cliSafeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, ' | ')
    .replace(/\0/g, '')
    .slice(0, 4000);
}

function sanitizeTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((t) => String(t || '')
      .replace(/[\r\n,]/g, '_')
      .replace(/\s+/g, '_')
      .trim()
      .slice(0, 48))
    .filter(Boolean);
}

function addShareDocAnchor(doc, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const text = cliSafeText(buildShareAnchorText(doc));
  const tags = sanitizeTags(['share-doc', 'anchor'].concat(
    doc && doc.slug ? ['slug:' + String(doc.slug).slice(0, 40)] : [],
    options.extraTags || []
  ));

  if (options.dryRun) {
    return { ok: true, dryRun: true, text, tags };
  }

  const { runner, result } = runMembridge(['add', text, '--kind', 'fact', '--tags', tags.join(',')], options);

  if (result.error) {
    const err = result.error;
    if (err.code === 'ENOENT') {
      throw new Error(
        `未找到 membridge CLI（尝试 ${runnerLabel(runner)}），请安装 MemoryBridge 或设置 MEMBRIDGE_BIN`
      );
    }
    throw err;
  }
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || '').trim() || `membridge exit ${result.status}`;
    throw new Error(msg.slice(0, 500));
  }
  const out = String(result.stdout || '').trim();
  const idMatch = out.match(/[0-9a-f]{8,}/i);
  return {
    ok: true,
    text,
    tags,
    cliOutput: out.slice(0, 400),
    memoryId: idMatch ? idMatch[0] : null,
    host: os.hostname(),
    via: runner.via
  };
}

function pinShareDocAnchors(docs, opts) {
  const result = { ok: 0, fail: 0, items: [] };
  (Array.isArray(docs) ? docs : []).forEach((doc) => {
    if (!doc || !doc.id) return;
    try {
      const r = addShareDocAnchor(doc, opts);
      result.ok += 1;
      result.items.push({ id: doc.id, memoryId: r.memoryId });
    } catch (err) {
      result.fail += 1;
      result.items.push({
        id: doc.id,
        error: String(err && err.message ? err.message : err).slice(0, 160)
      });
    }
  });
  return result;
}

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function pinShareDocAnchorsAsync(docs, opts) {
  const result = { ok: 0, fail: 0, items: [] };
  const list = Array.isArray(docs) ? docs : [];
  for (let i = 0; i < list.length; i += 1) {
    const doc = list[i];
    if (!doc || !doc.id) continue;
    try {
      const r = addShareDocAnchor(doc, opts);
      result.ok += 1;
      result.items.push({ id: doc.id, memoryId: r.memoryId });
    } catch (err) {
      result.fail += 1;
      result.items.push({
        id: doc.id,
        error: String(err && err.message ? err.message : err).slice(0, 160)
      });
    }
    if (i % 3 === 2) await yieldEventLoop();
  }
  return result;
}

const HANDOVER_FIELDS = ['goal', 'done', 'failed', 'next', 'refs'];

function buildHandoverText(body) {
  const src = body && typeof body === 'object' ? body : {};
  const lines = HANDOVER_FIELDS.map((key) => {
    const value = String(src[key] || '').trim();
    return value ? `${key}: ${value}` : '';
  }).filter(Boolean);
  if (!lines.length) throw new Error('至少填写 goal、done、next 或 refs 之一');
  return cliSafeText(lines.join('\n'));
}

function addHandover(body, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const text = buildHandoverText(body);
  const tags = sanitizeTags(['handover', 'whistle'].concat(options.extraTags || body.tags || []));

  if (options.dryRun) {
    return { ok: true, dryRun: true, text, tags };
  }

  const { runner, result } = runMembridge(['add', text, '--kind', 'handover', '--tags', tags.join(',')], options);

  if (result.error) {
    const err = result.error;
    if (err.code === 'ENOENT') {
      throw new Error(
        `未找到 membridge CLI（尝试 ${runnerLabel(runner)}），请安装 MemoryBridge 或设置 MEMBRIDGE_BIN`
      );
    }
    throw err;
  }
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || '').trim() || `membridge exit ${result.status}`;
    throw new Error(msg.slice(0, 500));
  }
  const out = String(result.stdout || '').trim();
  const idMatch = out.match(/[0-9a-f]{8,}/i);
  return {
    ok: true,
    text,
    tags,
    cliOutput: out.slice(0, 400),
    memoryId: idMatch ? idMatch[0] : null,
    via: runner.via
  };
}

function getHandoffWorkbench() {
  const { runner, result } = runMembridge(['handoff'], { timeoutMs: 15000 });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`未找到 membridge CLI（尝试 ${runnerLabel(runner)}）`);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || '').trim() || `membridge exit ${result.status}`;
    throw new Error(msg.slice(0, 500));
  }
  return {
    ok: true,
    text: String(result.stdout || '').trim().slice(0, 8000),
    via: runner.via
  };
}

function getStatus() {
  const runner = resolveMembridgeRunner();
  const { result: ver } = runMembridge(['--version'], { timeoutMs: 8000 });
  if (ver.error || ver.status !== 0) {
    return {
      available: false,
      cmd: runnerLabel(runner),
      via: runner.via,
      error: (ver.stderr || ver.stdout || (ver.error && ver.error.message) || 'membridge 不可用')
        .trim()
        .slice(0, 200)
    };
  }
  const { result: stats } = runMembridge(['stats'], { timeoutMs: 8000 });
  return {
    available: true,
    cmd: runnerLabel(runner),
    via: runner.via,
    version: String(ver.stdout || '').trim(),
    stats: String(stats.stdout || stats.stderr || '').trim().slice(0, 400)
  };
}

module.exports = {
  resolveMembridgeCmd,
  resolveMembridgeRunner,
  runnerLabel,
  buildShareAnchorText,
  sanitizeTags,
  addShareDocAnchor,
  pinShareDocAnchors,
  pinShareDocAnchorsAsync,
  buildHandoverText,
  addHandover,
  getHandoffWorkbench,
  getStatus
};
