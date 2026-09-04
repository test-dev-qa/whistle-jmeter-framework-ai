'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');
const { encryptSecret, decryptSecret, isEncrypted } = require('./secretVault');
const connStore = require('./connStore');

const STORE_FILE = path.join(DATA_DIR, 'dbConnections.json');
const TYPES = {
  mysql: { driver: 'com.mysql.cj.jdbc.Driver', port: 3306, prefix: 'jdbc:mysql://' },
  postgres: { driver: 'org.postgresql.Driver', port: 5432, prefix: 'jdbc:postgresql://' },
  sqlserver: { driver: 'com.microsoft.sqlserver.jdbc.SQLServerDriver', port: 1433, prefix: 'jdbc:sqlserver://' },
  mongodb: { driver: '', port: 27017, prefix: 'mongodb://' }
};

let store = [];

function wirePasswordFromStore(src) {
  if (!src || typeof src !== 'object') return src;
  const copy = Object.assign({}, src);
  if (copy.password != null && copy.password !== '') {
    copy.password = decryptSecret(copy.password);
  }
  return copy;
}

function wirePasswordToStore(item) {
  if (!item) return item;
  return Object.assign({}, item, {
    password: encryptSecret(item.password)
  });
}

function persistLocal(item) {
  saveStore();
  try {
    connStore.upsertSqlite(wirePasswordToStore(item));
  } catch (e) {
    // sqlite unavailable; json already written
  }
}

function loadFromSqlite() {
  try {
    const rows = connStore.loadSqlite();
    if (!rows.length) return false;
    store = rows.map((row) => normalizeConnection(wirePasswordFromStore(row))).filter(Boolean);
    const migrated = rows.some((row) => row.password && !isEncrypted(row.password));
    if (migrated) saveStore();
    return store.length > 0;
  } catch (e) {
    return false;
  }
}

function loadStore() {
  let hadPlaintext = false;
  try {
    if (fs.existsSync(STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        hadPlaintext = parsed.some((row) => row && row.password && !isEncrypted(row.password));
        store = parsed.map((row) => normalizeConnection(wirePasswordFromStore(row))).filter(Boolean);
      }
    }
  } catch (e) {
    store = [];
  }
  if (!loadFromSqlite() && store.length) {
    store.forEach((item) => {
      try {
        connStore.upsertSqlite(wirePasswordToStore(item));
      } catch (e) {
        // ignore migrate failure
      }
    });
  }
  dedupeStore();
  if (hadPlaintext) saveStore();
}

function saveStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFile(STORE_FILE, JSON.stringify(store.map(wirePasswordToStore), null, 2));
  } catch (e) {
    // ignore
  }
}

