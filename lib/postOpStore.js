'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { toPoolConfig } = require('./mysqlStore');

const DB_FILE = path.join(DATA_DIR, 'postOps.sqlite');

const SQLITE_DDL = [
  'CREATE TABLE IF NOT EXISTS wje_extract_vars (',
  '  id TEXT PRIMARY KEY NOT NULL,',
  '  record_id TEXT NOT NULL,',
  '  var_name TEXT,',
  '  source TEXT,',
  '  method TEXT,',
  '  json_path TEXT,',
  '  header_name TEXT,',
  '  array_unpack INTEGER,',
  '  enabled INTEGER,',
  '  sort_order INTEGER,',
  '  updated_at TEXT',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_wje_extract_record ON wje_extract_vars(record_id);',
  'CREATE TABLE IF NOT EXISTS wje_assertions (',
  '  id TEXT PRIMARY KEY NOT NULL,',
  '  record_id TEXT NOT NULL,',
  '  name TEXT,',
  '  source TEXT,',
  '  json_path TEXT,',
  '  header_name TEXT,',
  '  array_unpack INTEGER,',
  '  operator TEXT,',
  '  expected TEXT,',
  '  enabled INTEGER,',
  '  sort_order INTEGER,',
  '  updated_at TEXT',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_wje_assert_record ON wje_assertions(record_id);',
  'CREATE TABLE IF NOT EXISTS wje_db_ops (',
  '  id TEXT PRIMARY KEY NOT NULL,',
  '  record_id TEXT NOT NULL,',
  '  name TEXT,',
  '  connection_id TEXT,',
  '  sql TEXT,',
  '  enabled INTEGER,',
  '  sort_order INTEGER,',
  '  updated_at TEXT',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_wje_dbop_record ON wje_db_ops(record_id);',
  'CREATE TABLE IF NOT EXISTS wje_db_op_extracts (',
  '  id TEXT PRIMARY KEY NOT NULL,',
  '  op_id TEXT NOT NULL,',
  '  record_id TEXT NOT NULL,',
  '  var_name TEXT,',
  '  json_path TEXT,',
  '  sort_order INTEGER',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_wje_dbopx_op ON wje_db_op_extracts(op_id);',
  'CREATE INDEX IF NOT EXISTS idx_wje_dbopx_record ON wje_db_op_extracts(record_id);'
].join('\n');

