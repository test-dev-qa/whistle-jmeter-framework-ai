'use strict';

const { test, assert, assertEqual } = require('./harness');
const { extractJsonPath, evalJsonPath, toJsonPath, lastPathKey } = require('../lib/jsonPath');

test('jsonPath / dot and index', () => {
  const data = { data: { rows: [{ id: 4, name: 'a' }] } };
  const result = extractJsonPath(data, '$.data.rows[0].id');
  assert(result.ok);
  assertEqual(result.preview, '4');
  assertEqual(toJsonPath(['data', 'rows', 0, 'id']), '$.data.rows[0].id');
});

test('jsonPath / wildcard and unpack', () => {
  const data = { data: { rows: [{ id: 1 }, { id: 2 }] } };
  const packed = extractJsonPath(data, '$.data.rows');
  assert(packed.ok);
  const unpacked = extractJsonPath(data, '$.data.rows', { unpackArray: true });
  assertEqual(unpacked.values.length, 2);
  const ids = evalJsonPath(data, '$.data.rows[*].id');
  assertEqual(ids.join(','), '1,2');
});

test('jsonPath / quoted key and recursive', () => {
  const data = { 'data-source': { nested: { url: 'http://x' } }, wrap: { url: 'http://y' } };
  const quoted = extractJsonPath(data, '$["data-source"].nested.url');
  assertEqual(quoted.preview, 'http://x');
  const rec = extractJsonPath(data, '$..url');
  assert(rec.ok);
  assertEqual(rec.values.length, 2);
});

test('jsonPath / db result array first row field', () => {
  const rows = [{ id: 'rec-1', seq: 1 }, { id: 'rec-2', seq: 2 }];
  const result = extractJsonPath(JSON.stringify(rows), '$[0].id');
  assert(result.ok);
  assertEqual(result.preview, 'rec-1');
});

test('jsonPath / lastPathKey and invalid', () => {
  assertEqual(lastPathKey('$.data.returnInfo.dataSourceUrl'), 'dataSourceUrl');
  const bad = extractJsonPath('not-json', '$.a');
  assert(!bad.ok);
});
