'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');
const { safeRecordId } = require('./utils');
const { lastPathKey } = require('./jsonPath');
const { getConnection } = require('./dbConnections');
const postOpStore = require('./postOpStore');

const STORE_FILE = path.join(DATA_DIR, 'dbOps.json');
const MAX_PER_RECORD = 10;
const MAX_EXTRACTS = 10;

let store = {};

function loadFromSqlite() {
  try {
    const mapped = postOpStore.loadKind('dbop');
    const keys = Object.keys(mapped || {});
    if (!keys.length) return false;
    store = mapped;
    return true;
  } catch (e) {
    return false;
  }
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) store = parsed;
    }
  } catch (e) {
    store = {};
  }
  if (loadFromSqlite()) return;
  Object.keys(store).forEach((id) => {
    try {
      postOpStore.saveRecord('dbop', id, store[id]);
    } catch (e) {
      // ignore migrate failure
    }
  });
}

function persistRecord(id, items) {
  saveStore();
  try {
    postOpStore.saveRecord('dbop', id, items || []);
  } catch (e) {
    // json already written
  }
}

function saveStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFile(STORE_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    // ignore
  }
}

function createId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function sanitizeVarName(name) {
  let out = String(name || '').replace(/[^A-Za-z0-9_]/g, '_');
  if (!out || /^_+$/.test(out)) out = 'dbVar';
  if (!/^[A-Za-z_]/.test(out)) out = `var_${out}`;
  return out.slice(0, 60);
}

function toJmeterSql(sql) {
  return String(sql || '').replace(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g, '${$1}');
}

