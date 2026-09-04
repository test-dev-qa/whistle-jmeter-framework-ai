'use strict';

const { responseTransferSize } = require('./utils');

const TABLE = 'wje_records';

const MYSQL_EXTRA_COLUMNS = [
  ['request_headers', 'LONGTEXT NULL'],
  ['request_body', 'LONGTEXT NULL'],
  ['response_headers', 'LONGTEXT NULL'],
  ['response_body', 'LONGTEXT NULL'],
  ['response_body_size', 'BIGINT NULL'],
  ['duration_time', 'BIGINT NULL'],
  ['response_status', 'VARCHAR(16) NULL'],
  ['captured_time', 'DATETIME(3) NULL']
];

const SQLITE_EXTRA_COLUMNS = [
  ['request_headers', 'TEXT'],
  ['request_body', 'TEXT'],
  ['response_headers', 'TEXT'],
  ['response_body', 'TEXT'],
  ['response_body_size', 'INTEGER'],
  ['duration_time', 'INTEGER'],
  ['response_status', 'TEXT'],
  ['captured_time', 'TEXT']
];

const CREATE_SQL = [
  'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (',
  '  seq BIGINT NOT NULL AUTO_INCREMENT,',
  '  id VARCHAR(80) NOT NULL,',
  '  timestamp BIGINT NULL,',
  '  method VARCHAR(16) NULL,',
  '  url VARCHAR(2048) NULL,',
  '  request_headers LONGTEXT NULL,',
  '  request_body LONGTEXT NULL,',
  '  response_headers LONGTEXT NULL,',
  '  response_body LONGTEXT NULL,',
  '  response_body_size BIGINT NULL,',
  '  duration_time BIGINT NULL,',
  '  response_status VARCHAR(16) NULL,',
  '  captured_time DATETIME(3) NULL,',
  '  json LONGTEXT NOT NULL,',
  '  PRIMARY KEY (seq),',
  '  UNIQUE KEY uk_wje_id (id),',
  '  KEY idx_wje_ts (timestamp),',
  '  KEY idx_wje_status (response_status),',
  '  KEY idx_wje_captured (captured_time)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
].join('\n');

function stringifyHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return '{}';
  try {
    return JSON.stringify(headers);
  } catch (e) {
    return '{}';
  }
}

function toColumns(record) {
  const row = record || {};
  const ts = Number(row.timestamp);
  const timestamp = Number.isFinite(ts) && ts > 0 ? Math.trunc(ts) : Date.now();
  let duration = null;
  if (row.duration != null && row.duration !== '') {
    const n = Number(row.duration);
    if (Number.isFinite(n) && n >= 0) duration = Math.trunc(n);
  } else {
    const start = Number(row.reqStartTime);
    const end = Number(row.reqEndTime);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && start > 0) {
      duration = Math.trunc(end - start);
    }
  }
  const status = row.responseStatus;
  const responseStatus = status == null || status === '' ? null : String(status).slice(0, 16);
  const capturedTime = new Date(timestamp);
  const responseBody = row.responseBodyBinary
    ? ''
    : String(row.responseBody == null ? '' : row.responseBody);
  return {
    id: String(row.id || ''),
    timestamp,
    method: String(row.method || 'GET').slice(0, 16),
    url: String(row.url || '').slice(0, 2048),
    requestHeaders: stringifyHeaders(row.requestHeaders),
    requestBody: String(row.requestBody == null ? '' : row.requestBody),
    responseHeaders: stringifyHeaders(row.responseHeaders),
    responseBody,
    responseBodySize: responseTransferSize(row),
    duration,
    responseStatus,
    capturedTime,
    capturedTimeIso: Number.isFinite(capturedTime.getTime()) ? capturedTime.toISOString() : null,
    json: JSON.stringify(row)
  };
}

