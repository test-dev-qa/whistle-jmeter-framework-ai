'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { toPoolConfig } = require('./mysqlStore');

const DB_FILE = path.join(DATA_DIR, 'stressReports.sqlite');
const MAX_REPORTS = 50;

const SQLITE_DDL = [
  'CREATE TABLE IF NOT EXISTS wje_stress_reports (',
  '  id TEXT PRIMARY KEY NOT NULL,',
  '  created_at TEXT,',
  '  started_at INTEGER,',
  '  ended_at INTEGER,',
  '  status TEXT,',
  '  users INTEGER,',
  '  duration_min INTEGER,',
  '  ramp_up_min INTEGER,',
  '  record_count INTEGER,',
  '  total INTEGER,',
  '  success INTEGER,',
  '  failed INTEGER,',
  '  fail_rate REAL,',
  '  success_rate REAL,',
  '  rps REAL,',
  '  avg_latency_ms INTEGER,',
  '  p50_latency_ms INTEGER,',
  '  p90_latency_ms INTEGER,',
  '  p95_latency_ms INTEGER,',
  '  summary_json TEXT',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_wje_stress_reports_created ON wje_stress_reports(created_at DESC);',
  'CREATE TABLE IF NOT EXISTS wje_stress_report_series (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  report_id TEXT NOT NULL,',
  '  ts INTEGER,',
  '  rps REAL,',
  '  avg_latency_ms INTEGER,',
  '  fail_rate REAL,',
  '  concurrent_users INTEGER',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_wje_stress_series_report ON wje_stress_report_series(report_id, ts);',
  'CREATE TABLE IF NOT EXISTS wje_stress_report_apis (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  report_id TEXT NOT NULL,',
  '  method TEXT,',
  '  name TEXT,',
  '  url TEXT,',
  '  path TEXT,',
  '  total INTEGER,',
  '  success INTEGER,',
  '  failed INTEGER,',
  '  fail_rate REAL,',
  '  rps REAL,',
  '  avg_latency_ms INTEGER,',
  '  min_latency_ms INTEGER,',
  '  max_latency_ms INTEGER,',
  '  p90_latency_ms INTEGER',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_wje_stress_apis_report ON wje_stress_report_apis(report_id);'
].join('\n');

