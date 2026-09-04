const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');
const { removeRecordUploads, removeAllUploads } = require('./multipart');
const { setLastError } = require('./pluginStatus');
const { getCaptureConfig, setCaptureConfig } = require('./captureConfig');
const { getConnection } = require('./dbConnections');
const mysqlStore = require('./mysqlStore');
const pgRecordStore = require('./pgRecordStore');
const {
  safeRecordId,
  resourceName,
  initiatorFromHeaders,
  responseTransferSize,
  resourceType,
  mimeType,
  truncateUtf8
} = require('./utils');

const MAX_RECORDS = 10000;
const MAX_PERSIST_BODY = 1024 * 1024;
const DATA_FILE = path.join(DATA_DIR, 'records.json');
const DB_FILE = path.join(DATA_DIR, 'records.sqlite');

const records = [];
const byId = new Map();
const summarySizeCache = new WeakMap();
let loaded = false;
let storageType = 'memory';
let persistTarget = 'sqlite';
let sqlite = null;
let mysqlPool = null;
let mysqlMeta = null;
let pgPool = null;
let pgMeta = null;
let mysqlQueue = Promise.resolve();
let storageReady = Promise.resolve();
let jsonSaveTimer = null;
let recordsRemovedHooks = [];

function setRecordsRemovedHook(fn) {
  if (typeof fn === 'function') recordsRemovedHooks.push(fn);
}

function notifyRecordsRemoved(ids) {
  if (!ids || !ids.length) return;
  recordsRemovedHooks.forEach((fn) => {
    try {
      fn(ids);
    } catch (e) {
      // ignore
    }
  });
}

function capBody(text, maxBytes = MAX_PERSIST_BODY) {
  return truncateUtf8(text, maxBytes);
}

function persistable(record) {
  return {
    ...record,
    requestBody: capBody(record.requestBody),
    responseBody: capBody(record.responseBody)
  };
}

function hydrate(record) {
  if (!record || !record.url) return null;
  record.id = String(record.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return record;
}

function shouldOffloadBodies() {
  return (storageType === 'sqlite' && Boolean(sqlite))
    || storageType === 'mysql'
    || persistTarget === 'mysql'
    || storageType === 'postgres'
    || persistTarget === 'postgres';
}

const LITE_REQ_HEADER_KEYS = new Set(['referer', 'origin', 'content-type', 'content-length']);
const LITE_RES_HEADER_KEYS = new Set(['content-type', 'content-length']);

function pickLiteHeaders(headers, allowKeys) {
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  Object.keys(headers).forEach((key) => {
    if (allowKeys.has(String(key).toLowerCase())) out[key] = headers[key];
  });
  return out;
}

function toLite(record) {
  if (!record) return record;
  if (record._bodiesOffloaded) return record;
  return {
    id: record.id,
    url: record.url,
    method: record.method,
    requestHeaders: pickLiteHeaders(record.requestHeaders || {}, LITE_REQ_HEADER_KEYS),
    requestBody: '',
    requestBodyBinary: Boolean(record.requestBodyBinary),
    responseStatus: record.responseStatus,
    responseHeaders: pickLiteHeaders(record.responseHeaders || {}, LITE_RES_HEADER_KEYS),
    responseBody: '',
    responseBodyBinary: Boolean(record.responseBodyBinary),
    multipart: record.multipart
      ? {
          boundary: record.multipart.boundary,
          fields: record.multipart.fields,
          files: (record.multipart.files || []).map((file) => ({
            name: file.name,
            filename: file.filename,
            contentType: file.contentType,
            path: file.path,
            size: file.size
          }))
        }
      : undefined,
    timestamp: record.timestamp,
    reqStartTime: record.reqStartTime,
    reqEndTime: record.reqEndTime,
    duration: record.duration,
    requestBodySize: Buffer.byteLength(String(record.requestBody || ''), 'utf8'),
    responseBodySize: Buffer.byteLength(String(record.responseBody || ''), 'utf8'),
    transferSize: responseTransferSize(record),
    _bodiesOffloaded: true
  };
}

function loadFullFromSqlite(id) {
  if (!sqlite || !sqlite.byId) return null;
  try {
    const row = sqlite.byId.get(String(id));
    if (!row || row.json == null) return null;
    return hydrate(JSON.parse(row.json));
  } catch (e) {
    return null;
  }
}

async function loadFullFromMysql(id) {
  if (!mysqlPool) return null;
  try {
    return await mysqlStore.loadById(mysqlPool, id);
  } catch (e) {
    setLastError('storage', e);
    return null;
  }
}

async function loadFullFromPostgres(id) {
  if (!pgPool) return null;
  try {
    return await pgRecordStore.loadById(pgPool, id);
  } catch (e) {
    setLastError('storage', e);
    return null;
  }
}

function hydrateIfNeeded(record) {
  if (!record) return null;
  if (!record._bodiesOffloaded) return record;
  if (storageType === 'sqlite') return loadFullFromSqlite(record.id) || record;
  return record;
}

async function hydrateIfNeededAsync(record) {
  if (!record) return null;
  if (!record._bodiesOffloaded) return record;
  if (storageType === 'sqlite') return loadFullFromSqlite(record.id) || record;
  if (storageType === 'mysql' || persistTarget === 'mysql') {
    return (await loadFullFromMysql(record.id)) || record;
  }
  if (storageType === 'postgres' || persistTarget === 'postgres') {
    return (await loadFullFromPostgres(record.id)) || record;
  }
  return record;
}

function pushMemory(record) {
  const existing = byId.get(record.id);
  if (existing) {
    const idx = records.findIndex((item) => item.id === record.id);
    if (idx >= 0) records[idx] = record;
    else records.push(record);
    byId.set(record.id, record);
    return [];
  }
  records.push(record);
  byId.set(record.id, record);
  const removed = [];
  while (records.length > MAX_RECORDS) {
    const item = records.shift();
    if (item) {
      byId.delete(item.id);
      removed.push(item.id);
    }
  }
  return removed;
}

function removeFromMemory(id) {
  const key = String(id);
  if (!byId.has(key)) return false;
  byId.delete(key);
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (records[i].id === key) {
      records.splice(i, 1);
      return true;
    }
  }
  return false;
}