function toPoolConfig(conn) {
  if (!conn || typeof conn !== 'object') {
    throw new Error('请选择 MySQL 连接');
  }
  if (conn.type && conn.type !== 'mysql') {
    throw new Error('记录落盘仅支持 MySQL 连接');
  }
  const database = String(conn.database || '').trim();
  if (!database) {
    throw new Error('请填写数据库名');
  }
  return {
    host: String(conn.host || '127.0.0.1').trim() || '127.0.0.1',
    port: Number(conn.port) > 0 ? Math.trunc(Number(conn.port)) : 3306,
    user: String(conn.username || '').trim(),
    password: String(conn.password == null ? '' : conn.password),
    database,
    charset: 'utf8mb4',
    connectTimeout: 8000,
    waitForConnections: true,
    connectionLimit: 4
  };
}

function loadMysql2() {
  try {
    return require('mysql2/promise');
  } catch (e) {
    const err = new Error('未安装 mysql2，无法使用 MySQL 落盘');
    err.cause = e;
    throw err;
  }
}

async function renameMysqlCapturedAt(pool, have) {
  if (have.has('captured_time') || !have.has('captured_at')) return;
  await pool.query(
    'ALTER TABLE `' + TABLE + '` CHANGE COLUMN `captured_at` `captured_time` DATETIME(3) NULL'
  );
  have.delete('captured_at');
  have.add('captured_time');
}

async function renameMysqlDuration(pool, have) {
  if (have.has('duration_time') || !have.has('duration')) return;
  await pool.query(
    'ALTER TABLE `' + TABLE + '` CHANGE COLUMN `duration` `duration_time` BIGINT NULL'
  );
  have.delete('duration');
  have.add('duration_time');
}

async function ensureMysqlColumns(pool) {
  const [rows] = await pool.query(
    'SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [TABLE]
  );
  const have = new Set((rows || []).map((row) => String(row.name)));
  await renameMysqlCapturedAt(pool, have);
  await renameMysqlDuration(pool, have);
  for (let i = 0; i < MYSQL_EXTRA_COLUMNS.length; i += 1) {
    const name = MYSQL_EXTRA_COLUMNS[i][0];
    const def = MYSQL_EXTRA_COLUMNS[i][1];
    if (!have.has(name)) {
      await pool.query('ALTER TABLE `' + TABLE + '` ADD COLUMN `' + name + '` ' + def);
      have.add(name);
    }
  }
}

function renameSqliteCapturedAt(db, have) {
  if (have.has('captured_time') || !have.has('captured_at')) return;
  try {
    db.exec('ALTER TABLE records RENAME COLUMN captured_at TO captured_time');
    have.delete('captured_at');
    have.add('captured_time');
  } catch (e) {
    db.exec('ALTER TABLE records ADD COLUMN captured_time TEXT');
    db.exec('UPDATE records SET captured_time = captured_at WHERE captured_time IS NULL');
    have.add('captured_time');
  }
}

function renameSqliteDuration(db, have) {
  if (have.has('duration_time') || !have.has('duration')) return;
  try {
    db.exec('ALTER TABLE records RENAME COLUMN duration TO duration_time');
    have.delete('duration');
    have.add('duration_time');
  } catch (e) {
    db.exec('ALTER TABLE records ADD COLUMN duration_time INTEGER');
    db.exec('UPDATE records SET duration_time = duration WHERE duration_time IS NULL');
    have.add('duration_time');
  }
}

function ensureSqliteColumns(db) {
  const info = db.prepare('PRAGMA table_info(records)').all();
  const have = new Set((info || []).map((row) => String(row.name)));
  renameSqliteCapturedAt(db, have);
  renameSqliteDuration(db, have);
  SQLITE_EXTRA_COLUMNS.forEach((item) => {
    const name = item[0];
    const def = item[1];
    if (!have.has(name)) {
      db.exec('ALTER TABLE records ADD COLUMN ' + name + ' ' + def);
      have.add(name);
    }
  });
}

