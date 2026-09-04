'use strict';

const extractVars = require('./extractVars');
const assertions = require('./assertions');
const dbOps = require('./dbOps');
const { getConnection } = require('./dbConnections');
const { toPoolConfig } = require('./mysqlStore');
const { extractJsonPath, stringifyValue } = require('./jsonPath');
const { correlateTokens } = require('./tokenCorrelate');

const MAX_CAPTURE_BODY = 512 * 1024;

function applyVars(text, vars) {
  if (text == null) return text;
  const map = vars && typeof vars === 'object' ? vars : {};
  let out = String(text);
  out = out.replace(/\$\{([A-Za-z_][\w]*)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(map, name) ? String(map[name]) : match
  ));
  out = out.replace(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(map, name) ? String(map[name]) : match
  ));
  return out;
}

function applyRequestVars(tpl, vars) {
  const headers = {};
  Object.keys(tpl.headers || {}).forEach((key) => {
    headers[key] = applyVars(tpl.headers[key], vars);
  });
  let url = tpl.url;
  try {
    const u = new URL(tpl.url);
    const pathTpl = tpl.pathTemplate != null ? tpl.pathTemplate : (u.pathname + u.search);
    url = u.origin + applyVars(pathTpl, vars);
  } catch (e) {
    url = applyVars(tpl.url, vars);
  }
  return {
    method: tpl.method,
    name: tpl.name,
    url,
    path: tpl.path,
    headers,
    body: tpl.body != null ? applyVars(tpl.body, vars) : tpl.body,
    id: tpl.id
  };
}

function summarizePostOps(requests) {
  let extracts = 0;
  let asserts = 0;
  let dbops = 0;
  (requests || []).forEach((req) => {
    extracts += (req.extracts || []).length;
    asserts += (req.asserts || []).length;
    dbops += (req.dbOps || []).length;
  });
  return {
    extracts,
    asserts,
    dbops,
    enabled: extracts + asserts + dbops > 0
  };
}

function attachPostOps(records, builtRequests) {
  const list = Array.isArray(records) ? records : [];
  const requests = Array.isArray(builtRequests) ? builtRequests : [];
  const ids = list.map((r) => r && r.id);
  const manuals = extractVars.getExtractorsForRecords(ids);
  const assertLists = assertions.getAssertionsForRecords(ids);
  const dbLists = dbOps.getDbOpsForRecords(ids);
  const hasManualExtract = manuals.some((items) => items && items.length);

  let plans = null;
  if (hasManualExtract) {
    try {
      plans = correlateTokens(list, {
        manualExtractors: manuals,
        autoCorrelate: false
      });
    } catch (e) {
      plans = null;
    }
  }

  for (let i = 0; i < requests.length; i += 1) {
    const req = requests[i];
    const plan = plans && plans[i];
    if (plan) {
      if (plan.headers && typeof plan.headers === 'object') {
        const headers = {};
        Object.keys(plan.headers).forEach((key) => {
          if (String(key).toLowerCase() === 'content-length') return;
          if (String(key).toLowerCase() === 'host') return;
          headers[key] = plan.headers[key];
        });
        req.headers = headers;
      }
      if (plan.body != null && plan.body !== '') req.body = String(plan.body);
      if (plan.path) {
        req.pathTemplate = String(plan.path);
        try {
          const u = new URL(req.url);
          req.url = u.origin + plan.path;
          req.path = plan.path;
        } catch (e) {
          // keep original url
        }
      }
    } else {
      try {
        const u = new URL(req.url);
        req.pathTemplate = u.pathname + u.search;
      } catch (e) {
        req.pathTemplate = req.path || '';
      }
    }
    req.extracts = manuals[i] || [];
    req.asserts = assertLists[i] || [];
    req.dbOps = dbLists[i] || [];
    req.needCapture = req.extracts.length > 0 || req.asserts.length > 0 || req.dbOps.length > 0;
    req.statsKey = `${req.method} ${req.url}`;
  }
  return summarizePostOps(requests);
}

function normalizeResponseHeaders(headers) {
  const src = headers && typeof headers === 'object' ? headers : {};
  const out = {};
  Object.keys(src).forEach((key) => {
    const val = src[key];
    out[key] = Array.isArray(val) ? val.join(', ') : val;
  });
  return out;
}