function queryType(sql) {
  const text = toJmeterSql(sql).replace(/^\s*\/\*[\s\S]*?\*\//, '').trim();
  if (/^(select|with|show|desc|describe|explain)\b/i.test(text)) return 'Select Statement';
  if (/^(call|exec|execute)\b/i.test(text)) return 'Callable Statement';
  return 'Update Statement';
}

function parseResultPath(expr) {
  const s = String(expr || '').trim();
  let match = s.match(/^\$\[(\d+|\*)\](?:\.([A-Za-z_][\w]*)|\[['"']([^'"]+)['"']\])?$/);
  if (match) {
    return {
      index: match[1] === '*' ? '*' : Number(match[1]),
      column: match[2] || match[3] || lastPathKey(s)
    };
  }
  match = s.match(/^\$\.([A-Za-z_][\w]*)$/);
  if (match) return { index: 0, column: match[1] };
  return { index: 0, column: lastPathKey(s) };
}

function normalizeExtract(src) {
  const jsonPath = String((src && src.jsonPath) || '$[0].id').trim() || '$[0].id';
  const parsed = parseResultPath(jsonPath);
  return {
    id: String((src && src.id) || createId('x')).slice(0, 80),
    varName: sanitizeVarName((src && src.varName) || parsed.column || 'dbVar'),
    jsonPath
  };
}

function normalizeItem(src) {
  const extracts = Array.isArray(src && src.extracts)
    ? src.extracts.slice(0, MAX_EXTRACTS).map(normalizeExtract)
    : [];
  const sql = String((src && src.sql) || '').slice(0, 8000);
  return {
    id: String((src && src.id) || createId('d')).slice(0, 80),
    name: String((src && src.name) || '').trim().slice(0, 80),
    connectionId: String((src && src.connectionId) || '').slice(0, 80),
    sql,
    extracts,
    enabled: src && src.enabled === false ? false : true
  };
}

function itemSignature(item) {
  return `${item.connectionId}|${item.sql}`;
}

function dedupeItems(items) {
  const bySig = new Map();
  const out = [];
  (Array.isArray(items) ? items : []).forEach((raw) => {
    const item = normalizeItem(raw);
    const sig = itemSignature(item);
    const existing = bySig.get(sig);
    if (existing) {
      Object.assign(existing, item, { id: existing.id });
      return;
    }
    out.push(item);
    bySig.set(sig, item);
  });
  return out.slice(0, MAX_PER_RECORD);
}

function listForRecord(recordId) {
  const id = safeRecordId(recordId);
  const items = store[id];
  if (!Array.isArray(items) || !items.length) return [];
  const deduped = dedupeItems(items);
  if (deduped.length !== items.length) {
    store[id] = deduped;
    persistRecord(id, deduped);
  }
  return deduped.map((item) => normalizeItem(item));
}

function setForRecord(recordId, items) {
  const id = safeRecordId(recordId);
  const next = dedupeItems(items);
  if (!next.length) delete store[id];
  else store[id] = next;
  persistRecord(id, next);
  return listForRecord(id);
}

function removeForRecords(ids) {
  if (!ids || !ids.length) return;
  let changed = false;
  ids.forEach((id) => {
    const key = safeRecordId(id);
    if (store[key]) {
      delete store[key];
      changed = true;
    }
  });
  if (changed) {
    saveStore();
    try {
      postOpStore.deleteRecords('dbop', ids.map(safeRecordId));
    } catch (e) {
      // ignore
    }
  }
}

function clearAll() {
  store = {};
  saveStore();
  try {
    postOpStore.clearKind('dbop');
  } catch (e) {
    // ignore
  }
}

function getDbOpsForRecords(ids) {
  return (ids || []).map((id) => listForRecord(id).filter((item) => item.enabled));
}

function collectUsedConnections(ids) {
  const seen = new Map();
  getDbOpsForRecords(ids).forEach((ops) => {
    ops.forEach((op) => {
      if (!op.connectionId || seen.has(op.connectionId)) return;
      const conn = getConnection(op.connectionId);
      if (conn) seen.set(conn.id, conn);
    });
  });
  return Array.from(seen.values());
}

async function resolveSqlVars(sql, recordId, getRecordByIdAsync) {
  const text = String(sql || '');
  const unresolved = [];
  if (!/\{\{\s*[A-Za-z_][\w]*\s*\}\}/.test(text)) {
    return { sql: text, unresolved };
  }
  const varMap = new Map();
  if (recordId && typeof getRecordByIdAsync === 'function') {
    const record = await getRecordByIdAsync(recordId);
    if (record) {
      const { listForRecord, resolveItemValue } = require('./extractVars');
      listForRecord(recordId).forEach((item) => {
        if (!item || !item.varName || varMap.has(item.varName)) return;
        const result = resolveItemValue(record, item);
        if (result.ok && result.values && result.values.length) {
          varMap.set(item.varName, String(result.values[0]));
        }
      });
    }
  }
  const resolved = text.replace(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g, (match, name) => {
    if (varMap.has(name)) return varMap.get(name);
    if (unresolved.indexOf(name) < 0) unresolved.push(name);
    return match;
  });
  return { sql: resolved, unresolved };
}

async function listConnectionDatabases(connectionId) {
  const conn = getConnection(connectionId);
  if (!conn) throw new Error('数据库连接不存在');
  if (conn.type === 'postgres') {
    const pgStore = require('./pgStore');
    const items = await pgStore.listDatabases(conn);
    const defaultDatabase = conn.database && items.indexOf(conn.database) >= 0
      ? conn.database
      : (items[0] || conn.database || '');
    return { items, defaultDatabase };
  }
  if (conn.type !== 'mysql') {
    return {
      items: conn.database ? [conn.database] : [],
      defaultDatabase: conn.database || ''
    };
  }
  const mysqlStore = require('./mysqlStore');
  const items = await mysqlStore.listDatabases(conn);
  const defaultDatabase = conn.database && items.indexOf(conn.database) >= 0
    ? conn.database
    : (items[0] || conn.database || '');
  return { items, defaultDatabase };
}

async function executeSql(payload, deps) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const connectionId = String(body.connectionId || '').trim();
  const database = String(body.database || '').trim();
  const sql = String(body.sql || '').trim();
  const recordId = body.recordId ? String(body.recordId) : '';
  const conn = getConnection(connectionId);
  if (!conn) throw new Error('数据库连接不存在');
  if (conn.type !== 'mysql' && conn.type !== 'postgres') {
    throw new Error('SQL 预览仅支持 MySQL 与 PostgreSQL');
  }
  const targetDb = database || conn.database || '';
  if (!targetDb) throw new Error('请选择数据库');
  const resolved = await resolveSqlVars(sql, recordId, deps && deps.getRecordByIdAsync);
  if (conn.type === 'postgres') {
    const pgStore = require('./pgStore');
    const result = await pgStore.executeQuery(conn, resolved.sql, { database: targetDb });
    return Object.assign({}, result, {
      sql: resolved.sql,
      unresolved: resolved.unresolved || []
    });
  }
  const mysqlStore = require('./mysqlStore');
  const result = await mysqlStore.executeQuery(conn, resolved.sql, { database: targetDb });
  return Object.assign({}, result, {
    sql: resolved.sql,
    unresolved: resolved.unresolved || []
  });
}

function toJmeterJdbc(item) {
  const conn = getConnection(item.connectionId);
  const sql = toJmeterSql(item.sql);
  const type = queryType(sql);
  const extracts = (item.extracts || []).map((row) => {
    const parsed = parseResultPath(row.jsonPath);
    return {
      varName: row.varName,
      jsonPath: row.jsonPath,
      column: parsed.column,
      index: parsed.index,
      jmeterSource: `${parsed.column}_${parsed.index === '*' ? '1' : (Number(parsed.index) + 1)}`
    };
  });
  const variableNames = Array.from(new Set(extracts.map((row) => row.column).filter(Boolean)));
  const { jdbcPoolName } = require('./dbConnections');
  return {
    name: item.name || 'JDBC PostProcessor',
    dataSource: jdbcPoolName(conn),
    sql,
    queryType: type,
    resultVariable: sanitizeVarName(item.name || 'dbResult'),
    variableNames: variableNames.join(','),
    extracts,
    connection: conn
  };
}

loadStore();

try {
  const dataStore = require('./dataStore');
  if (dataStore && typeof dataStore.setRecordsRemovedHook === 'function') {
    dataStore.setRecordsRemovedHook((ids) => {
      if (!ids) {
        clearAll();
        return;
      }
      removeForRecords(ids);
    });
  }
} catch (e) {
  // ignore
}

module.exports = {
  listForRecord,
  setForRecord,
  removeForRecords,
  clearAll,
  getDbOpsForRecords,
  collectUsedConnections,
  toJmeterSql,
  toJmeterJdbc,
  queryType,
  parseResultPath,
  normalizeItem,
  resolveSqlVars,
  listConnectionDatabases,
  executeSql,
  MAX_PER_RECORD
};
