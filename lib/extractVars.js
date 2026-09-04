'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');
const { safeRecordId, getHeader, normalizeHeaders } = require('./utils');
const { extractJsonPath, lastPathKey, stringifyValue } = require('./jsonPath');
const postOpStore = require('./postOpStore');

const STORE_FILE = path.join(DATA_DIR, 'extractVars.json');
const MAX_PER_RECORD = 20;
const SOURCES = new Set(['json', 'header', 'text']);

let store = {};

function loadFromSqlite() {
  try {
    const mapped = postOpStore.loadKind('extract');
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
      postOpStore.saveRecord('extract', id, store[id]);
    } catch (e) {
      // ignore migrate failure
    }
  });
}

function persistRecord(id, items) {
  saveStore();
  try {
    postOpStore.saveRecord('extract', id, items || []);
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

function sanitizeVarName(name) {
  let out = String(name || '').replace(/[^A-Za-z0-9_]/g, '_');
  if (!out) out = 'extracted';
  if (!/^[A-Za-z_]/.test(out)) out = `var_${out}`;
  return out.slice(0, 60);
}

function createId() {
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeItem(src, fallbackName) {
  const source = SOURCES.has(src && src.source) ? src.source : 'json';
  const method = src && src.method === 'whole' ? 'whole' : 'jsonpath';
  const jsonPath = method === 'whole' ? '$' : String((src && src.jsonPath) || '$').trim() || '$';
  const varName = sanitizeVarName((src && src.varName) || lastPathKey(jsonPath) || fallbackName || 'extracted');
  return {
    id: String((src && src.id) || createId()).slice(0, 80),
    varName,
    source,
    method: source === 'json' ? method : (source === 'header' ? 'header' : 'text'),
    jsonPath: source === 'json' ? jsonPath : '',
    headerName: source === 'header' ? String((src && src.headerName) || '').trim().slice(0, 120) : '',
    arrayUnpack: source === 'json' && Boolean(src && src.arrayUnpack),
    enabled: src && src.enabled === false ? false : true
  };
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

function extractSignature(item) {
  if (item.source === 'header') return `header:${String(item.headerName || '').toLowerCase()}`;
  if (item.source === 'text') return 'text';
  return `json:${item.method || 'jsonpath'}:${item.jsonPath || '$'}:${item.arrayUnpack ? 1 : 0}`;
}

function dedupeItems(items) {
  const byName = new Map();
  const bySig = new Map();
  const out = [];
  (Array.isArray(items) ? items : []).forEach((raw) => {
    const item = normalizeItem(raw);
    const nameKey = item.varName.toLowerCase();
    const sig = extractSignature(item);
    const existing = byName.get(nameKey) || bySig.get(sig);
    if (existing) {
      const prevName = existing.varName.toLowerCase();
      const prevSig = extractSignature(existing);
      Object.assign(existing, item, { id: existing.id });
      if (prevName !== existing.varName.toLowerCase()) byName.delete(prevName);
      if (prevSig !== extractSignature(existing)) bySig.delete(prevSig);
      byName.set(existing.varName.toLowerCase(), existing);
      bySig.set(extractSignature(existing), existing);
      return;
    }
    out.push(item);
    byName.set(nameKey, item);
    bySig.set(sig, item);
  });
  return out.slice(0, MAX_PER_RECORD);
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
      postOpStore.deleteRecords('extract', ids.map(safeRecordId));
    } catch (e) {
      // ignore
    }
  }
}

function clearAll() {
  store = {};
  saveStore();
  try {
    postOpStore.clearKind('extract');
  } catch (e) {
    // ignore
  }
}

function getExtractorsForRecords(ids) {
  return (ids || []).map((id) => listForRecord(id).filter((item) => item.enabled));
}

function buildPreviewRecord(loaded, src) {
  const extra = src && typeof src === 'object' ? src : {};
  const record = loaded && typeof loaded === 'object' ? loaded : {};
  const fromLoaded = record.responseBody == null ? '' : String(record.responseBody);
  const fromExtra = extra.responseBody == null ? '' : String(extra.responseBody);
  const responseBody = fromLoaded || fromExtra;
  const loadedHeaders = record.responseHeaders;
  const extraHeaders = extra.responseHeaders;
  const responseHeaders = loadedHeaders && typeof loadedHeaders === 'object' && Object.keys(loadedHeaders).length
    ? loadedHeaders
    : (extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : (loadedHeaders || {}));
  return Object.assign({}, extra, record, { responseBody, responseHeaders });
}

function resolveItemValue(record, item) {
  if (!record || !item) return { ok: false, error: '记录不存在', values: [], preview: '' };
  if (item.source === 'header') {
    if (!item.headerName) return { ok: false, error: '请填写响应头名称', values: [], preview: '' };
    const value = getHeader(normalizeHeaders(record.responseHeaders || record.headers || {}), item.headerName);
    if (value == null || value === '') {
      return { ok: false, error: `响应头 ${item.headerName} 不存在`, values: [], preview: '' };
    }
    const text = stringifyValue(value);
    return { ok: true, values: [text], preview: text };
  }
  if (item.source === 'text') {
    const text = String(record.responseBody == null ? '' : record.responseBody);
    if (!text) return { ok: false, error: '响应体为空', values: [], preview: '' };
    return { ok: true, values: [text], preview: text.length > 4000 ? `${text.slice(0, 4000)}…` : text };
  }
  if (item.method === 'whole' || item.jsonPath === '$') {
    const text = String(record.responseBody == null ? '' : record.responseBody);
    if (!text) return { ok: false, error: '响应体为空', values: [], preview: '' };
    return { ok: true, values: [text], preview: text.length > 4000 ? `${text.slice(0, 4000)}…` : text };
  }
  return extractJsonPath(record.responseBody, item.jsonPath, { unpackArray: item.arrayUnpack });
}

function toJmeterExtractor(item) {
  if (item.source === 'header') {
    const name = item.headerName || 'X-Header';
    return {
      varName: item.varName,
      type: 'regex',
      useHeaders: true,
      regex: `${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*([^\\r\\n]+)`,
      kind: 'manual',
      sourceKey: name
    };
  }
  if (item.source === 'text' || item.method === 'whole') {
    return {
      varName: item.varName,
      type: 'regex',
      useHeaders: false,
      regex: '([\\s\\S]+)',
      kind: 'manual',
      sourceKey: item.varName
    };
  }
  return {
    varName: item.varName,
    type: 'json',
    jsonPath: item.jsonPath || '$',
    matchNumbers: item.arrayUnpack ? '0' : '1',
    kind: 'manual',
    sourceKey: lastPathKey(item.jsonPath)
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
  // ignore circular during early load
}

module.exports = {
  listForRecord,
  setForRecord,
  removeForRecords,
  clearAll,
  getExtractorsForRecords,
  resolveItemValue,
  buildPreviewRecord,
  toJmeterExtractor,
  normalizeItem,
  sanitizeVarName,
  dedupeItems,
  MAX_PER_RECORD
};