function createId() {
  return `db${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function connectionKey(item) {
  const row = item || {};
  return [
    String(row.type || 'mysql').toLowerCase(),
    String(row.host || '').trim().toLowerCase(),
    String(Number(row.port) > 0 ? Math.trunc(Number(row.port)) : ''),
    String(row.database || '').trim().toLowerCase(),
    String(row.username || '').trim().toLowerCase()
  ].join('|');
}

function findDuplicate(src, exceptId) {
  const key = connectionKey(src);
  if (!key || key.split('|').every((part) => !part)) return null;
  return store.find((row) => row.id !== exceptId && connectionKey(row) === key) || null;
}

function dedupeStore() {
  const kept = [];
  const seenId = new Set();
  const seenKey = new Map();
  const removed = [];
  store.forEach((item) => {
    if (!item || !item.id || seenId.has(item.id)) {
      if (item && item.id) removed.push(item);
      return;
    }
    const key = connectionKey(item);
    const prev = seenKey.get(key);
    if (prev) {
      remapCaptureMysqlId(item.id, prev.id);
      Object.assign(prev, item, { id: prev.id });
      prev.dataSource = dataSourceName(prev.id, prev.name || prev.dataSource);
      prev.jdbcUrl = jdbcUrl(prev);
      removed.push(item);
      return;
    }
    seenId.add(item.id);
    seenKey.set(key, item);
    kept.push(item);
  });
  if (!removed.length) return 0;
  store = kept;
  removed.forEach((item) => {
    try {
      connStore.removeSqlite(item.id);
    } catch (e) {
      // ignore
    }
  });
  kept.forEach((item) => {
    try {
      connStore.upsertSqlite(wirePasswordToStore(item));
    } catch (e) {
      // ignore
    }
  });
  saveStore();
  return removed.length;
}

function remapCaptureMysqlId(fromId, toId) {
  if (!fromId || !toId || String(fromId) === String(toId)) return;
  try {
    const { getCaptureConfig, setCaptureConfig } = require('./captureConfig');
    const cfg = getCaptureConfig();
    if (cfg.mysqlConnectionId && String(cfg.mysqlConnectionId) === String(fromId)) {
      setCaptureConfig({ mysqlConnectionId: toId });
    }
  } catch (e) {
    // ignore
  }
}

function jdbcUrl(item) {
  const type = TYPES[item.type] || TYPES.mysql;
  const host = item.host || '127.0.0.1';
  const port = item.port || type.port;
  const database = item.database || '';
  if (item.type === 'mongodb') {
    return `${type.prefix}${host}:${port}${database ? `/${database}` : ''}`;
  }
  if (item.type === 'sqlserver') {
    return `${type.prefix}${host}:${port}${database ? `;databaseName=${database}` : ''}`;
  }
  return `${type.prefix}${host}:${port}/${database}`;
}

function dataSourceName(id, fallback) {
  let ds = String(fallback || `db_${id || 'jdbc'}`).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  if (!ds) ds = 'jdbcConfig';
  if (!/^[A-Za-z_]/.test(ds)) ds = `db_${ds}`;
  return ds;
}

/** JMeter「Variable Name of Pool」：优先用连接名称，保证 Configuration 与 PostProcessor 一致 */
function jdbcPoolName(conn) {
  if (!conn) return 'jdbcConfig';
  return dataSourceName(conn.id, conn.name || conn.dataSource || `db_${conn.id}`);
}

function normalizeConnection(src) {
  if (!src || typeof src !== 'object') return null;
  const type = TYPES[src.type] ? src.type : 'mysql';
  const meta = TYPES[type];
  const name = String(src.name || '').trim().slice(0, 80) || 'db';
  const id = String(src.id || createId()).slice(0, 80);
  const item = {
    id,
    name,
    description: String(src.description || '').trim().slice(0, 200),
    type,
    host: String(src.host || '127.0.0.1').trim().slice(0, 200),
    port: Number(src.port) > 0 ? Math.trunc(Number(src.port)) : meta.port,
    database: String(src.database || '').trim().slice(0, 120),
    username: String(src.username || '').trim().slice(0, 120),
    password: String(src.password == null ? '' : src.password).slice(0, 200),
    driver: String(src.driver || meta.driver).trim(),
    dataSource: dataSourceName(id, name || src.dataSource || `db_${id}`)
  };
  item.jdbcUrl = jdbcUrl(item);
  return item;
}

function listConnections() {
  return store.map((item) => ({ ...item }));
}

function getConnection(id) {
  return store.find((item) => item.id === String(id)) || null;
}

function upsertConnection(src) {
  const payload = Object.assign({}, src);
  let existing = payload.id ? getConnection(payload.id) : null;
  if (!existing) existing = findDuplicate(payload);
  if (existing) {
    if (payload.id && payload.id !== existing.id) {
      payload.id = existing.id;
    } else if (!payload.id) {
      payload.id = existing.id;
    }
    if (payload.password == null || payload.password === '') {
      payload.password = existing.password;
    }
  }
  const item = normalizeConnection(payload);
  const dup = findDuplicate(item, item.id);
  if (dup) {
    const discardedId = item.id;
    item.id = dup.id;
    item.dataSource = dataSourceName(dup.id, item.name || dup.name || dup.dataSource);
    if (!item.password) item.password = dup.password;
    if (discardedId && discardedId !== dup.id) {
      remapCaptureMysqlId(discardedId, dup.id);
      store = store.filter((row) => row.id !== discardedId);
      try {
        connStore.removeSqlite(discardedId);
      } catch (e) {
        // ignore
      }
    }
  }
  const idx = store.findIndex((row) => row.id === item.id);
  if (idx >= 0) store[idx] = item;
  else store.push(item);
  persistLocal(item);
  return item;
}

async function persistRemote(item) {
  if (!item || item.type !== 'mysql' || !String(item.database || '').trim()) {
    return { mysql: false, skipped: true };
  }
  await connStore.upsertMysql(item);
  return { mysql: true, database: item.database };
}

function deleteConnection(id) {
  const existing = getConnection(id);
  const before = store.length;
  store = store.filter((item) => item.id !== String(id));
  if (store.length !== before) {
    saveStore();
    try {
      connStore.removeSqlite(id);
    } catch (e) {
      // ignore
    }
    if (existing && existing.type === 'mysql' && existing.database) {
      connStore.removeMysql(existing).catch(() => {});
    }
  }
  return store.length !== before;
}

function publicConnection(item) {
  if (!item) return null;
  const copy = Object.assign({}, item);
  copy.hasPassword = Boolean(item.password);
  delete copy.password;
  return copy;
}

function listPublicConnections() {
  return store.map(publicConnection);
}

function testReachable(host, port, timeoutMs) {
  const net = require('net');
  const targetHost = String(host || '').trim() || '127.0.0.1';
  const targetPort = Number(port) > 0 ? Math.trunc(Number(port)) : 0;
  const ms = Number(timeoutMs) > 0 ? Math.trunc(Number(timeoutMs)) : 3000;
  if (!targetPort) {
    return Promise.resolve({ ok: false, error: '端口无效', mode: 'tcp' });
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host: targetHost, port: targetPort });
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ok, error: error || '', host: targetHost, port: targetPort, mode: 'tcp' });
    };
    socket.setTimeout(ms);
    socket.on('connect', () => finish(true, ''));
    socket.on('timeout', () => finish(false, '连接超时'));
    socket.on('error', (err) => finish(false, err && err.message ? err.message : '连接失败'));
  });
}

function resolveTestPayload(src) {
  const body = src && typeof src === 'object' ? src : {};
  const type = TYPES[body.type] ? body.type : 'mysql';
  const existing = body.id ? getConnection(body.id) : null;
  let password = body.password;
  if ((password == null || password === '') && existing) {
    password = existing.password;
  }
  const meta = TYPES[type];
  return {
    id: body.id ? String(body.id) : '',
    type,
    host: String(body.host || (existing && existing.host) || '127.0.0.1').trim() || '127.0.0.1',
    port: Number(body.port) > 0
      ? Math.trunc(Number(body.port))
      : (existing && existing.port) || meta.port,
    username: String(body.username != null ? body.username : (existing && existing.username) || '').trim(),
    password: String(password == null ? '' : password),
    database: String(body.database != null ? body.database : (existing && existing.database) || '').trim()
  };
}

/** MySQL 校验账号/库；其他类型仅探测主机端口 */
async function testConnection(src, timeoutMs) {
  const payload = resolveTestPayload(src);
  if (payload.type === 'mysql') {
    const mysqlStore = require('./mysqlStore');
    const result = await mysqlStore.probe(payload, timeoutMs);
    if (result.ok) {
      const dbHint = result.database ? ` / ${result.database}` : '';
      result.message = `MySQL 连接成功 ${result.host}:${result.port}${dbHint}`;
    }
    return result;
  }
  if (payload.type === 'mongodb') {
    const mongodbStore = require('./mongodbStore');
    const result = await mongodbStore.probe(payload, timeoutMs);
    if (result.ok) {
      const dbHint = result.database ? ` / ${result.database}` : '';
      result.message = `MongoDB 连接成功 ${result.host}:${result.port}${dbHint}`;
    }
    return result;
  }
  const result = await testReachable(payload.host, payload.port, timeoutMs);
  if (result.ok) {
    result.message = `主机端口可达（${payload.type} 暂不校验账号密码）`;
  }
  return result;
}

loadStore();

module.exports = {
  listConnections,
  listPublicConnections,
  getConnection,
  upsertConnection,
  persistRemote,
  deleteConnection,
  publicConnection,
  jdbcUrl,
  jdbcPoolName,
  dataSourceName,
  testReachable,
  testConnection,
  resolveTestPayload,
  TYPES
};
