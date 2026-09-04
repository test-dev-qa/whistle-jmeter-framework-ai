'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');

const CONFIG_FILE = path.join(DATA_DIR, 'stressThresholds.json');

const DEFAULTS = {
  enabled: true,
  maxFailRate: 1,
  maxAvgLatencyMs: 500,
  maxP90LatencyMs: 1000,
  maxP95LatencyMs: 1500,
  minRps: 0,
  maxAvgDbLatencyMs: 0,
  webhookOnFail: true,
  webhookOnPass: false
};

let saved = Object.assign({}, DEFAULTS);

function clampNum(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function normalize(src) {
  const body = src && typeof src === 'object' ? src : {};
  return {
    enabled: body.enabled !== false,
    maxFailRate: clampNum(body.maxFailRate, DEFAULTS.maxFailRate, 0, 100),
    maxAvgLatencyMs: clampNum(body.maxAvgLatencyMs, DEFAULTS.maxAvgLatencyMs, 0, 600000),
    maxP90LatencyMs: clampNum(body.maxP90LatencyMs, DEFAULTS.maxP90LatencyMs, 0, 600000),
    maxP95LatencyMs: clampNum(body.maxP95LatencyMs, DEFAULTS.maxP95LatencyMs, 0, 600000),
    minRps: clampNum(body.minRps, DEFAULTS.minRps, 0, 1000000),
    maxAvgDbLatencyMs: clampNum(body.maxAvgDbLatencyMs, DEFAULTS.maxAvgDbLatencyMs, 0, 600000),
    webhookOnFail: body.webhookOnFail !== false,
    webhookOnPass: body.webhookOnPass === true
  };
}

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      saved = normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
    }
  } catch (e) {
    saved = Object.assign({}, DEFAULTS);
  }
  return get();
}

function get() {
  return Object.assign({}, saved);
}

function save(src) {
  saved = normalize(src);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFile(CONFIG_FILE, JSON.stringify(saved, null, 2));
  } catch (e) {
    // ignore
  }
  return get();
}

function rule(key, label, actual, threshold, op, unit, apiName) {
  let passed = true;
  if (op === 'lte') passed = actual <= threshold;
  else if (op === 'gte') passed = actual >= threshold;
  else if (op === 'lt') passed = actual < threshold;
  else if (op === 'gt') passed = actual > threshold;
  return {
    key,
    label,
    actual,
    threshold,
    op,
    unit: unit || '',
    apiName: apiName || '',
    passed,
    enabled: true
  };
}

function reportApiName(report) {
  const apis = Array.isArray(report && report.apis) ? report.apis : [];
  const names = apis.map((api) => {
    const name = String(api && api.name || '').trim();
    if (name) return name;
    const method = String(api && api.method || '').trim().toUpperCase();
    const path = String(api && (api.path || api.url) || '').trim();
    return [method, path].filter(Boolean).join(' ');
  }).filter(Boolean);
  return Array.from(new Set(names)).join('、') || '全部接口';
}

function evaluate(report, thresholds) {
  const cfg = normalize(thresholds || saved);
  const summary = (report && report.summary) || {};
  const apiName = reportApiName(report);
  const items = [];
  if (!cfg.enabled) {
    return { enabled: false, passed: true, failedCount: 0, items: [] };
  }

  items.push(rule(
    'failRate',
    '请求失败率',
    Number(summary.failRate) || 0,
    cfg.maxFailRate,
    'lte',
    '%',
    apiName
  ));
  items.push(rule(
    'avgLatencyMs',
    '平均响应时间',
    Number(summary.avgLatencyMs) || 0,
    cfg.maxAvgLatencyMs,
    'lte',
    'ms',
    apiName
  ));
  items.push(rule(
    'p90LatencyMs',
    'P90 响应时间',
    Number(summary.p90LatencyMs) || 0,
    cfg.maxP90LatencyMs,
    'lte',
    'ms',
    apiName
  ));
  items.push(rule(
    'p95LatencyMs',
    'P95 响应时间',
    Number(summary.p95LatencyMs) || 0,
    cfg.maxP95LatencyMs,
    'lte',
    'ms',
    apiName
  ));
  if (cfg.minRps > 0) {
    items.push(rule(
      'rps',
      '每秒接口请求数',
      Number(summary.rps) || 0,
      cfg.minRps,
      'gte',
      '',
      apiName
    ));
  }
  if (cfg.maxAvgDbLatencyMs > 0 && Number(summary.dbTotal) > 0) {
    items.push(rule(
      'avgDbLatencyMs',
      '平均 DB 耗时',
      Number(summary.avgDbLatencyMs) || 0,
      cfg.maxAvgDbLatencyMs,
      'lte',
      'ms',
      apiName
    ));
  }

  const failed = items.filter((x) => !x.passed);
  return {
    enabled: true,
    passed: failed.length === 0,
    failedCount: failed.length,
    items,
    thresholds: cfg
  };
}

