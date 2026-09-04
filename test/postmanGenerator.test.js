'use strict';

const { test, assert, assertEqual, assertThrows } = require('./harness');
const { generatePostmanCollection } = require('../lib/postmanGenerator');

test('postmanGenerator / basic collection', () => {
  const col = generatePostmanCollection([
    {
      url: 'https://example.com/api/users?page=1',
      method: 'GET',
      requestHeaders: { Accept: 'application/json' },
      requestBody: '',
      responseStatus: 200
    },
    {
      url: 'https://example.com/api/login',
      method: 'POST',
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: '{"user":"a"}',
      responseStatus: 200
    }
  ], { correlateToken: false });
  assert(col.info.schema.indexOf('collection/v2.1.0') >= 0);
  assertEqual(col.item.length, 2);
  assertEqual(col.item[0].request.method, 'GET');
  assert(col.item[0].request.url.raw.indexOf('example.com') >= 0);
  assertEqual(col.item[1].request.body.mode, 'raw');
});

test('postmanGenerator / no records throws', () => {
  assertThrows(() => generatePostmanCollection(), /No records/);
});