function backfillSqliteColumns(db) {
  let pending;
  try {
    pending = db.prepare(
      'SELECT id, json FROM records WHERE (request_headers IS NULL OR response_body IS NULL) AND json IS NOT NULL'
    ).all();
  } catch (e) {
    return 0;
  }
  if (!pending || !pending.length) return 0;
  const upd = db.prepare(
    'UPDATE records SET request_headers=?, request_body=?, response_headers=?, response_body=?, ' +
      'response_body_size=?, duration_time=?, response_status=?, captured_time=? WHERE id=?'
  );
  db.exec('BEGIN');
  try {
    pending.forEach((row) => {
      let rec;
      try {
        rec = JSON.parse(row.json);
      } catch (e) {
        return;
      }
      const col = toColumns(rec);
      upd.run(
        col.requestHeaders,
        col.requestBody,
        col.responseHeaders,
        col.responseBody,
        col.responseBodySize,
        col.duration,
        col.responseStatus,
        col.capturedTimeIso,
        row.id
      );
    });
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch (err) {
      // ignore
    }
    throw e;
  }
  return pending.length;
}

async function backfillMysqlColumns(pool) {
  const [rows] = await pool.query(
    'SELECT id, json FROM `' + TABLE + '` WHERE (request_headers IS NULL OR response_body IS NULL) AND json IS NOT NULL'
  );
  const list = rows || [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    try {
      const rec = JSON.parse(row.json);
      const col = toColumns(rec);
      await pool.query(
        'UPDATE `' + TABLE + '` SET request_headers=?, request_body=?, response_headers=?, response_body=?, ' +
          'response_body_size=?, duration_time=?, response_status=?, captured_time=? WHERE id=?',
        [
          col.requestHeaders,
          col.requestBody,
          col.responseHeaders,
          col.responseBody,
          col.responseBodySize,
          col.duration,
          col.responseStatus,
          col.capturedTime,
          row.id
        ]
      );
    } catch (e) {
      // skip broken row
    }
  }
  return list.length;
}

