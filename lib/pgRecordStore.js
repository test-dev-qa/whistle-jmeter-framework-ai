'use strict';

const { toColumns, formatProbeError } = require('./mysqlStore');

const TABLE = 'wje_records';

const CREATE_STATEMENTS = [
  [
    'CREATE TABLE IF NOT EXISTS ' + TABLE + ' (',
    '  seq BIGSERIAL PRIMARY KEY,',
    '  id VARCHAR(80) NOT NULL UNIQUE,',
    '  timestamp BIGINT,',
    '  method VARCHAR(16),',
    '  url VARCHAR(2048),',
    '  request_headers TEXT,',
    '  request_body TEXT,',
    '  response_headers TEXT,',
    '  response_body TEXT,',
    '  response_body_size BIGINT,',
    '  duration_time BIGINT,',
    '  response_status VARCHAR(16),',
    '  captured_time TIMESTAMPTZ,',
    '  json TEXT NOT NULL',
    ')'
  ].join('\n'),
  'CREATE INDEX IF NOT EXISTS idx_wje_records_ts ON ' + TABLE + ' (timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_wje_records_status ON ' + TABLE + ' (response_status)'
];

function loadPg() {
  try {
    return require('pg');
  } catch (e) {
    const err = new Error('未安装 pg 模块，请在本插件目录执行 npm install');
    err.cause = e;
    throw err;
  }
}

function toPoolConfig(conn) {
  if (!conn || typeof conn !== 'object') {
    throw new Error('请选择 PostgreSQL 连接');
  }
  if (conn.type && conn.type !== 'postgres') {
    throw new Error('记录落盘仅支持 PostgreSQL 连接');
  }
  const database = String(conn.database || '').trim();
  if (!database) {
    throw new Error('请填写数据库名');
  }
  return {
    host: String(conn.host || '127.0.0.1').trim() || '127.0.0.1',
    port: Number(conn.port) > 0 ? Math.trunc(Number(conn.port)) : 5432,
    user: String(conn.username || '').trim(),
    password: String(conn.password == null ? '' : conn.password),
    database,
    max: 4,
    connectionTimeoutMillis: 8000
  };
}

async function connect(conn) {
  const { Pool } = loadPg();
  const pool = new Pool(toPoolConfig(conn));
  for (let i = 0; i < CREATE_STATEMENTS.length; i += 1) {
    await pool.query(CREATE_STATEMENTS[i]);
  }
  return pool;
}

async function ping(pool) {
  await pool.query('SELECT 1');
  return true;
}

async function insert(pool, record) {
  const col = toColumns(record);
  await pool.query(
    'INSERT INTO ' + TABLE + ' (id, timestamp, method, url, request_headers, request_body, ' +
      'response_headers, response_body, response_body_size, duration_time, response_status, captured_time, json) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ' +
      'ON CONFLICT (id) DO UPDATE SET timestamp=EXCLUDED.timestamp, method=EXCLUDED.method, url=EXCLUDED.url, ' +
      'request_headers=EXCLUDED.request_headers, request_body=EXCLUDED.request_body, ' +
      'response_headers=EXCLUDED.response_headers, response_body=EXCLUDED.response_body, ' +
      'response_body_size=EXCLUDED.response_body_size, duration_time=EXCLUDED.duration_time, ' +
      'response_status=EXCLUDED.response_status, captured_time=EXCLUDED.captured_time, json=EXCLUDED.json',
    [
      col.id,
      col.timestamp,
      col.method,
      col.url,
      col.requestHeaders,
      col.requestBody,
      col.responseHeaders,
      col.responseBody,
      col.responseBodySize,
      col.duration,
      col.responseStatus,
      col.capturedTime,
      col.json
    ]
  );
}

async function remove(pool, ids) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return 0;
  await pool.query('DELETE FROM ' + TABLE + ' WHERE id = ANY($1)', [list]);
  return list.length;
}

async function clear(pool) {
  await pool.query('DELETE FROM ' + TABLE);
}

async function loadById(pool, id) {
  const result = await pool.query('SELECT json FROM ' + TABLE + ' WHERE id = $1 LIMIT 1', [String(id)]);
  const row = result.rows && result.rows[0];
  if (!row || row.json == null) return null;
  try {
    return JSON.parse(row.json);
  } catch (e) {
    return null;
  }
}

async function loadAll(pool) {
  const result = await pool.query('SELECT json FROM ' + TABLE + ' ORDER BY seq ASC');
  return (result.rows || []).map((row) => {
    try {
      return JSON.parse(row.json);
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

async function trimOldest(pool, maxRecords) {
  const max = Number(maxRecords) > 0 ? Math.trunc(Number(maxRecords)) : 0;
  if (!max) return [];
  const countResult = await pool.query('SELECT COUNT(*)::int AS c FROM ' + TABLE);
  const total = Number(countResult.rows && countResult.rows[0] && countResult.rows[0].c) || 0;
  if (total <= max) return [];
  const n = total - max;
  const oldest = await pool.query(
    'SELECT id FROM ' + TABLE + ' ORDER BY seq ASC LIMIT $1',
    [n]
  );
  const ids = (oldest.rows || []).map((row) => String(row.id));
  if (ids.length) await remove(pool, ids);
  return ids;
}

async function close(pool) {
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
}

async function probe(conn, timeoutMs) {
  if (!conn || typeof conn !== 'object') {
    return { ok: false, error: '请填写连接信息', mode: 'postgres' };
  }
  if (conn.type && conn.type !== 'postgres') {
    return { ok: false, error: '仅支持 PostgreSQL 探测', mode: 'postgres' };
  }
  const host = String(conn.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(conn.port) > 0 ? Math.trunc(Number(conn.port)) : 5432;
  const user = String(conn.username || '').trim();
  const password = String(conn.password == null ? '' : conn.password);
  const database = String(conn.database || '').trim();
  const ms = Number(timeoutMs) > 0 ? Math.trunc(Number(timeoutMs)) : 8000;
  let Client;
  try {
    Client = loadPg().Client;
  } catch (e) {
    return { ok: false, error: e.message || '未安装 pg', mode: 'postgres' };
  }
  const client = new Client({
    host,
    port,
    user,
    password,
    database: database || 'postgres',
    connectionTimeoutMillis: ms
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { ok: true, mode: 'postgres', host, port, database, user, error: '' };
  } catch (e) {
    return {
      ok: false,
      mode: 'postgres',
      host,
      port,
      database,
      user,
      error: formatProbeError(e)
    };
  } finally {
    try {
      await client.end();
    } catch (err) {
      // ignore
    }
  }
}

module.exports = {
  connect,
  ping,
  insert,
  remove,
  clear,
  loadById,
  loadAll,
  trimOldest,
  close,
  probe,
  toPoolConfig
};
