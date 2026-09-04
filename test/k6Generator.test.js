'use strict';

const { test, assert, assertThrows, assertMatch } = require('./harness');
const { generateK6Script, k6JsonSelector } = require('../lib/k6Generator');

test('k6Generator / k6JsonSelector strips json path prefix', () => {
  assertMatch(k6JsonSelector('$.access_token'), /^access_token$/);
  assertMatch(k6JsonSelector('$[0].id'), /^\[0\]\.id$/);
});

test('k6Generator / correlate token in script', () => {
  const token = 'abcdefghijklmnopqr';
  const script = generateK6Script([
    {
      url: 'https://example.com/login',
      method: 'POST',
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: '{}',
      responseBody: JSON.stringify({ access_token: token }),
      responseStatus: 200
    },
    {
      url: 'https://example.com/me',
      method: 'GET',
      requestHeaders: { Authorization: `Bearer ${token}` },
      requestBody: '',
      responseStatus: 200
    }
  ], { correlateToken: true, threads: 5, loops: 2, rampTime: 3 });
  assert(script.includes("import http from 'k6/http'"));
  assert(script.includes('vars.authToken'));
  assert(script.includes('Bearer ${authToken}') || script.includes('Bearer '));
  assert(script.includes('ramping-vus'));
  assert(script.includes('target: 5'));
});

test('k6Generator / no records throws', () => {
  assertThrows(() => generateK6Script(), /No records/);
});
