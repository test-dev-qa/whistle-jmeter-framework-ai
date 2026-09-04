'use strict';

const { test, assert, assertEqual, assertMatch, assertThrows } = require('./harness');
const { generateCSV } = require('../lib/csvGenerator');

function rec(extra) {
  return Object.assign({
    id: '1',
    timestamp: 1700000000000,
    url: 'https://example.com/a',
    method: 'GET',
    requestHeaders: { a: 'b' },
    requestBody: 'ok',
    responseStatus: 200,
    responseHeaders: {},
    responseBody: 'yes'
  }, extra || {});
}

test('csv / empty throws', () => {
  assertThrows(() => generateCSV([]), /No records/);
  assertThrows(() => generateCSV(null), /No records/);
});

test('csv / bom comma escape iso time binary and multipart', () => {
  const csv = generateCSV([rec({ requestBody: 'x,y' })]);
  assertEqual(csv.charCodeAt(0), 0xfeff);
  assert(csv.includes('"x,y"'));
  assert(csv.includes('2023-11-14T22:13:20.000Z'));
  const binary = generateCSV([rec({ requestBodyBinary: true, responseBodyBinary: true })]);
  assert(binary.includes('[binary]'));
  const mp = generateCSV([rec({ multipart: { fields: [{ name: 'a', value: '1' }], files: [] } })]);
  assert(mp.includes('fields'));
});

test('csv / formula injection prefix', () => {
  const csv = generateCSV([rec({ requestBody: '=1+1' })]);
  assert(csv.includes("'=1+1"));
  const plus = generateCSV([rec({ requestBody: '+cmd' })]);
  assert(plus.includes("'+cmd"));
});

test('csv / quotes and newlines escaped', () => {
  const csv = generateCSV([rec({ responseBody: 'a"b\nc' })]);
  assertMatch(csv, /""/);
});