function restoreMemoryRecord(record) {
  if (!record || !record.id) return;
  const idx = records.findIndex((item) => item.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  byId.set(record.id, record);
}

function openSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      timestamp INTEGER,
      method TEXT,
      url TEXT,
      request_headers TEXT,
      request_body TEXT,
      response_headers TEXT,
      response_body TEXT,
      response_body_size INTEGER,
      duration_time INTEGER,
      response_status TEXT,
      captured_time TEXT,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_id ON records(id);
    CREATE INDEX IF NOT EXISTS idx_records_ts ON records(timestamp);
  `);
  mysqlStore.ensureSqliteColumns(db);
  try {
    mysqlStore.backfillSqliteColumns(db);
  } catch (e) {
    // keep sqlite even if old rows cannot be backfilled
  }
  return {
    db,
    insert: db.prepare(
      'INSERT OR REPLACE INTO records (id, timestamp, method, url, request_headers, request_body, ' +
        'response_headers, response_body, response_body_size, duration_time, response_status, captured_time, json) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    count: db.prepare('SELECT COUNT(*) AS c FROM records'),
    oldest: db.prepare('SELECT id FROM records ORDER BY seq ASC LIMIT ?'),
    remove: db.prepare('DELETE FROM records WHERE id = ?'),
    clear: db.prepare('DELETE FROM records'),
    all: db.prepare('SELECT json FROM records ORDER BY seq ASC'),
    byId: db.prepare('SELECT json FROM records WHERE id = ? LIMIT 1')
  };
}

function sqliteInsert(record) {
  const col = mysqlStore.toColumns(persistable(record));
  sqlite.db.exec('BEGIN');
  try {
    sqlite.insert.run(
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
      col.capturedTimeIso,
      col.json
    );
    const total = sqlite.count.get().c;
    let staleIds = [];
    if (total > MAX_RECORDS) {
      const stale = sqlite.oldest.all(total - MAX_RECORDS);
      stale.forEach((item) => sqlite.remove.run(item.id));
      staleIds = stale.map((item) => String(item.id));
    }
    sqlite.db.exec('COMMIT');
    return staleIds;
  } catch (e) {
    try {
      sqlite.db.exec('ROLLBACK');
    } catch (err) {
      // ignore
    }
    throw e;
  }
}

function migrateJsonToSqlite() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(parsed) || !parsed.length) return;
    parsed.forEach((item) => {
      const record = hydrate(item);
      if (!record) return;
      try {
        sqliteInsert(record);
      } catch (e) {
        // skip bad row
      }
    });
    try {
      fs.renameSync(DATA_FILE, `${DATA_FILE}.migrated`);
    } catch (e) {
      try {
        fs.unlinkSync(DATA_FILE);
      } catch (err) {
        // ignore
      }
    }
  } catch (e) {
    // ignore broken json
  }
}

function loadFromSqlite() {
  sqlite.all.all().forEach((row) => {
    try {
      const record = hydrate(JSON.parse(row.json));
      if (record) pushMemory(toLite(record));
    } catch (e) {
      // skip
    }
  });
}

function scheduleJsonSave() {
  if (jsonSaveTimer) clearTimeout(jsonSaveTimer);
  jsonSaveTimer = setTimeout(flushJson, 800);
}

function flushJson() {
  jsonSaveTimer = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFile(DATA_FILE, JSON.stringify(records.map(persistable)));
  } catch (e) {
    setLastError('storage', e);
  }
}

function loadFromJson() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return;
    parsed.forEach((item) => {
      const record = hydrate(item);
      if (record) pushMemory(record);
    });
  } catch (e) {
    // ignore
  }
}

function replaceMemory(list) {
  records.length = 0;
  byId.clear();
  (list || []).forEach((item) => {
    const record = hydrate(item);
    if (!record) return;
    records.push(record);
    byId.set(record.id, record);
  });
}

function enqueueMysql(task) {
  mysqlQueue = mysqlQueue.then(task).catch((e) => {
    console.error('[jmeter-exporter] mysql persist failed:', e && e.message);
    setLastError('storage', e);
  });
  return mysqlQueue;
}

async function closeMysql() {
  const pool = mysqlPool;
  mysqlPool = null;
  mysqlMeta = null;
  if (pool) {
    try {
      await mysqlStore.close(pool);
    } catch (e) {
      // ignore
    }
  }
}

async function closePostgres() {
  const pool = pgPool;
  pgPool = null;
  pgMeta = null;
  if (pool) {
    try {
      await pgRecordStore.close(pool);
    } catch (e) {
      // ignore
    }
  }
}

async function closeRemotePools() {
  await closeMysql();
  await closePostgres();
}

async function startPostgres(connectionId) {
  const conn = getConnection(connectionId);
  if (!conn) throw new Error('未找到所选 PostgreSQL 连接');
  if (conn.type !== 'postgres') throw new Error('所选连接不是 PostgreSQL');
  setCaptureConfig({ persistEngine: 'postgres', postgresConnectionId: connectionId });
  const pool = await pgRecordStore.connect(conn);
  const list = await pgRecordStore.loadAll(pool);
  pgPool = pool;
  pgMeta = {
    id: conn.id,
    name: conn.name,
    database: conn.database,
    host: conn.host,
    port: conn.port
  };
  replaceMemory(list.map((item) => {
    const record = hydrate(item);
    return record ? toLite(record) : null;
  }).filter(Boolean));
  storageType = 'postgres';
  persistTarget = 'postgres';
}

async function startMysql(connectionId) {
  const conn = getConnection(connectionId);
  if (!conn) throw new Error('未找到所选 MySQL 连接');
  setCaptureConfig({ persistEngine: 'mysql', mysqlConnectionId: connectionId });
  const pool = await mysqlStore.connect(conn);
  const list = await mysqlStore.loadAll(pool);
  mysqlPool = pool;
  mysqlMeta = {
    id: conn.id,
    name: conn.name,
    database: conn.database,
    host: conn.host,
    port: conn.port
  };
  replaceMemory(list.map((item) => {
    const record = hydrate(item);
    return record ? toLite(record) : null;
  }).filter(Boolean));
  storageType = 'mysql';
  persistTarget = 'mysql';
  try {
    await require('./postOpStore').ensureMysqlSchema(conn);
  } catch (e) {
    console.error('[jmeter-exporter] postOp mysql schema failed:', e && e.message);
    setLastError('storage', e);
  }
}

function loadLocalFallback() {
  if (sqlite) {
    storageType = 'sqlite';
    persistTarget = 'sqlite';
    replaceMemory([]);
    loadFromSqlite();
    return;
  }
  storageType = 'json';
  persistTarget = 'json';
  replaceMemory([]);
  loadFromJson();
}

function persistAdd(record, onFailure) {
  if (persistTarget === 'postgres') {
    enqueueMysql(async () => {
      await storageReady.catch(() => {});
      if (!pgPool || storageType !== 'postgres') {
        if (sqlite) {
          try {
            sqliteInsert(record).forEach(removeRecordUploads);
          } catch (e) {
            if (typeof onFailure === 'function') onFailure(e);
          }
        } else scheduleJsonSave();
        return;
      }
      try {
        await pgRecordStore.insert(pgPool, persistable(record));
        pushMemory(shouldOffloadBodies() ? toLite(record) : record);
        const stale = await pgRecordStore.trimOldest(pgPool, MAX_RECORDS);
        stale.forEach(removeRecordUploads);
      } catch (e) {
        console.error('[jmeter-exporter] postgres insert failed:', e && e.message);
        setLastError('storage', e);
        if (typeof onFailure === 'function') onFailure(e);
      }
    });
    return true;
  }
  if (persistTarget === 'mysql') {
    enqueueMysql(async () => {
      await storageReady.catch(() => {});
      if (!mysqlPool || storageType !== 'mysql') {
        if (sqlite) {
          try {
            sqliteInsert(record).forEach(removeRecordUploads);
          } catch (e) {
            if (typeof onFailure === 'function') onFailure(e);
          }
        } else scheduleJsonSave();
        return;
      }
      try {
        await mysqlStore.insert(mysqlPool, persistable(record));
        pushMemory(shouldOffloadBodies() ? toLite(record) : record);
        const stale = await mysqlStore.trimOldest(mysqlPool, MAX_RECORDS);
        stale.forEach(removeRecordUploads);
      } catch (e) {
        console.error('[jmeter-exporter] mysql insert failed:', e && e.message);
        setLastError('storage', e);
        if (typeof onFailure === 'function') onFailure(e);
      }
    });
    return true;
  }
  if (storageType === 'sqlite' && sqlite) {
    try {
      sqliteInsert(record).forEach(removeRecordUploads);
      return true;
    } catch (e) {
      console.error('[jmeter-exporter] sqlite insert failed:', e && e.message);
      setLastError('storage', e);
      if (typeof onFailure === 'function') onFailure(e);
      return false;
    }
  }
  if (storageType !== 'sqlite') scheduleJsonSave();
  return true;
}

function persistDelete(ids) {
  if (persistTarget === 'postgres') {
    enqueueMysql(async () => {
      await storageReady.catch(() => {});
      if (pgPool && storageType === 'postgres') {
        await pgRecordStore.remove(pgPool, ids);
        return;
      }
      if (sqlite) {
        ids.forEach((id) => sqlite.remove.run(String(id)));
        return;
      }
      scheduleJsonSave();
    });
    return;
  }
  if (persistTarget === 'mysql') {
    enqueueMysql(async () => {
      await storageReady.catch(() => {});
      if (mysqlPool && storageType === 'mysql') {
        await mysqlStore.remove(mysqlPool, ids);
        return;
      }
      if (sqlite) {
        ids.forEach((id) => sqlite.remove.run(String(id)));
        return;
      }
      scheduleJsonSave();
    });
    return;
  }
  if (storageType === 'sqlite' && sqlite) {
    try {
      sqlite.db.exec('BEGIN');
      try {
        ids.forEach((id) => sqlite.remove.run(String(id)));
        sqlite.db.exec('COMMIT');
      } catch (e) {
        try {
          sqlite.db.exec('ROLLBACK');
        } catch (err) {
          // ignore
        }
        throw e;
      }
      return;
    } catch (e) {
      console.error('[jmeter-exporter] sqlite delete failed:', e && e.message);
      setLastError('storage', e);
    }
  }
  if (storageType !== 'sqlite') scheduleJsonSave();
}

function persistClear() {
  if (persistTarget === 'postgres') {
    enqueueMysql(async () => {
      await storageReady.catch(() => {});
      if (pgPool && storageType === 'postgres') {
        await pgRecordStore.clear(pgPool);
        return;
      }
      if (sqlite) {
        sqlite.clear.run();
        return;
      }
      flushJson();
    });
    return;
  }
  if (persistTarget === 'mysql') {
    enqueueMysql(async () => {
      await storageReady.catch(() => {});
      if (mysqlPool && storageType === 'mysql') {
        await mysqlStore.clear(mysqlPool);
        return;
      }
      if (sqlite) {
        sqlite.clear.run();
        return;
      }
      flushJson();
    });
    return;
  }
  if (storageType === 'sqlite' && sqlite) {
    try {
      sqlite.clear.run();
      return;
    } catch (e) {
      console.error('[jmeter-exporter] sqlite clear failed:', e && e.message);
      setLastError('storage', e);
    }
  }
  if (storageType !== 'sqlite') flushJson();
}

function loadPersisted() {
  if (loaded) return;
  loaded = true;
  try {
    sqlite = openSqlite();
  } catch (e) {
    sqlite = null;
  }
  const cfg = getCaptureConfig();
  if (cfg.persistEngine === 'postgres' && cfg.postgresConnectionId) {
    persistTarget = 'postgres';
    storageReady = startPostgres(cfg.postgresConnectionId).catch((e) => {
      console.error('[jmeter-exporter] postgres storage failed:', e && e.message);
      setLastError('storage', e);
      loadLocalFallback();
    });
    return;
  }
  if (cfg.persistEngine === 'mysql' && cfg.mysqlConnectionId) {
    persistTarget = 'mysql';
    storageReady = startMysql(cfg.mysqlConnectionId).catch((e) => {
      console.error('[jmeter-exporter] mysql storage failed:', e && e.message);
      setLastError('storage', e);
      loadLocalFallback();
    });
    return;
  }
  if (sqlite) {
    storageType = 'sqlite';
    persistTarget = 'sqlite';
    if (sqlite.count.get().c === 0) {
      migrateJsonToSqlite();
    }
    loadFromSqlite();
    return;
  }
  storageType = 'json';
  persistTarget = 'json';
  loadFromJson();
}

async function ensureStorageReady() {
  try {
    await storageReady;
  } catch (e) {
    // fallback already applied
  }
}

async function applyStorageSettings() {
  const cfg = getCaptureConfig();
  await closeRemotePools();
  if (cfg.persistEngine === 'postgres' && cfg.postgresConnectionId) {
    persistTarget = 'postgres';
    storageReady = startPostgres(cfg.postgresConnectionId);
    try {
      await storageReady;
    } catch (e) {
      setLastError('storage', e);
      loadLocalFallback();
      throw e;
    }
    return getStorageInfo();
  }
  if (cfg.persistEngine === 'mysql' && cfg.mysqlConnectionId) {
    persistTarget = 'mysql';
    storageReady = startMysql(cfg.mysqlConnectionId);
    try {
      await storageReady;
    } catch (e) {
      setLastError('storage', e);
      loadLocalFallback();
      throw e;
    }
    return getStorageInfo();
  }
  persistTarget = sqlite ? 'sqlite' : 'json';
  loadLocalFallback();
  return getStorageInfo();
}

function getStorageInfo() {
  const cfg = getCaptureConfig();
  const remoteMeta = storageType === 'postgres' ? pgMeta : mysqlMeta;
  return {
    type: storageType,
    persistEngine: cfg.persistEngine || 'sqlite',
    mysqlConnectionId: cfg.mysqlConnectionId || '',
    postgresConnectionId: cfg.postgresConnectionId || '',
    mysqlName: remoteMeta && remoteMeta.name ? remoteMeta.name : '',
    mysqlDatabase: remoteMeta && remoteMeta.database ? remoteMeta.database : '',
    mysqlHost: remoteMeta && remoteMeta.host ? remoteMeta.host : '',
    fallback: Boolean(
      (cfg.persistEngine === 'mysql' && storageType !== 'mysql')
      || (cfg.persistEngine === 'postgres' && storageType !== 'postgres')
    )
  };
}

function addRecord(record) {
  if (!record) return;
  record.id = safeRecordId(record.id);
  const previous = byId.get(record.id);
  const forMemory = shouldOffloadBodies() ? toLite(record) : record;
  const removed = pushMemory(forMemory);
  removed.forEach(removeRecordUploads);
  if (removed.length) notifyRecordsRemoved(removed);
  const rollback = () => {
    if (previous) restoreMemoryRecord(previous);
    else removeFromMemory(record.id);
  };
  const ok = persistAdd(record, rollback);
  if (!ok) rollback();
}

function getRecords() {
  if (!shouldOffloadBodies()) return records.slice();
  if (storageType === 'mysql' || storageType === 'postgres') {
    // sync callers cannot hydrate remote DB bodies; use getRecordsAsync
    return records.slice();
  }
  return records.map((record) => hydrateIfNeeded(record));
}

function getRecordById(id) {
  const record = byId.get(String(id));
  if (!record) return null;
  return hydrateIfNeeded(record);
}

async function getRecordByIdAsync(id) {
  const key = String(id == null ? '' : id);
  if (!key) return null;
  await ensureStorageReady();
  const record = byId.get(key);
  if (record) return hydrateIfNeededAsync(record);
  if (storageType === 'mysql' || persistTarget === 'mysql') {
    const full = await loadFullFromMysql(key);
    if (full) return hydrate(full) || full;
  }
  if (storageType === 'postgres' || persistTarget === 'postgres') {
    const full = await loadFullFromPostgres(key);
    if (full) return hydrate(full) || full;
  }
  const fromSqlite = loadFullFromSqlite(key);
  return fromSqlite || null;
}

async function getRecordsAsync() {
  if (!shouldOffloadBodies()) return records.slice();
  const out = [];
  for (let i = 0; i < records.length; i += 1) {
    out.push(await hydrateIfNeededAsync(records[i]));
  }
  return out;
}

async function getRecordsByIdsAsync(ids) {
  if (!ids || ids.length === 0) return [];
  const idSet = new Set(ids.map(String));
  const matched = records.filter((record) => idSet.has(String(record.id)));
  if (!shouldOffloadBodies()) return matched;
  const out = [];
  for (let i = 0; i < matched.length; i += 1) {
    out.push(await hydrateIfNeededAsync(matched[i]));
  }
  return out;
}

function summaryDuration(record) {
  if (record.duration != null && record.duration !== '') {
    const n = Number(record.duration);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  const start = Number(record.reqStartTime);
  const end = Number(record.reqEndTime);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start && start > 0) {
    return Math.trunc(end - start);
  }
  return null;
}

function summaryBodySizes(record) {
  if (record && record.requestBodySize != null && record.responseBodySize != null) {
    return {
      requestBodySize: Number(record.requestBodySize) || 0,
      responseBodySize: Number(record.responseBodySize) || 0,
      size: record.transferSize != null
        ? (Number(record.transferSize) || 0)
        : responseTransferSize(record)
    };
  }
  let cached = summarySizeCache.get(record);
  if (cached) return cached;
  cached = {
    requestBodySize: Buffer.byteLength(String(record.requestBody || ''), 'utf8'),
    responseBodySize: Buffer.byteLength(String(record.responseBody || ''), 'utf8'),
    size: responseTransferSize(record)
  };
  summarySizeCache.set(record, cached);
  return cached;
}

function toSummary(record) {
  const init = initiatorFromHeaders(record.requestHeaders);
  const sizes = summaryBodySizes(record);
  return {
    id: record.id,
    url: record.url,
    method: record.method,
    responseStatus: record.responseStatus,
    timestamp: record.timestamp,
    name: resourceName(record.url),
    initiator: init.name,
    initiatorUrl: init.url,
    size: sizes.size,
    duration: summaryDuration(record),
    resourceType: resourceType(record.responseHeaders),
    mimeType: mimeType(record.responseHeaders),
    requestBodySize: sizes.requestBodySize,
    responseBodySize: sizes.responseBodySize,
    hasUpload: Boolean(record.multipart && record.multipart.files && record.multipart.files.length),
    protocolHint: record.protocolHint || 'http',
    wsHandshake: Boolean(record.wsHandshake),
    grpcHint: Boolean(record.grpcHint)
  };
}

function getRecordSummaries() {
  return records.map(toSummary);
}

function clearRecords() {
  const ids = records.map((record) => record.id);
  records.forEach((record) => removeRecordUploads(record.id));
  records.length = 0;
  byId.clear();
  removeAllUploads();
  persistClear();
  notifyRecordsRemoved(ids);
}

function getRecordsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const idSet = new Set(ids.map(String));
  const matched = records.filter((record) => idSet.has(String(record.id)));
  if (!shouldOffloadBodies()) return matched;
  return matched.map((record) => hydrateIfNeeded(record));
}

function deleteRecordsByIds(ids) {
  if (!ids || ids.length === 0) return 0;
  const idSet = new Set(ids.map(String));
  const removedIds = [];
  const kept = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (idSet.has(String(record.id))) {
      removeRecordUploads(record.id);
      byId.delete(record.id);
      removedIds.push(record.id);
    } else {
      kept.push(record);
    }
  }
  if (!removedIds.length) return 0;
  records.length = 0;
  for (let i = 0; i < kept.length; i += 1) {
    records.push(kept[i]);
  }
  persistDelete(removedIds);
  notifyRecordsRemoved(removedIds);
  return removedIds.length;
}

function getLastRecord() {
  return records.length ? records[records.length - 1] : null;
}

function getStorageType() {
  return storageType;
}

async function testPostgresConnection(connectionId) {
  const conn = getConnection(connectionId);
  const pool = await pgRecordStore.connect(conn);
  try {
    await pgRecordStore.ping(pool);
    return {
      ok: true,
      name: conn && conn.name,
      database: conn && conn.database,
      host: conn && conn.host,
      port: conn && conn.port
    };
  } finally {
    await pgRecordStore.close(pool);
  }
}

async function testMysqlConnection(connectionId) {
  const conn = getConnection(connectionId);
  const pool = await mysqlStore.connect(conn);
  try {
    await mysqlStore.ping(pool);
    return {
      ok: true,
      name: conn && conn.name,
      database: conn && conn.database,
      host: conn && conn.host,
      port: conn && conn.port
    };
  } finally {
    await mysqlStore.close(pool);
  }
}

function onConnectionDeleted(id) {
  const cfg = getCaptureConfig();
  if (cfg.mysqlConnectionId && String(cfg.mysqlConnectionId) === String(id)) {
    setCaptureConfig({ persistEngine: 'sqlite', mysqlConnectionId: '' });
    persistTarget = sqlite ? 'sqlite' : 'json';
    storageReady = closeRemotePools().then(() => {
      loadLocalFallback();
    });
  }
  if (cfg.postgresConnectionId && String(cfg.postgresConnectionId) === String(id)) {
    setCaptureConfig({ persistEngine: 'sqlite', postgresConnectionId: '' });
    persistTarget = sqlite ? 'sqlite' : 'json';
    storageReady = closeRemotePools().then(() => {
      loadLocalFallback();
    });
  }
}

loadPersisted();

function flushPending() {
  if (jsonSaveTimer) {
    clearTimeout(jsonSaveTimer);
    flushJson();
  }
}

process.once('beforeExit', flushPending);
process.once('exit', flushPending);

module.exports = {
  addRecord,
  getRecords,
  getRecordsAsync,
  getRecordById,
  getRecordByIdAsync,
  getRecordSummaries,
  clearRecords,
  getRecordsByIds,
  getRecordsByIdsAsync,
  deleteRecordsByIds,
  getLastRecord,
  getStorageType,
  getStorageInfo,
  ensureStorageReady,
  applyStorageSettings,
  testMysqlConnection,
  testPostgresConnection,
  onConnectionDeleted,
  setRecordsRemovedHook,
  MAX_RECORDS,
  MAX_PERSIST_BODY
};