const MYSQL_DDL = [
  [
    'CREATE TABLE IF NOT EXISTS `wje_extract_vars` (',
    '  id VARCHAR(80) NOT NULL,',
    '  record_id VARCHAR(80) NOT NULL,',
    '  var_name VARCHAR(60) NULL,',
    '  source VARCHAR(16) NULL,',
    '  method VARCHAR(16) NULL,',
    '  json_path TEXT NULL,',
    '  header_name VARCHAR(120) NULL,',
    '  array_unpack TINYINT NULL,',
    '  enabled TINYINT NULL,',
    '  sort_order INT NULL,',
    '  updated_at DATETIME(3) NULL,',
    '  PRIMARY KEY (id),',
    '  KEY idx_wje_extract_record (record_id)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ].join('\n'),
  [
    'CREATE TABLE IF NOT EXISTS `wje_assertions` (',
    '  id VARCHAR(80) NOT NULL,',
    '  record_id VARCHAR(80) NOT NULL,',
    '  name VARCHAR(80) NULL,',
    '  source VARCHAR(16) NULL,',
    '  json_path TEXT NULL,',
    '  header_name VARCHAR(120) NULL,',
    '  array_unpack TINYINT NULL,',
    '  operator VARCHAR(16) NULL,',
    '  expected TEXT NULL,',
    '  enabled TINYINT NULL,',
    '  sort_order INT NULL,',
    '  updated_at DATETIME(3) NULL,',
    '  PRIMARY KEY (id),',
    '  KEY idx_wje_assert_record (record_id)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ].join('\n'),
  [
    'CREATE TABLE IF NOT EXISTS `wje_db_ops` (',
    '  id VARCHAR(80) NOT NULL,',
    '  record_id VARCHAR(80) NOT NULL,',
    '  name VARCHAR(80) NULL,',
    '  connection_id VARCHAR(80) NULL,',
    '  sql_text LONGTEXT NULL,',
    '  enabled TINYINT NULL,',
    '  sort_order INT NULL,',
    '  updated_at DATETIME(3) NULL,',
    '  PRIMARY KEY (id),',
    '  KEY idx_wje_dbop_record (record_id)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ].join('\n'),
  [
    'CREATE TABLE IF NOT EXISTS `wje_db_op_extracts` (',
    '  id VARCHAR(80) NOT NULL,',
    '  op_id VARCHAR(80) NOT NULL,',
    '  record_id VARCHAR(80) NOT NULL,',
    '  var_name VARCHAR(60) NULL,',
    '  json_path TEXT NULL,',
    '  sort_order INT NULL,',
    '  PRIMARY KEY (id),',
    '  KEY idx_wje_dbopx_op (op_id),',
    '  KEY idx_wje_dbopx_record (record_id)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  ].join('\n')
];

let sqlite = null;
let mysqlQueue = Promise.resolve();
let lastMysql = { mysql: false, skipped: true, mysqlDatabase: '', mysqlError: '' };

function mysqlResult(partial) {
  lastMysql = Object.assign({ mysql: false, skipped: false, mysqlDatabase: '', mysqlError: '' }, partial || {});
  return lastMysql;
}

function flag(value) {
  return value ? 1 : 0;
}

function unflag(value) {
  return value === 1 || value === true || value === '1';
}

function nowIso() {
  return new Date().toISOString();
}

function groupByRecord(rows, mapRow) {
  const out = {};
  (rows || []).forEach((row) => {
    const item = mapRow(row);
    if (!item || !row.record_id) return;
    const key = String(row.record_id);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  });
  return out;
}

function openSqlite() {
  if (sqlite) return sqlite;
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(SQLITE_DDL);
  sqlite = {
    db,
    extractDelete: db.prepare('DELETE FROM wje_extract_vars WHERE record_id = ?'),
    extractClear: db.prepare('DELETE FROM wje_extract_vars'),
    extractInsert: db.prepare(
      'INSERT INTO wje_extract_vars (id, record_id, var_name, source, method, json_path, header_name, array_unpack, enabled, sort_order, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    extractAll: db.prepare('SELECT * FROM wje_extract_vars ORDER BY record_id, sort_order, id'),
    assertDelete: db.prepare('DELETE FROM wje_assertions WHERE record_id = ?'),
    assertClear: db.prepare('DELETE FROM wje_assertions'),
    assertInsert: db.prepare(
      'INSERT INTO wje_assertions (id, record_id, name, source, json_path, header_name, array_unpack, operator, expected, enabled, sort_order, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    assertAll: db.prepare('SELECT * FROM wje_assertions ORDER BY record_id, sort_order, id'),
    dbopDelete: db.prepare('DELETE FROM wje_db_ops WHERE record_id = ?'),
    dbopClear: db.prepare('DELETE FROM wje_db_ops'),
    dbopInsert: db.prepare(
      'INSERT INTO wje_db_ops (id, record_id, name, connection_id, sql, enabled, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    dbopAll: db.prepare('SELECT * FROM wje_db_ops ORDER BY record_id, sort_order, id'),
    dbopxDelete: db.prepare('DELETE FROM wje_db_op_extracts WHERE record_id = ?'),
    dbopxClear: db.prepare('DELETE FROM wje_db_op_extracts'),
    dbopxInsert: db.prepare(
      'INSERT INTO wje_db_op_extracts (id, op_id, record_id, var_name, json_path, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    dbopxAll: db.prepare('SELECT * FROM wje_db_op_extracts ORDER BY record_id, op_id, sort_order, id')
  };
  return sqlite;
}

function mapExtract(row) {
  return {
    id: row.id,
    varName: row.var_name,
    source: row.source,
    method: row.method,
    jsonPath: row.json_path,
    headerName: row.header_name,
    arrayUnpack: unflag(row.array_unpack),
    enabled: row.enabled == null ? true : unflag(row.enabled)
  };
}

function mapAssert(row) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    jsonPath: row.json_path,
    headerName: row.header_name,
    arrayUnpack: unflag(row.array_unpack),
    operator: row.operator,
    expected: row.expected == null ? '' : row.expected,
    enabled: row.enabled == null ? true : unflag(row.enabled)
  };
}

function mapDbOp(row, extractsByOp) {
  return {
    id: row.id,
    name: row.name,
    connectionId: row.connection_id,
    sql: row.sql,
    extracts: extractsByOp[row.id] || [],
    enabled: row.enabled == null ? true : unflag(row.enabled)
  };
}

function withSqliteTx(fn) {
  const db = openSqlite();
  db.db.exec('BEGIN');
  try {
    fn(db);
    db.db.exec('COMMIT');
  } catch (e) {
    try {
      db.db.exec('ROLLBACK');
    } catch (err) {
      // ignore
    }
    throw e;
  }
}

function saveExtractSqlite(recordId, items) {
  withSqliteTx((db) => {
    db.extractDelete.run(recordId);
    (items || []).forEach((item, index) => {
      db.extractInsert.run(
        item.id,
        recordId,
        item.varName || '',
        item.source || 'json',
        item.method || '',
        item.jsonPath || '',
        item.headerName || '',
        flag(item.arrayUnpack),
        flag(item.enabled !== false),
        index,
        nowIso()
      );
    });
  });
}

function saveAssertSqlite(recordId, items) {
  withSqliteTx((db) => {
    db.assertDelete.run(recordId);
    (items || []).forEach((item, index) => {
      db.assertInsert.run(
        item.id,
        recordId,
        item.name || '',
        item.source || 'json',
        item.jsonPath || '',
        item.headerName || '',
        flag(item.arrayUnpack),
        item.operator || 'equals',
        item.expected == null ? '' : String(item.expected),
        flag(item.enabled !== false),
        index,
        nowIso()
      );
    });
  });
}

function saveDbOpSqlite(recordId, items) {
  withSqliteTx((db) => {
    db.dbopxDelete.run(recordId);
    db.dbopDelete.run(recordId);
    (items || []).forEach((item, index) => {
      db.dbopInsert.run(
        item.id,
        recordId,
        item.name || '',
        item.connectionId || '',
        item.sql || '',
        flag(item.enabled !== false),
        index,
        nowIso()
      );
      (item.extracts || []).forEach((ex, exIndex) => {
        db.dbopxInsert.run(
          ex.id,
          item.id,
          recordId,
          ex.varName || '',
          ex.jsonPath || '',
          exIndex
        );
      });
    });
  });
}

function saveRecord(kind, recordId, items) {
  const id = String(recordId || '');
  if (!id) return;
  const list = Array.isArray(items) ? items : [];
  if (kind === 'extract') saveExtractSqlite(id, list);
  else if (kind === 'assert') saveAssertSqlite(id, list);
  else if (kind === 'dbop') saveDbOpSqlite(id, list);
  scheduleMysqlSave(kind, id, list);
}

function deleteRecords(kind, ids) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return;
  const db = openSqlite();
  list.forEach((id) => {
    if (kind === 'extract') db.extractDelete.run(id);
    else if (kind === 'assert') db.assertDelete.run(id);
    else if (kind === 'dbop') {
      db.dbopxDelete.run(id);
      db.dbopDelete.run(id);
    }
  });
  scheduleMysqlDelete(kind, list);
}

function clearKind(kind) {
  const db = openSqlite();
  if (kind === 'extract') db.extractClear.run();
  else if (kind === 'assert') db.assertClear.run();
  else if (kind === 'dbop') {
    db.dbopxClear.run();
    db.dbopClear.run();
  }
  scheduleMysqlClear(kind);
}

function loadKind(kind) {
  const db = openSqlite();
  if (kind === 'extract') return groupByRecord(db.extractAll.all(), mapExtract);
  if (kind === 'assert') return groupByRecord(db.assertAll.all(), mapAssert);
  if (kind === 'dbop') {
    const extractsByOp = {};
    (db.dbopxAll.all() || []).forEach((row) => {
      if (!extractsByOp[row.op_id]) extractsByOp[row.op_id] = [];
      extractsByOp[row.op_id].push({
        id: row.id,
        varName: row.var_name,
        jsonPath: row.json_path
      });
    });
    return groupByRecord(db.dbopAll.all(), (row) => mapDbOp(row, extractsByOp));
  }
  return {};
}

function enqueueMysql(task) {
  mysqlQueue = mysqlQueue.then(task).catch((e) => {
    const err = e && e.message ? e.message : String(e);
    console.error('[jmeter-exporter] postOp mysql failed:', err);
    mysqlResult({ mysql: false, mysqlError: err });
    try {
      require('./pluginStatus').setLastError('storage', e);
    } catch (err2) {
      // ignore
    }
  });
  return mysqlQueue;
}

async function ensureSchema(client) {
  for (let i = 0; i < MYSQL_DDL.length; i += 1) {
    await client.query(MYSQL_DDL[i]);
  }
}

async function withMysqlConn(conn, fn) {
  if (!conn) throw new Error('未找到所选 MySQL 连接');
  const mysql = require('mysql2/promise');
  const client = await mysql.createConnection(toPoolConfig(conn));
  try {
    await ensureSchema(client);
    if (fn) await fn(client);
    mysqlResult({ mysql: true, mysqlDatabase: conn.database || '' });
  } finally {
    await client.end();
  }
}

async function withMysql(fn) {
  const { getCaptureConfig } = require('./captureConfig');
  const { getConnection } = require('./dbConnections');
  const cfg = getCaptureConfig();
  if (cfg.persistEngine !== 'mysql' || !cfg.mysqlConnectionId) {
    mysqlResult({ skipped: true });
    return { skipped: true };
  }
  const conn = getConnection(cfg.mysqlConnectionId);
  if (!conn) throw new Error('未找到所选 MySQL 连接');
  await withMysqlConn(conn, fn);
  return lastMysql;
}

async function flushMysql() {
  await mysqlQueue;
  return lastMysql;
}

async function writeKindToClient(client, kind, recordId, items) {
  const list = Array.isArray(items) ? items : [];
  if (kind === 'extract') {
    await client.query('DELETE FROM `wje_extract_vars` WHERE record_id = ?', [recordId]);
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      await client.query(
        'INSERT INTO `wje_extract_vars` (id, record_id, var_name, source, method, json_path, header_name, array_unpack, enabled, sort_order, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          item.id,
          recordId,
          item.varName || '',
          item.source || 'json',
          item.method || '',
          item.jsonPath || '',
          item.headerName || '',
          flag(item.arrayUnpack),
          flag(item.enabled !== false),
          i,
          new Date()
        ]
      );
    }
    return;
  }
  if (kind === 'assert') {
    await client.query('DELETE FROM `wje_assertions` WHERE record_id = ?', [recordId]);
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      await client.query(
        'INSERT INTO `wje_assertions` (id, record_id, name, source, json_path, header_name, array_unpack, operator, expected, enabled, sort_order, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          item.id,
          recordId,
          item.name || '',
          item.source || 'json',
          item.jsonPath || '',
          item.headerName || '',
          flag(item.arrayUnpack),
          item.operator || 'equals',
          item.expected == null ? '' : String(item.expected),
          flag(item.enabled !== false),
          i,
          new Date()
        ]
      );
    }
    return;
  }
  await client.query('DELETE FROM `wje_db_op_extracts` WHERE record_id = ?', [recordId]);
  await client.query('DELETE FROM `wje_db_ops` WHERE record_id = ?', [recordId]);
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    await client.query(
      'INSERT INTO `wje_db_ops` (id, record_id, name, connection_id, sql_text, enabled, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        item.id,
        recordId,
        item.name || '',
        item.connectionId || '',
        item.sql || '',
        flag(item.enabled !== false),
        i,
        new Date()
      ]
    );
    const extracts = item.extracts || [];
    for (let j = 0; j < extracts.length; j += 1) {
      const ex = extracts[j];
      await client.query(
        'INSERT INTO `wje_db_op_extracts` (id, op_id, record_id, var_name, json_path, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [ex.id, item.id, recordId, ex.varName || '', ex.jsonPath || '', j]
      );
    }
  }
}