async function connect(conn) {
  const mysql = loadMysql2();
  const pool = mysql.createPool(toPoolConfig(conn));
  await pool.query(CREATE_SQL);
  await ensureMysqlColumns(pool);
  try {
    await backfillMysqlColumns(pool);
  } catch (e) {
    // keep mysql even if old rows cannot be backfilled
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
    'INSERT INTO `' + TABLE + '` (id, timestamp, method, url, request_headers, request_body, ' +
      'response_headers, response_body, response_body_size, duration_time, response_status, captured_time, json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE timestamp=VALUES(timestamp), method=VALUES(method), url=VALUES(url), ' +
      'request_headers=VALUES(request_headers), request_body=VALUES(request_body), ' +
      'response_headers=VALUES(response_headers), response_body=VALUES(response_body), ' +
      'response_body_size=VALUES(response_body_size), duration_time=VALUES(duration_time), ' +
      'response_status=VALUES(response_status), captured_time=VALUES(captured_time), json=VALUES(json)',
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
  await pool.query('DELETE FROM `' + TABLE + '` WHERE id IN (?)', [list]);
  return list.length;
}

async function clear(pool) {
  await pool.query('DELETE FROM `' + TABLE + '`');
}

async function loadById(pool, id) {
  const [rows] = await pool.query('SELECT json FROM `' + TABLE + '` WHERE id = ? LIMIT 1', [String(id)]);
  const row = rows && rows[0];
  if (!row || row.json == null) return null;
  try {
    return JSON.parse(row.json);
  } catch (e) {
    return null;
  }
}

async function loadAll(pool) {
  const [rows] = await pool.query('SELECT json FROM `' + TABLE + '` ORDER BY seq ASC');
  return (rows || []).map((row) => {
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
  const [countRows] = await pool.query('SELECT COUNT(*) AS c FROM `' + TABLE + '`');
  const total = Number(countRows && countRows[0] && countRows[0].c) || 0;
  if (total <= max) return [];
  const n = total - max;
  const [oldest] = await pool.query('SELECT id FROM `' + TABLE + '` ORDER BY seq ASC LIMIT ?', [n]);
  const ids = (oldest || []).map((row) => String(row.id));
  if (ids.length) await remove(pool, ids);
  return ids;
}

async function close(pool) {
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
}

function formatProbeError(err) {
  if (!err) return '连接失败';
  const code = String(err.code || '');
  const errno = Number(err.errno);
  if (code === 'ETIMEDOUT' || code === 'PROTOCOL_CONNECTION_LOST') return '连接超时';
  if (code === 'ECONNREFUSED') return '连接被拒绝（主机或端口不可达）';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '主机名无法解析';
  if (code === 'ER_ACCESS_DENIED_ERROR' || errno === 1045) return '账号或密码错误';
  if (code === 'ER_BAD_DB_ERROR' || errno === 1049) return '数据库不存在';
  if (code === 'ER_DBACCESS_DENIED_ERROR' || errno === 1044) return '无权访问该数据库';
  const msg = String(err.message || '').trim();
  return msg || '连接失败';
}

/** 用账号密码探测 MySQL；database 可选。成功返回 { ok, host, port, database, user } */
async function probe(conn, timeoutMs) {
  if (!conn || typeof conn !== 'object') {
    return { ok: false, error: '请填写连接信息', mode: 'mysql' };
  }
  if (conn.type && conn.type !== 'mysql') {
    return { ok: false, error: '仅支持 MySQL 探测', mode: 'mysql' };
  }
  const host = String(conn.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(conn.port) > 0 ? Math.trunc(Number(conn.port)) : 3306;
  const user = String(conn.username || '').trim();
  const password = String(conn.password == null ? '' : conn.password);
  const database = String(conn.database || '').trim();
  const ms = Number(timeoutMs) > 0 ? Math.trunc(Number(timeoutMs)) : 8000;
  let mysql;
  try {
    mysql = loadMysql2();
  } catch (e) {
    return { ok: false, error: e.message || '未安装 mysql2', mode: 'mysql' };
  }
  const cfg = {
    host,
    port,
    user,
    password,
    charset: 'utf8mb4',
    connectTimeout: ms
  };
  if (database) cfg.database = database;
  let client;
  try {
    client = await mysql.createConnection(cfg);
    await client.ping();
    return {
      ok: true,
      mode: 'mysql',
      host,
      port,
      database,
      user,
      error: ''
    };
  } catch (e) {
    return {
      ok: false,
      mode: 'mysql',
      host,
      port,
      database,
      user,
      error: formatProbeError(e)
    };
  } finally {
    if (client) {
      try {
        await client.end();
      } catch (e) {
        // ignore
      }
    }
  }
}

function isReadOnlySql(sql) {
  const text = String(sql || '').replace(/^\s*\/\*[\s\S]*?\*\//, '').trim();
  return /^(select|with|show|desc|describe|explain)\b/i.test(text);
}

const PREVIEW_DEFAULT_LIMIT = 50;
const PREVIEW_MAX_LIMIT = 200;
const PREVIEW_QUERY_TIMEOUT_MS = 15000;
const PREVIEW_FIELD_MAX_CHARS = 4096;

function stripTrailingSemicolon(sql) {
  return String(sql || '').trim().replace(/;\s*$/, '');
}

function hasLimitClause(sql) {
  return /\blimit\s+\d+/i.test(String(sql || ''));
}

/** 预览查询在 SQL 层追加 LIMIT，避免全表扫描/传输导致超时 */
function withPreviewLimit(sql, limit) {
  const text = stripTrailingSemicolon(sql);
  const n = Number(limit) > 0 ? Math.min(Math.trunc(Number(limit)), PREVIEW_MAX_LIMIT) : PREVIEW_DEFAULT_LIMIT;
  if (hasLimitClause(text)) return { sql: text, limit: n, limitedAtSql: false };
  return { sql: `${text} LIMIT ${n}`, limit: n, limitedAtSql: true };
}

function shrinkPreviewValue(val) {
  if (val == null) return val;
  if (typeof val === 'string') {
    return val.length > PREVIEW_FIELD_MAX_CHARS
      ? `${val.slice(0, PREVIEW_FIELD_MAX_CHARS)}…`
      : val;
  }
  if (val instanceof Date) return val.toISOString();
  if (Buffer.isBuffer(val)) {
    const text = val.toString('utf8');
    return text.length > PREVIEW_FIELD_MAX_CHARS
      ? `${text.slice(0, PREVIEW_FIELD_MAX_CHARS)}…`
      : text;
  }
  if (typeof val === 'bigint') return val.toString();
  return val;
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

/** 列出 MySQL 实例上的数据库名 */
async function listDatabases(conn) {
  if (!conn || typeof conn !== 'object') {
    throw new Error('请选择数据库连接');
  }
  if (conn.type && conn.type !== 'mysql') {
    throw new Error('仅支持 MySQL');
  }
  const mysql = loadMysql2();
  const cfg = {
    host: String(conn.host || '127.0.0.1').trim() || '127.0.0.1',
    port: Number(conn.port) > 0 ? Math.trunc(Number(conn.port)) : 3306,
    user: String(conn.username || '').trim(),
    password: String(conn.password == null ? '' : conn.password),
    charset: 'utf8mb4',
    connectTimeout: 8000
  };
  let client;
  try {
    client = await mysql.createConnection(cfg);
    const [rows] = await client.query('SHOW DATABASES');
    return (rows || [])
      .map((row) => String(row.Database || row.database || '').trim())
      .filter(Boolean);
  } catch (e) {
    const err = new Error(formatProbeError(e));
    err.cause = e;
    throw err;
  } finally {
    if (client) {
      try {
        await client.end();
      } catch (e) {
        // ignore
      }
    }
  }
}

/** 执行只读 SQL，返回数组格式结果（最多 limit 行） */
async function executeQuery(conn, sql, options) {
  if (!conn || typeof conn !== 'object') {
    throw new Error('请选择数据库连接');
  }
  if (conn.type && conn.type !== 'mysql') {
    throw new Error('SQL 预览仅支持 MySQL');
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
  const timeoutMs = Number(options && options.timeoutMs) > 0
    ? Math.trunc(Number(options.timeoutMs))
    : PREVIEW_QUERY_TIMEOUT_MS;
  const limited = withPreviewLimit(text, limit);
  const mysql = loadMysql2();
  let client;
  try {
    client = await mysql.createConnection(Object.assign({}, toPoolConfig(Object.assign({}, conn, { database })), {
      connectTimeout: 8000
    }));
    const [rows] = await client.query({
      sql: limited.sql,
      timeout: timeoutMs
    });
    const plain = toPlainRows(rows);
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
    const code = String(e && e.code || '');
    if (code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
      const err = new Error('查询超时，请缩小结果集或添加 LIMIT');
      err.cause = e;
      throw err;
    }
    const err = new Error(formatProbeError(e));
    err.cause = e;
    throw err;
  } finally {
    if (client) {
      try {
        await client.end();
      } catch (e) {
        // ignore
      }
    }
  }
}

module.exports = {
  TABLE,
  CREATE_SQL,
  MYSQL_EXTRA_COLUMNS,
  SQLITE_EXTRA_COLUMNS,
  toColumns,
  toPoolConfig,
  ensureSqliteColumns,
  backfillSqliteColumns,
  backfillMysqlColumns,
  connect,
  ping,
  probe,
  formatProbeError,
  isReadOnlySql,
  withPreviewLimit,
  listDatabases,
  executeQuery,
  insert,
  remove,
  clear,
  loadById,
  loadAll,
  trimOldest,
  close
};
