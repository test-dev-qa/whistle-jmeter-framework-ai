'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');
const { safeRecordId, getHeader, normalizeHeaders } = require('./utils');
const { extractJsonPath, stringifyValue } = require('./jsonPath');
const postOpStore = require('./postOpStore');

const STORE_FILE = path.join(DATA_DIR, 'assertions.json');
const MAX_PER_RECORD = 20;
const SOURCES = new Set(['json', 'header', 'text', 'status']);
const OPERATORS = new Set(['equals', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists', 'regex']);

const OPERATOR_LABELS = {
  equals: '等于',
  not_equals: '不等于',
  contains: '包含',
  not_contains: '不包含',
  exists: '存在',
  not_exists: '不存在',
  regex: '正则匹配'
};

let store = {};

function loadFromSqlite() {
  try {
    const mapped = postOpStore.loadKind('assert');
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
      postOpStore.saveRecord('assert', id, store[id]);
    } catch (e) {
      // ignore migrate failure
    }
  });
}

function persistRecord(id, items) {
  saveStore();
  try {
    postOpStore.saveRecord('assert', id, items || []);
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

function createId() {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function defaultName(item) {
  if (item.source === 'status') return 'HTTP Code';
  if (item.source === 'header') return item.headerName || 'Header';
  if (item.source === 'text') return 'Response Text';
  return item.jsonPath && item.jsonPath !== '$' ? item.jsonPath : 'JSON';
}

function normalizeItem(src) {
  const source = SOURCES.has(src && src.source) ? src.source : 'json';
  const operator = OPERATORS.has(src && src.operator) ? src.operator : 'equals';
  const jsonPath = source === 'json' ? (String((src && src.jsonPath) || '$').trim() || '$') : '';
  const name = String((src && src.name) || '').trim().slice(0, 80);
  return {
    id: String((src && src.id) || createId()).slice(0, 80),
    name,
    source,
    jsonPath,
    headerName: source === 'header' ? String((src && src.headerName) || '').trim().slice(0, 120) : '',
    arrayUnpack: source === 'json' && Boolean(src && src.arrayUnpack),
    operator,
    expected: operator === 'exists' || operator === 'not_exists' ? '' : String((src && src.expected) == null ? '' : src.expected).slice(0, 2000),
    enabled: src && src.enabled === false ? false : true
  };
}

function itemSignature(item) {
  return [
    item.source,
    item.jsonPath || '',
    String(item.headerName || '').toLowerCase(),
    item.operator,
    item.expected,
    item.arrayUnpack ? '1' : '0'
  ].join('|');
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
      postOpStore.deleteRecords('assert', ids.map(safeRecordId));
    } catch (e) {
      // ignore
    }
  }
}

function clearAll() {
  store = {};
  saveStore();
  try {
    postOpStore.clearKind('assert');
  } catch (e) {
    // ignore
  }
}

function getAssertionsForRecords(ids) {
  return (ids || []).map((id) => listForRecord(id).filter((item) => item.enabled));
}

function resolveActual(record, item) {
  if (!record || !item) return { ok: false, error: '记录不存在', actual: '' };
  if (item.source === 'status') {
    const code = record.responseStatus == null ? '' : String(record.responseStatus);
    if (!code) return { ok: false, error: '没有状态码', actual: '' };
    return { ok: true, actual: code };
  }
  if (item.source === 'header') {
    if (!item.headerName) return { ok: false, error: '请填写响应头名称', actual: '' };
    const value = getHeader(normalizeHeaders(record.responseHeaders || {}), item.headerName);
    if (item.operator === 'exists' || item.operator === 'not_exists') {
      return { ok: true, actual: value == null ? '' : stringifyValue(value) };
    }
    if (value == null || value === '') {
      return { ok: false, error: `响应头 ${item.headerName} 不存在`, actual: '' };
    }
    return { ok: true, actual: stringifyValue(value) };
  }
  if (item.source === 'text') {
    const text = String(record.responseBody == null ? '' : record.responseBody);
    return { ok: true, actual: text };
  }
  const extracted = extractJsonPath(record.responseBody, item.jsonPath || '$', { unpackArray: item.arrayUnpack });
  if (!extracted.ok) return { ok: false, error: extracted.error || '未匹配到结果', actual: '' };
  const actual = extracted.values && extracted.values.length === 1
    ? extracted.values[0]
    : extracted.preview;
  return { ok: true, actual: actual == null ? '' : String(actual) };
}

function compare(actual, item) {
  const expected = item.expected == null ? '' : String(item.expected);
  const text = actual == null ? '' : String(actual);
  switch (item.operator) {
    case 'equals':
      return text === expected;
    case 'not_equals':
      return text !== expected;
    case 'contains':
      return text.indexOf(expected) >= 0;
    case 'not_contains':
      return text.indexOf(expected) < 0;
    case 'exists':
      return text !== '';
    case 'not_exists':
      return text === '';
    case 'regex':
      try {
        return new RegExp(expected).test(text);
      } catch (e) {
        return false;
      }
    default:
      return text === expected;
  }
}

function evaluateAssertion(record, item) {
  const resolved = resolveActual(record, normalizeItem(item));
  if (!resolved.ok && item.operator !== 'not_exists' && item.operator !== 'exists') {
    return {
      ok: false,
      passed: false,
      error: resolved.error,
      actual: resolved.actual || '',
      expected: item.expected || '',
      operator: item.operator
    };
  }
  const actual = resolved.actual || '';
  const passed = compare(actual, normalizeItem(item));
  return {
    ok: true,
    passed,
    actual,
    expected: item.expected || '',
    operator: item.operator,
    message: passed ? '断言通过' : '断言失败'
  };
}

function responseTestType(operator) {
  if (operator === 'contains') return 2;
  if (operator === 'not_contains') return 6;
  if (operator === 'not_equals') return 12;
  if (operator === 'regex') return 1;
  return 8;
}

function toJmeterAssertion(item) {
  const name = item.name || defaultName(item);
  if (item.source === 'json') {
    const invert = item.operator === 'not_equals' || item.operator === 'not_contains' || item.operator === 'not_exists';
    const existsOnly = item.operator === 'exists' || item.operator === 'not_exists';
    const isRegex = item.operator === 'regex' || item.operator === 'contains' || item.operator === 'not_contains';
    let expected = item.expected || '';
    if (item.operator === 'contains' || item.operator === 'not_contains') {
      expected = `.*${String(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`;
    }
    return {
      kind: 'jsonpath',
      name,
      jsonPath: item.jsonPath || '$',
      expected,
      validate: !existsOnly,
      invert,
      isRegex
    };
  }
  let field = 'Assertion.response_data';
  if (item.source === 'status') field = 'Assertion.response_code';
  if (item.source === 'header') field = 'Assertion.response_headers';
  let testString = item.expected || '';
  if (item.source === 'header' && item.headerName) {
    testString = item.operator === 'exists' || item.operator === 'not_exists'
      ? item.headerName
      : `${item.headerName}: ${item.expected}`;
  }
  return {
    kind: 'response',
    name,
    field,
    testType: responseTestType(item.operator === 'exists' ? 'contains' : (item.operator === 'not_exists' ? 'not_contains' : item.operator)),
    testString
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
  getAssertionsForRecords,
  evaluateAssertion,
  toJmeterAssertion,
  normalizeItem,
  OPERATOR_LABELS,
  OPERATORS: Array.from(OPERATORS),
  MAX_PER_RECORD
};
