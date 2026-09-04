'use strict';

const { test, assert, assertEqual } = require('./harness');
const { setForRecord, clearAll, evaluateAssertion, toJmeterAssertion } = require('../lib/assertions');
const { generateJMX } = require('../lib/jmxGenerator');

test('assertions / equals json path and dedupe', () => {
  clearAll();
  const record = {
    id: 'assert-1',
    responseBody: JSON.stringify({ code: 200, msg: 'ok', data: { id: 4 } }),
    responseStatus: 200
  };
  const passed = evaluateAssertion(record, {
    source: 'json',
    jsonPath: '$.code',
    operator: 'equals',
    expected: '200'
  });
  assert(passed.passed);
  const failed = evaluateAssertion(record, {
    source: 'json',
    jsonPath: '$.code',
    operator: 'equals',
    expected: '500'
  });
  assert(!failed.passed);

  const items = setForRecord('assert-1', [
    { source: 'json', jsonPath: '$.code', operator: 'equals', expected: '200', name: 'code' },
    { source: 'json', jsonPath: '$.code', operator: 'equals', expected: '200', name: 'code' }
  ]);
  assertEqual(items.length, 1);
  clearAll();
});

test('assertions / jmx writes JSONPathAssertion', () => {
  clearAll();
  const rec = {
    id: 'assert-jmx-1',
    url: 'https://example.com/api',
    method: 'GET',
    requestHeaders: {},
    requestBody: '',
    responseStatus: 200,
    responseBody: JSON.stringify({ code: 200 })
  };
  setForRecord('assert-jmx-1', [{
    name: 'codeEquals',
    source: 'json',
    jsonPath: '$.code',
    operator: 'equals',
    expected: '200'
  }]);
  const xml = generateJMX([rec], { correlateToken: false });
  assert(xml.includes('JSONPathAssertion'));
  assert(xml.includes('$.code'));
  assert(xml.includes('codeEquals'));
  clearAll();
});

test('assertions / status and header operators', () => {
  const record = {
    responseStatus: 201,
    responseHeaders: { 'X-Trace': 'abc' },
    responseBody: 'hello world'
  };
  assert(evaluateAssertion(record, { source: 'status', operator: 'equals', expected: '201' }).passed);
  assert(evaluateAssertion(record, { source: 'header', headerName: 'X-Trace', operator: 'equals', expected: 'abc' }).passed);
  assert(evaluateAssertion(record, { source: 'text', operator: 'contains', expected: 'hello' }).passed);
  assert(evaluateAssertion(record, { source: 'json', jsonPath: '$.missing', operator: 'not_exists' }).passed);
});