function normalizeApiPath(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      s = u.pathname + u.search;
    }
  } catch (e) {
    // keep original
  }
  s = s.split('#')[0];
  try {
    s = decodeURIComponent(s);
  } catch (e) {
    // keep original
  }
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function apiKey(api) {
  const method = String(api.method || 'GET').toUpperCase();
  const p = normalizeApiPath(api.path || api.url || '');
  return method + ' ' + p;
}

function delta(a, b) {
  const left = Number(a) || 0;
  const right = Number(b) || 0;
  const d = right - left;
  const pct = left === 0 ? (right === 0 ? 0 : 100) : Number(((d / Math.abs(left)) * 100).toFixed(2));
  return { baseline: left, current: right, delta: Number(d.toFixed(4)), deltaPct: pct };
}

function compareReports(baseline, current) {
  if (!baseline || !current) throw new Error('需要两份有效报告');
  const bSum = baseline.summary || {};
  const cSum = current.summary || {};
  const summary = {
    total: delta(bSum.total, cSum.total),
    rps: delta(bSum.rps, cSum.rps),
    avgLatencyMs: delta(bSum.avgLatencyMs, cSum.avgLatencyMs),
    p50LatencyMs: delta(bSum.p50LatencyMs, cSum.p50LatencyMs),
    p90LatencyMs: delta(bSum.p90LatencyMs, cSum.p90LatencyMs),
    p95LatencyMs: delta(bSum.p95LatencyMs, cSum.p95LatencyMs),
    failRate: delta(bSum.failRate, cSum.failRate),
    successRate: delta(bSum.successRate, cSum.successRate),
    avgDbLatencyMs: delta(bSum.avgDbLatencyMs, cSum.avgDbLatencyMs),
    dbTotal: delta(bSum.dbTotal, cSum.dbTotal)
  };

  const bMap = {};
  (baseline.apis || []).forEach((api) => {
    bMap[apiKey(api)] = api;
  });
  const cMap = {};
  (current.apis || []).forEach((api) => {
    cMap[apiKey(api)] = api;
  });
  const keys = Array.from(new Set(Object.keys(bMap).concat(Object.keys(cMap))));
  const statusRank = { both: 0, added: 1, removed: 2 };
  const apis = keys.map((key) => {
    const b = bMap[key] || null;
    const c = cMap[key] || null;
    const sample = c || b || {};
    const status = !b ? 'added' : (!c ? 'removed' : 'both');
    return {
      key,
      method: sample.method || '',
      name: sample.name || '',
      path: sample.path || sample.url || '',
      status,
      total: delta(b && b.total, c && c.total),
      rps: delta(b && b.rps, c && c.rps),
      avgLatencyMs: delta(b && b.avgLatencyMs, c && c.avgLatencyMs),
      p90LatencyMs: delta(b && b.p90LatencyMs, c && c.p90LatencyMs),
      failRate: delta(b && b.failRate, c && c.failRate)
    };
  }).sort((a, b) => {
    const ra = statusRank[a.status] != null ? statusRank[a.status] : 9;
    const rb = statusRank[b.status] != null ? statusRank[b.status] : 9;
    if (ra !== rb) return ra - rb;
    return String(a.key).localeCompare(String(b.key));
  });

  const counts = {
    both: apis.filter((x) => x.status === 'both').length,
    added: apis.filter((x) => x.status === 'added').length,
    removed: apis.filter((x) => x.status === 'removed').length
  };

  return {
    baseline: {
      id: baseline.id,
      startedAt: baseline.startedAt,
      endedAt: baseline.endedAt,
      status: baseline.status,
      config: baseline.config,
      summary: bSum
    },
    current: {
      id: current.id,
      startedAt: current.startedAt,
      endedAt: current.endedAt,
      status: current.status,
      config: current.config,
      summary: cSum
    },
    summary,
    counts,
    apis,
    series: {
      baseline: Array.isArray(baseline.series) ? baseline.series : [],
      current: Array.isArray(current.series) ? current.series : []
    }
  };
}

load();

module.exports = {
  DEFAULTS,
  normalize,
  load,
  get,
  save,
  evaluate,
  reportApiName,
  compareReports,
  apiKey,
  normalizeApiPath,
  delta
};