const MYSQL_DDL = [
  [
    'CREATE TABLE IF NOT EXISTS `wje_stress_reports` (',
    '  id VARCHAR(80) NOT NULL,',
    '  created_at DATETIME(3) NULL,',
    '  started_at BIGINT NULL,',
    '  ended_at BIGINT NULL,',
    '  status VARCHAR(32) NULL,',
    '  users INT NULL,',
    '  duration_min INT NULL,',
    '  ramp_up_min INT NULL,',
    '  record_count INT NULL,',
    '  total INT NULL,',
    '  success INT NULL,',
    '  failed INT NULL,',
    '  fail_rate DOUBLE NULL,',
    '  success_rate DOUBLE NULL,',
    '  rps DOUBLE NULL,',
    '  avg_latency_ms INT NULL,',
    '  p50_latency_ms INT NULL,',
    '  p90_latency_ms INT NULL,',
    '  p95_latency_ms INT NULL,',
    '  summary_json LONGTEXT NULL,',
    '  PRIMARY KEY (id),',
    '  KEY idx_wje_stress_reports_created (created_at)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ].join('\n'),
  [
    'CREATE TABLE IF NOT EXISTS `wje_stress_report_series` (',
    '  id BIGINT NOT NULL AUTO_INCREMENT,',
    '  report_id VARCHAR(80) NOT NULL,',
    '  ts BIGINT NULL,',
    '  rps DOUBLE NULL,',
    '  avg_latency_ms INT NULL,',
    '  fail_rate DOUBLE NULL,',
    '  concurrent_users INT NULL,',
    '  PRIMARY KEY (id),',
    '  KEY idx_wje_stress_series_report (report_id, ts)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ].join('\n'),
  [
    'CREATE TABLE IF NOT EXISTS `wje_stress_report_apis` (',
    '  id BIGINT NOT NULL AUTO_INCREMENT,',
    '  report_id VARCHAR(80) NOT NULL,',
    '  method VARCHAR(16) NULL,',
    '  name VARCHAR(255) NULL,',
    '  url VARCHAR(2048) NULL,',
    '  path VARCHAR(2048) NULL,',
    '  total INT NULL,',
    '  success INT NULL,',
    '  failed INT NULL,',
    '  fail_rate DOUBLE NULL,',
    '  rps DOUBLE NULL,',
    '  avg_latency_ms INT NULL,',
    '  min_latency_ms INT NULL,',
    '  max_latency_ms INT NULL,',
    '  p90_latency_ms INT NULL,',
    '  PRIMARY KEY (id),',
    '  KEY idx_wje_stress_apis_report (report_id)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ].join('\n')
];

let sqlite = null;
let mysqlQueue = Promise.resolve();
let lastMysqlSync = { ok: true, skipped: true, error: '', at: 0 };

function setMysqlSync(partial) {
  lastMysqlSync = Object.assign(
    { ok: true, skipped: false, error: '', at: Date.now() },
    partial || {}
  );
  return lastMysqlSync;
}

function getMysqlSyncStatus() {
  return Object.assign({}, lastMysqlSync);
}

function openSqlite() {
  if (sqlite) return sqlite;
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(SQLITE_DDL);
  sqlite = {
    db,
    insertReport: db.prepare(
      'INSERT OR REPLACE INTO wje_stress_reports (' +
        'id, created_at, started_at, ended_at, status, users, duration_min, ramp_up_min, record_count, ' +
        'total, success, failed, fail_rate, success_rate, rps, avg_latency_ms, p50_latency_ms, p90_latency_ms, p95_latency_ms, summary_json' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    deleteReport: db.prepare('DELETE FROM wje_stress_reports WHERE id = ?'),
    deleteSeries: db.prepare('DELETE FROM wje_stress_report_series WHERE report_id = ?'),
    deleteApis: db.prepare('DELETE FROM wje_stress_report_apis WHERE report_id = ?'),
    insertSeries: db.prepare(
      'INSERT INTO wje_stress_report_series (report_id, ts, rps, avg_latency_ms, fail_rate, concurrent_users) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    insertApi: db.prepare(
      'INSERT INTO wje_stress_report_apis (' +
        'report_id, method, name, url, path, total, success, failed, fail_rate, rps, avg_latency_ms, min_latency_ms, max_latency_ms, p90_latency_ms' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    listReports: db.prepare(
      'SELECT id, created_at, started_at, ended_at, status, users, duration_min, ramp_up_min, record_count, ' +
        'total, success, failed, fail_rate, success_rate, rps, avg_latency_ms, p50_latency_ms, p90_latency_ms, p95_latency_ms ' +
        'FROM wje_stress_reports ORDER BY created_at DESC, started_at DESC LIMIT 100'
    ),
    getReport: db.prepare('SELECT * FROM wje_stress_reports WHERE id = ?'),
    getSeries: db.prepare(
      'SELECT ts, rps, avg_latency_ms, fail_rate, concurrent_users FROM wje_stress_report_series WHERE report_id = ? ORDER BY ts ASC, id ASC'
    ),
    getApis: db.prepare(
      'SELECT method, name, url, path, total, success, failed, fail_rate, rps, avg_latency_ms, min_latency_ms, max_latency_ms, p90_latency_ms ' +
        'FROM wje_stress_report_apis WHERE report_id = ? ORDER BY id ASC'
    ),
    listIdsAsc: db.prepare('SELECT id FROM wje_stress_reports ORDER BY created_at ASC, started_at ASC')
  };
  return sqlite;
}

function rowToSummary(row) {
  if (!row) return null;
  let extra = {};
  try {
    if (row.summary_json) extra = JSON.parse(row.summary_json) || {};
  } catch (e) {
    extra = {};
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    startedAt: Number(row.started_at) || 0,
    endedAt: Number(row.ended_at) || 0,
    status: row.status || '',
    projectName: String(extra.projectName || '').trim(),
    title: String(extra.title || '').trim(),
    apiDetails: Array.isArray(extra.apiDetails) ? extra.apiDetails : [],
    executions: Array.isArray(extra.executions) ? extra.executions : [],
    executionDropped: Number(extra.executionDropped) || 0,
    config: {
      users: Number(row.users) || 0,
      durationMin: Number(row.duration_min) || 0,
      rampUpMin: Number(row.ramp_up_min) || 0
    },
    recordCount: Number(row.record_count) || 0,
    summary: {
      total: Number(row.total) || 0,
      success: Number(row.success) || 0,
      failed: Number(row.failed) || 0,
      failRate: Number(row.fail_rate) || 0,
      successRate: Number(row.success_rate) || 0,
      rps: Number(row.rps) || 0,
      avgLatencyMs: Number(row.avg_latency_ms) || 0,
      p50LatencyMs: Number(row.p50_latency_ms) || 0,
      p90LatencyMs: Number(row.p90_latency_ms) || 0,
      p95LatencyMs: Number(row.p95_latency_ms) || 0,
      dbTotal: Number(extra.dbTotal) || 0,
      avgDbLatencyMs: Number(extra.avgDbLatencyMs) || 0,
      p90DbLatencyMs: Number(extra.p90DbLatencyMs) || 0
    }
  };
}

function normalizeApiDetail(src) {
  const detail = src && typeof src === 'object' ? src : {};
  const request = detail.request && typeof detail.request === 'object' ? detail.request : {};
  return {
    request: {
      id: String(request.id || ''),
      url: String(request.url || ''),
      headers: request.headers && typeof request.headers === 'object' ? request.headers : {},
      body: request.body == null ? '' : String(request.body)
    },
    failureSamples: Array.isArray(detail.failureSamples) ? detail.failureSamples.slice(0, 5).map((sample) => ({
      at: Number(sample && sample.at) || 0,
      status: Number(sample && sample.status) || 0,
      latencyMs: Number(sample && sample.latencyMs) || 0,
      error: String(sample && sample.error || ''),
      responseHeaders: sample && sample.responseHeaders && typeof sample.responseHeaders === 'object' ? sample.responseHeaders : {},
      // Bound persisted diagnostic payloads even when an upstream server returns
      // a very large error document.
      responseBody: String(sample && sample.responseBody || '').slice(0, 65536)
    })) : []
  };
}

function normalizeExecution(src) {
  const sample = src && typeof src === 'object' ? src : {};
  return {
    id: String(sample.id || ''),
    at: Number(sample.at) || 0,
    method: String(sample.method || ''),
    name: String(sample.name || ''),
    url: String(sample.url || ''),
    path: String(sample.path || ''),
    ok: Boolean(sample.ok),
    status: Number(sample.status) || 0,
    latencyMs: Number(sample.latencyMs) || 0,
    error: String(sample.error || ''),
    requestHeaders: sample.requestHeaders && typeof sample.requestHeaders === 'object' ? sample.requestHeaders : {},
    requestBody: String(sample.requestBody || '').slice(0, 8192),
    requestBodyTruncated: Boolean(sample.requestBodyTruncated),
    responseHeaders: sample.responseHeaders && typeof sample.responseHeaders === 'object' ? sample.responseHeaders : {},
    responseBody: String(sample.responseBody || '').slice(0, 8192),
    responseBodyTruncated: Boolean(sample.responseBodyTruncated)
  };
}

function pickNum(row, snake, camel) {
  if (row[snake] != null && row[snake] !== '') return Number(row[snake]) || 0;
  if (row[camel] != null && row[camel] !== '') return Number(row[camel]) || 0;
  return 0;
}

function mapSeries(row) {
  const src = row || {};
  return {
    ts: pickNum(src, 'ts', 'ts'),
    rps: pickNum(src, 'rps', 'rps'),
    avgLatencyMs: pickNum(src, 'avg_latency_ms', 'avgLatencyMs'),
    failRate: pickNum(src, 'fail_rate', 'failRate'),
    concurrentUsers: pickNum(src, 'concurrent_users', 'concurrentUsers')
  };
}

function mapApi(row) {
  const src = row || {};
  return {
    method: src.method || '',
    name: src.name || '',
    url: src.url || '',
    path: src.path || '',
    total: pickNum(src, 'total', 'total'),
    success: pickNum(src, 'success', 'success'),
    failed: pickNum(src, 'failed', 'failed'),
    failRate: pickNum(src, 'fail_rate', 'failRate'),
    rps: pickNum(src, 'rps', 'rps'),
    avgLatencyMs: pickNum(src, 'avg_latency_ms', 'avgLatencyMs'),
    minLatencyMs: pickNum(src, 'min_latency_ms', 'minLatencyMs'),
    maxLatencyMs: pickNum(src, 'max_latency_ms', 'maxLatencyMs'),
    p90LatencyMs: pickNum(src, 'p90_latency_ms', 'p90LatencyMs')
  };
}

function pruneOldReports(store) {
  const pruned = [];
  const ids = store.listIdsAsc.all().map((r) => r.id);
  while (ids.length > MAX_REPORTS) {
    const oldId = ids.shift();
    store.deleteSeries.run(oldId);
    store.deleteApis.run(oldId);
    store.deleteReport.run(oldId);
    pruned.push(oldId);
  }
  return pruned;
}

function enqueueMysql(task) {
  mysqlQueue = mysqlQueue
    .then(task)
    .catch((err) => {
      const msg = err && err.message ? err.message : String(err);
      setMysqlSync({ ok: false, skipped: false, error: msg });
      console.error('[stressReportStore] mysql sync failed:', msg);
    });
  return mysqlQueue;
}

async function ensureMysqlSchema(client) {
  for (let i = 0; i < MYSQL_DDL.length; i += 1) {
    await client.query(MYSQL_DDL[i]);
  }
}

async function withMysqlClient(fn) {
  const { getCaptureConfig } = require('./captureConfig');
  const { getConnection } = require('./dbConnections');
  const cfg = getCaptureConfig();
  if (cfg.persistEngine !== 'mysql' || !cfg.mysqlConnectionId) {
    setMysqlSync({ ok: true, skipped: true, error: '' });
    return;
  }
  const conn = getConnection(cfg.mysqlConnectionId);
  if (!conn) {
    setMysqlSync({ ok: false, skipped: false, error: '未找到所选 MySQL 连接' });
    return;
  }
  const mysql = require('mysql2/promise');
  const client = await mysql.createConnection(toPoolConfig(conn));
  try {
    await ensureMysqlSchema(client);
    await fn(client);
  } finally {
    await client.end();
  }
}

function syncReportToMysql(report) {
  const payload = report;
  enqueueMysql(async () => {
    await withMysqlClient(async (client) => {
      await client.beginTransaction();
      try {
        await client.query('DELETE FROM `wje_stress_report_series` WHERE report_id = ?', [payload.id]);
        await client.query('DELETE FROM `wje_stress_report_apis` WHERE report_id = ?', [payload.id]);
        await client.query('DELETE FROM `wje_stress_reports` WHERE id = ?', [payload.id]);
        const summary = payload.summary || {};
        const config = payload.config || {};
        await client.query(
          'INSERT INTO `wje_stress_reports` (' +
            'id, created_at, started_at, ended_at, status, users, duration_min, ramp_up_min, record_count, ' +
            'total, success, failed, fail_rate, success_rate, rps, avg_latency_ms, p50_latency_ms, p90_latency_ms, p95_latency_ms, summary_json' +
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            payload.id,
            payload.createdAt ? new Date(payload.createdAt) : new Date(),
            payload.startedAt || 0,
            payload.endedAt || 0,
            payload.status || '',
            config.users || 0,
            config.durationMin || 0,
            config.rampUpMin || 0,
            payload.recordCount || 0,
            summary.total || 0,
            summary.success || 0,
            summary.failed || 0,
            summary.failRate || 0,
            summary.successRate || 0,
            summary.rps || 0,
            summary.avgLatencyMs || 0,
            summary.p50LatencyMs || 0,
            summary.p90LatencyMs || 0,
            summary.p95LatencyMs || 0,
            JSON.stringify(Object.assign({}, summary, {
              apiDetails: payload.apiDetails || [],
              executions: payload.executions || [],
              executionDropped: payload.executionDropped || 0
            }))
          ]
        );
        const series = payload.series || [];
        for (let i = 0; i < series.length; i += 1) {
          const point = series[i];
          await client.query(
            'INSERT INTO `wje_stress_report_series` (report_id, ts, rps, avg_latency_ms, fail_rate, concurrent_users) VALUES (?, ?, ?, ?, ?, ?)',
            [payload.id, point.ts || 0, point.rps || 0, point.avgLatencyMs || 0, point.failRate || 0, point.concurrentUsers || 0]
          );
        }
        const apis = payload.apis || [];
        for (let i = 0; i < apis.length; i += 1) {
          const api = apis[i];
          await client.query(
            'INSERT INTO `wje_stress_report_apis` (' +
              'report_id, method, name, url, path, total, success, failed, fail_rate, rps, avg_latency_ms, min_latency_ms, max_latency_ms, p90_latency_ms' +
              ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              payload.id,
              api.method || '',
              api.name || '',
              api.url || '',
              api.path || '',
              api.total || 0,
              api.success || 0,
              api.failed || 0,
              api.failRate || 0,
              api.rps || 0,
              api.avgLatencyMs || 0,
              api.minLatencyMs || 0,
              api.maxLatencyMs || 0,
              api.p90LatencyMs || 0
            ]
          );
        }
        await client.commit();
        setMysqlSync({ ok: true, skipped: false, error: '' });
      } catch (e) {
        try {
          await client.rollback();
        } catch (ignore) {
          // ignore
        }
        throw e;
      }
    });
  });
}

function deleteReportFromMysql(id) {
  enqueueMysql(async () => {
    await withMysqlClient(async (client) => {
      await client.beginTransaction();
      try {
        await client.query('DELETE FROM `wje_stress_report_series` WHERE report_id = ?', [id]);
        await client.query('DELETE FROM `wje_stress_report_apis` WHERE report_id = ?', [id]);
        await client.query('DELETE FROM `wje_stress_reports` WHERE id = ?', [id]);
        await client.commit();
        setMysqlSync({ ok: true, skipped: false, error: '' });
      } catch (e) {
        try {
          await client.rollback();
        } catch (ignore) {
          // ignore
        }
        throw e;
      }
    });
  });
}

function saveReport(report) {
  const store = openSqlite();
  const src = report && typeof report === 'object' ? report : {};
  const summary = src.summary || {};
  const config = src.config || {};
  const id = String(src.id || '').trim();
  if (!id) throw new Error('report id is required');
  const createdAt = src.createdAt || new Date().toISOString();
  const projectName = String(src.projectName || '').trim();
  const title = String(src.title || '').trim();
  const normalized = {
    id,
    createdAt,
    startedAt: Number(src.startedAt) || 0,
    endedAt: Number(src.endedAt) || Date.now(),
    status: String(src.status || ''),
    config: {
      users: Number(config.users) || 0,
      durationMin: Number(config.durationMin) || 0,
      rampUpMin: Number(config.rampUpMin) || 0
    },
    recordCount: Number(src.recordCount) || 0,
    summary: {
      total: Number(summary.total) || 0,
      success: Number(summary.success) || 0,
      failed: Number(summary.failed) || 0,
      failRate: Number(summary.failRate) || 0,
      successRate: Number(summary.successRate) || 0,
      rps: Number(summary.rps) || 0,
      avgLatencyMs: Number(summary.avgLatencyMs) || 0,
      p50LatencyMs: Number(summary.p50LatencyMs) || 0,
      p90LatencyMs: Number(summary.p90LatencyMs) || 0,
      p95LatencyMs: Number(summary.p95LatencyMs) || 0,
      dbTotal: Number(summary.dbTotal) || 0,
      avgDbLatencyMs: Number(summary.avgDbLatencyMs) || 0,
      p90DbLatencyMs: Number(summary.p90DbLatencyMs) || 0
    },
    series: Array.isArray(src.series) ? src.series.map(mapSeries) : [],
    apis: Array.isArray(src.apis) ? src.apis.map(mapApi) : [],
    apiDetails: Array.isArray(src.apis) ? src.apis.map((api) => normalizeApiDetail(api && api.detail)) : [],
    executions: Array.isArray(src.executions) ? src.executions.slice(0, 2000).map(normalizeExecution) : [],
    executionDropped: Number(src.executionDropped) || 0,
    projectName,
    title
  };

  store.db.exec('BEGIN');
  let pruned = [];
  try {
    store.deleteSeries.run(id);
    store.deleteApis.run(id);
    store.insertReport.run(
      normalized.id,
      normalized.createdAt,
      normalized.startedAt,
      normalized.endedAt,
      normalized.status,
      normalized.config.users,
      normalized.config.durationMin,
      normalized.config.rampUpMin,
      normalized.recordCount,
      normalized.summary.total,
      normalized.summary.success,
      normalized.summary.failed,
      normalized.summary.failRate,
      normalized.summary.successRate,
      normalized.summary.rps,
      normalized.summary.avgLatencyMs,
      normalized.summary.p50LatencyMs,
      normalized.summary.p90LatencyMs,
      normalized.summary.p95LatencyMs,
      JSON.stringify(Object.assign({}, normalized.summary, {
        projectName: normalized.projectName,
        title: normalized.title,
        apiDetails: normalized.apiDetails,
        executions: normalized.executions,
        executionDropped: normalized.executionDropped
      }))
    );
    for (let i = 0; i < normalized.series.length; i += 1) {
      const point = normalized.series[i];
      store.insertSeries.run(
        id,
        point.ts,
        point.rps,
        point.avgLatencyMs,
        point.failRate,
        point.concurrentUsers
      );
    }
    for (let i = 0; i < normalized.apis.length; i += 1) {
      const api = normalized.apis[i];
      store.insertApi.run(
        id,
        api.method,
        api.name,
        api.url,
        api.path,
        api.total,
        api.success,
        api.failed,
        api.failRate,
        api.rps,
        api.avgLatencyMs,
        api.minLatencyMs,
        api.maxLatencyMs,
        api.p90LatencyMs
      );
    }
    pruned = pruneOldReports(store);
    store.db.exec('COMMIT');
  } catch (e) {
    try {
      store.db.exec('ROLLBACK');
    } catch (ignore) {
      // ignore
    }
    throw e;
  }

  syncReportToMysql(normalized);
  pruned.forEach((oldId) => deleteReportFromMysql(oldId));
  return getReport(id);
}

function listReports() {
  const store = openSqlite();
  return store.listReports.all().map(rowToSummary).filter(Boolean).map((report) => {
    delete report.apiDetails;
    delete report.executions;
    return report;
  });
}

function getReport(id) {
  const store = openSqlite();
  const row = store.getReport.get(String(id || ''));
  if (!row) return null;
  const base = rowToSummary(row);
  base.series = store.getSeries.all(base.id).map(mapSeries);
  base.apis = store.getApis.all(base.id).map(mapApi);
  base.apis.forEach((api, index) => {
    api.detail = base.apiDetails[index] || normalizeApiDetail();
  });
  delete base.apiDetails;
  return base;
}

function deleteReport(id) {
  const store = openSqlite();
  const key = String(id || '');
  if (!key) return false;
  const existed = !!store.getReport.get(key);
  if (!existed) return false;
  store.db.exec('BEGIN');
  try {
    store.deleteSeries.run(key);
    store.deleteApis.run(key);
    store.deleteReport.run(key);
    store.db.exec('COMMIT');
  } catch (e) {
    try {
      store.db.exec('ROLLBACK');
    } catch (ignore) {
      // ignore
    }
    throw e;
  }
  deleteReportFromMysql(key);
  return true;
}

module.exports = {
  MAX_REPORTS,
  saveReport,
  listReports,
  getReport,
  deleteReport,
  getMysqlSyncStatus
};
