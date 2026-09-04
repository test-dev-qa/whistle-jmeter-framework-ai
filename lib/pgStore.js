'use strict';

const {
  isReadOnlySql,
  withPreviewLimit,
  formatProbeError
} = require('./mysqlStore');

const PREVIEW_DEFAULT_LIMIT = 50;
const PREVIEW_MAX_LIMIT = 200;
const PREVIEW_QUERY_TIMEOUT_MS = 15000;
const PREVIEW_FIELD_MAX_CHARS = 4096;

function loadPg() {
  try {
    return require('pg');
  } catch (e) {
    const err = new Error('未安装 pg 模块，请在本插件目录执行 npm install');
    err.cause = e;
    throw err;
  }
}

function shrinkPreviewValue(val) {
  if (val == null) return val;
  if (typeof val === 'string') {
    return val.length > PREVIEW_FIELD_MAX_CHARS
      ? `${val.slice(0, PREVIEW_FIELD_MAX_CHARS)}…`
      : val;
  }
  if (Buffer.isBuffer(val)) {
    const text = val.toString('utf8');
    return text.length > PREVIEW_FIELD_MAX_CHARS
      ? `${text.slice(0, PREVIEW_FIELD_MAX_CHARS)}…`
      : text;
  }
  if (typeof val === 'object') return val;
  return String(val);
}

function toPlainRows(rows) {
  if (!Array.isArray(rows)) return [shrinkPreviewValue(rows)];
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return shrinkPreviewValue(row);
    const out = {};
    Object.keys(row).forEach((key) => {
      out[key] = shrinkPreviewValue(row[key]);
    });
    return out;
  });
}

function pgConfig(conn, database) {
  return {
    host: String(conn.host || '127.0.0.1').trim() || '127.0.0.1',
    port: Number(conn.port) > 0 ? Math.trunc(Number(conn.port)) : 5432,
    user: String(conn.username || '').trim(),
    password: String(conn.password == null ? '' : conn.password),
    database: String(database || conn.database || '').trim(),
    connectionTimeoutMillis: 8000,
    query_timeout: PREVIEW_QUERY_TIMEOUT_MS,
    statement_timeout: PREVIEW_QUERY_TIMEOUT_MS
  };
}

async function listDatabases(conn) {
  if (!conn || conn.type !== 'postgres') {
    throw new Error('仅支持 PostgreSQL');
  }
  const { Client } = loadPg();
  const client = new Client(pgConfig(conn, 'postgres'));
  try {
    await client.connect();
    const result = await client.query(
      'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname'
    );
    return (result.rows || [])
      .map((row) => String(row.datname || '').trim())
      .filter(Boolean);
  } catch (e) {
    const err = new Error(formatProbeError(e));
    err.cause = e;
    throw err;
  } finally {
    try {
      await client.end();
    } catch (err) {
      // ignore
    }
  }
}

async function executeQuery(conn, sql, options) {
  if (!conn || conn.type !== 'postgres') {
    throw new Error('SQL 预览仅支持 PostgreSQL');
  }
  const database = String((options && options.database) || conn.database || '').trim();
  if (!database) throw new Error('请选择数据库');
  const text = String(sql || '').trim();
  if (!text) throw new Error('请填写 SQL 命令');
  if (!isReadOnlySql(text)) {
    throw new Error('预览仅支持查询类 SQL（SELECT / WITH / SHOW / DESC / EXPLAIN）');
  }
  const limit = Number(options && options.limit) > 0
    ? Math.min(Math.trunc(Number(options.limit)), PREVIEW_MAX_LIMIT)
    : PREVIEW_DEFAULT_LIMIT;
  const limited = withPreviewLimit(text, limit);
  const { Client } = loadPg();
  const client = new Client(pgConfig(conn, database));
  try {
    await client.connect();
    const result = await client.query(limited.sql);
    const plain = toPlainRows(result.rows);
    return {
      rows: plain,
      total: plain.length,
      truncated: limited.limitedAtSql ? plain.length >= limited.limit : false,
      database,
      previewLimit: limited.limit,
      limitedAtSql: limited.limitedAtSql,
      sqlExecuted: limited.sql
    };
  } catch (e) {
    const err = new Error(formatProbeError(e));
    err.cause = e;
    throw err;
  } finally {
    try {
      await client.end();
    } catch (err) {
      // ignore
    }
  }
}

module.exports = {
  listDatabases,
  executeQuery
};
