'use strict';

const { test, assert, assertEqual } = require('./harness');
const {
  addRecord,
  getRecordById,
  getRecords,
  getRecordSummaries,
  getRecordsByIds,
  deleteRecordsByIds,
  clearRecords,
  getLastRecord,
  getStorageType,
  getStorageInfo,
  MAX_RECORDS,
  MAX_PERSIST_BODY
} = require('../lib/dataStore');

function rec(id, extra) {
  return Object.assign({
    id,
    url: `https://example.com/${id}`,
    method: 'GET',
    requestHeaders: {},
    requestBody: 'body',
    responseStatus: 200,
    responseHeaders: {},
    responseBody: 'ok',
    timestamp: Date.now()
  }, extra || {});
}

test('dataStore / replace same id and storage type', () => {
  clearRecords();
  addRecord(rec('dup-1', { requestBody: 'v1' }));
  addRecord(rec('dup-1', { requestBody: 'v2' }));
  assertEqual(getRecords().filter((item) => item.id === 'dup-1').length, 1);
  assertEqual(getRecordById('dup-1').requestBody, 'v2');
  assert(['sqlite', 'json', 'memory', 'mysql'].includes(getStorageType()));
  const info = getStorageInfo();
  assertEqual(info.persistEngine, 'sqlite');
  assert(['sqlite', 'json', 'memory'].includes(info.type));
  assertEqual(info.fallback, false);
  clearRecords();
});

test('dataStore / summaries omit bodies; get by ids; last record; delete', () => {
  clearRecords();
  addRecord(rec('a', { requestBody: 'secret' }));
  addRecord(rec('b'));
  const summaries = getRecordSummaries();
  assertEqual(summaries.length, 2);
  assert(!('requestBody' in summaries[0]));
  assertEqual(summaries[0].name, 'a');
  assertEqual(summaries[0].initiator, 'Other');
  assert(typeof summaries[0].size === 'number');
  assertEqual('mimeType' in summaries[0], true);
  assertEqual(getRecordsByIds(['b']).length, 1);
  assertEqual(getLastRecord().id, 'b');
  assertEqual(deleteRecordsByIds(['a']), 1);
  assertEqual(getRecordById('a'), null);
  assertEqual(getRecords().length, 1);
  clearRecords();
  assertEqual(getRecords().length, 0);
});

test('dataStore / MAX_RECORDS is 10000', () => {
  assertEqual(MAX_RECORDS, 10000);
});

test('dataStore / MAX_PERSIST_BODY is 1024KB', () => {
  assertEqual(MAX_PERSIST_BODY, 1024 * 1024);
});

test('dataStore / missing record and empty delete', () => {
  clearRecords();
  assertEqual(getRecordById('nope'), null);
  assertEqual(deleteRecordsByIds([]), 0);
  assertEqual(getRecordsByIds([]).length, 0);
});

test('dataStore / sqlite keeps bodies off heap until read', () => {
  clearRecords();
  if (getStorageType() !== 'sqlite') return;
  addRecord(rec('mem-1', {
    requestBody: 'req-secret-payload',
    responseBody: 'res-secret-payload',
    requestHeaders: {
      Referer: 'https://example.com/from',
      Authorization: 'Bearer secret-token-should-not-stay',
      'Content-Type': 'application/json'
    },
    responseHeaders: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'sid=abc'
    }
  }));
  const summaries = getRecordSummaries();
  assertEqual(summaries.length, 1);
  assertEqual(summaries[0].requestBodySize, Buffer.byteLength('req-secret-payload', 'utf8'));
  assertEqual(summaries[0].responseBodySize, Buffer.byteLength('res-secret-payload', 'utf8'));
  assertEqual(summaries[0].initiator, 'from');
  assertEqual(getRecordById('mem-1').requestBody, 'req-secret-payload');
  assertEqual(getRecordById('mem-1').responseBody, 'res-secret-payload');
  assertEqual(getRecordById('mem-1').requestHeaders.Authorization, 'Bearer secret-token-should-not-stay');
  assertEqual(getRecordsByIds(['mem-1'])[0].responseBody, 'res-secret-payload');
  clearRecords();
});