async function getMysqlPool(state, conn) {
  if (!state.dbPools) state.dbPools = new Map();
  const key = String(conn.id || '');
  if (state.dbPools.has(key)) return state.dbPools.get(key);
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool(Object.assign({}, toPoolConfig(conn), {
    waitForConnections: true,
    connectionLimit: 8,
    queueLimit: 200,
    enableKeepAlive: true
  }));
  state.dbPools.set(key, pool);
  return pool;
}

async function closeDbPools(state) {
  if (!state || !state.dbPools) return;
  const pools = Array.from(state.dbPools.values());
  state.dbPools.clear();
  await Promise.all(pools.map(async (pool) => {
    try {
      await pool.end();
    } catch (e) {
      // ignore
    }
  }));
}

async function runDbOp(op, vars, state) {
  const conn = getConnection(op.connectionId);
  if (!conn) throw new Error(`数据库连接不存在: ${op.connectionId || ''}`);
  if (conn.type !== 'mysql') throw new Error('压测后置 SQL 仅支持 MySQL');
  if (!conn.database) throw new Error(`连接 ${conn.name || conn.id} 未配置数据库名`);
  let sql = applyVars(String(op.sql || ''), vars).trim();
  if (!sql) throw new Error('SQL 为空');
  if (/\$\{[A-Za-z_][\w]*\}/.test(sql) || /\{\{[A-Za-z_][\w]*\}\}/.test(sql)) {
    throw new Error(`SQL 仍有未解析变量: ${sql.slice(0, 120)}`);
  }
  const pool = await getMysqlPool(state, conn);
  const started = Date.now();
  const [rows] = await pool.query({ sql, timeout: 15000 });
  const latencyMs = Date.now() - started;
  const plain = Array.isArray(rows)
    ? rows.map((row) => (row && typeof row === 'object' ? Object.assign({}, row) : row))
    : [];
  (op.extracts || []).forEach((ext) => {
    if (!ext || !ext.varName) return;
    const result = extractJsonPath(JSON.stringify(plain), ext.jsonPath || '$[0]', {});
    if (result.ok && result.values && result.values.length) {
      vars[ext.varName] = stringifyValue(result.values[0]);
    }
  });
  return { ok: true, latencyMs };
}

async function runPostOps(tpl, sample, vars, state) {
  if (!tpl || !tpl.needCapture) return { ok: true, dbLatencies: [] };
  const record = {
    responseBody: sample.body || '',
    responseHeaders: normalizeResponseHeaders(sample.headers),
    responseStatus: sample.status
  };

  for (let i = 0; i < (tpl.extracts || []).length; i += 1) {
    const item = tpl.extracts[i];
    if (!item || item.enabled === false) continue;
    const result = extractVars.resolveItemValue(record, item);
    if (result.ok && result.values && result.values.length) {
      vars[item.varName] = stringifyValue(result.values[0]);
    }
  }

  const dbLatencies = [];
  for (let i = 0; i < (tpl.dbOps || []).length; i += 1) {
    const op = tpl.dbOps[i];
    if (!op || op.enabled === false) continue;
    try {
      const dbRes = await runDbOp(op, vars, state);
      dbLatencies.push(Math.max(0, Number(dbRes && dbRes.latencyMs) || 0));
    } catch (e) {
      return {
        ok: false,
        error: `数据库后置失败(${op.name || op.id || i + 1}): ${e && e.message ? e.message : e}`,
        dbLatencies
      };
    }
  }

  for (let i = 0; i < (tpl.asserts || []).length; i += 1) {
    const item = tpl.asserts[i];
    if (!item || item.enabled === false) continue;
    const ev = assertions.evaluateAssertion(record, item);
    if (!ev.passed) {
      const label = item.name || item.jsonPath || item.headerName || item.source || 'assert';
      return {
        ok: false,
        error: `断言失败(${label}): 实际=${ev.actual == null ? '' : ev.actual} 期望=${item.operator} ${item.expected || ''}`,
        dbLatencies
      };
    }
  }
  return { ok: true, dbLatencies };
}

module.exports = {
  MAX_CAPTURE_BODY,
  applyVars,
  applyRequestVars,
  attachPostOps,
  summarizePostOps,
  runPostOps,
  closeDbPools
};