async function syncAllKinds(client) {
  const kinds = ['extract', 'assert', 'dbop'];
  let records = 0;
  let rows = 0;
  for (let k = 0; k < kinds.length; k += 1) {
    const kind = kinds[k];
    const mapped = loadKind(kind);
    const ids = Object.keys(mapped || {});
    for (let i = 0; i < ids.length; i += 1) {
      const recordId = ids[i];
      const items = mapped[recordId] || [];
      await writeKindToClient(client, kind, recordId, items);
      records += 1;
      rows += items.length;
    }
  }
  return { records, rows };
}

async function ensureMysqlSchema(conn) {
  let synced = { records: 0, rows: 0 };
  await withMysqlConn(conn, async (client) => {
    synced = await syncAllKinds(client);
  });
  lastMysql = Object.assign({}, lastMysql, { syncedRecords: synced.records, syncedRows: synced.rows });
  return lastMysql;
}

function scheduleMysqlSave(kind, recordId, items) {
  enqueueMysql(async () => {
    await withMysql(async (client) => {
      await writeKindToClient(client, kind, recordId, items || []);
    });
  });
}

function scheduleMysqlDelete(kind, ids) {
  enqueueMysql(async () => {
    await withMysql(async (client) => {
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        if (kind === 'extract') await client.query('DELETE FROM `wje_extract_vars` WHERE record_id = ?', [id]);
        else if (kind === 'assert') await client.query('DELETE FROM `wje_assertions` WHERE record_id = ?', [id]);
        else {
          await client.query('DELETE FROM `wje_db_op_extracts` WHERE record_id = ?', [id]);
          await client.query('DELETE FROM `wje_db_ops` WHERE record_id = ?', [id]);
        }
      }
    });
  });
}

function scheduleMysqlClear(kind) {
  enqueueMysql(async () => {
    await withMysql(async (client) => {
      if (kind === 'extract') await client.query('DELETE FROM `wje_extract_vars`');
      else if (kind === 'assert') await client.query('DELETE FROM `wje_assertions`');
      else {
        await client.query('DELETE FROM `wje_db_op_extracts`');
        await client.query('DELETE FROM `wje_db_ops`');
      }
    });
  });
}

module.exports = {
  saveRecord,
  deleteRecords,
  clearKind,
  loadKind,
  ensureMysqlSchema,
  flushMysql,
  MYSQL_DDL
};
