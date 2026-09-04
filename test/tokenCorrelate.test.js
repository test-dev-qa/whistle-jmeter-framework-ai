'use strict';

const { test, assert, assertEqual } = require('./harness');
const { correlateTokens, findToken, substitute, parseLeaves } = require('../lib/tokenCorrelate');

const TOKEN = 'abcdefghijklmnopqr';

test('tokenCorrelate / findToken prefers access_token', () => {
  const token = findToken(JSON.stringify({ access_token: TOKEN, token: `${TOKEN}zzzz` }));
  assert(token);
  assertEqual(token.value, TOKEN);
  assertEqual(findToken('not json'), null);
  assertEqual(findToken('{"msg":"ok"}'), null);
});

test('tokenCorrelate / parseLeaves skips status copy and keeps business id', () => {
  const leaves = parseLeaves(JSON.stringify({
    code: 0,
    message: 'ok',
    orderId: 'ORD-123456',
    createdAt: '2024-01-01T00:00:00Z'
  }));
  assert(leaves.some((item) => item.key === 'orderId'));
  assert(!leaves.some((item) => item.key === 'message'));
});

test('tokenCorrelate / substitute long value in header and path', () => {
  const out = substitute(`Bearer ${TOKEN}`, [{ value: TOKEN, varName: 'authToken' }]);
  assertEqual(out, 'Bearer ${authToken}');
});

test('tokenCorrelate / extractor on login and replace later header', () => {
  const plans = correlateTokens([
    {
      url: 'https://example.com/login',
      method: 'POST',
      requestHeaders: {},
      requestBody: '{}',
      responseBody: JSON.stringify({ access_token: TOKEN, orderId: 'ORD-123456' })
    },
    {
      url: 'https://example.com/order/ORD-123456',
      method: 'GET',
      requestHeaders: { Authorization: `Bearer ${TOKEN}` },
      requestBody: '',
      responseBody: '{}'
    }
  ]);
  assert(plans[0].extractors.some((item) => item.varName === 'authToken'));
  assert(plans[1].headers.Authorization.includes('${authToken}'));
  assert(plans[1].path.includes('${orderId}') || plans[1].path.includes('ORD-123456'));
});

test('tokenCorrelate / html csrf extracted when reused later', () => {
  const csrf = 'csrf_token_value_ok';
  const plans = correlateTokens([
    {
      url: 'https://example.com/form',
      method: 'GET',
      requestHeaders: {},
      requestBody: '',
      responseBody: `<html><input type="hidden" name="_csrf" value="${csrf}"></html>`
    },
    {
      url: 'https://example.com/save',
      method: 'POST',
      requestHeaders: { 'Content-Type': 'application/x-www-form-urlencoded' },
      requestBody: `_csrf=${csrf}&a=1`,
      responseBody: '{}'
    }
  ]);
  assert(plans[0].extractors.some((item) => item.varName === 'csrfToken' || item.sourceKey === 'csrfToken'));
  assert(plans[1].body.includes('${csrfToken}'));
});

test('tokenCorrelate / unused token is not extracted', () => {
  const plans = correlateTokens([
    {
      url: 'https://example.com/login',
      method: 'POST',
      requestHeaders: {},
      requestBody: '{}',
      responseBody: JSON.stringify({ access_token: TOKEN })
    },
    {
      url: 'https://example.com/health',
      method: 'GET',
      requestHeaders: {},
      requestBody: '',
      responseBody: '{}'
    }
  ]);
  assertEqual(plans[0].extractors.length, 0);
});

test('tokenCorrelate / sign fields are skipped', () => {
  const plans = correlateTokens([
    {
      url: 'https://example.com/a',
      method: 'POST',
      requestHeaders: {},
      requestBody: '{}',
      responseBody: JSON.stringify({ sign: 'abcdef1234567890', orderId: 'ORD-999888' })
    },
    {
      url: 'https://example.com/b',
      method: 'POST',
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: JSON.stringify({ sign: 'abcdef1234567890', orderId: 'ORD-999888' }),
      responseBody: '{}'
    }
  ]);
  assert(!plans[0].extractors.some((item) => /sign/i.test(item.varName) || item.sourceKey === 'sign'));
  assert(plans[1].body.includes('${orderId}'));
});

test('tokenCorrelate / response header and cursor reused later', () => {
  const plans = correlateTokens([
    {
      url: 'https://example.com/list',
      method: 'GET',
      requestHeaders: {},
      requestBody: '',
      responseHeaders: { 'X-Request-Id': 'req-123456789' },
      responseBody: JSON.stringify({ cursor: 'CUR-abcdef' })
    },
    {
      url: 'https://example.com/list?cursor=CUR-abcdef',
      method: 'GET',
      requestHeaders: { 'X-Request-Id': 'req-123456789' },
      requestBody: '',
      responseBody: '{}'
    }
  ]);
  assert(plans[0].extractors.some((item) => item.useHeaders || item.kind === 'header' || item.sourceKey === 'XRequestId' || item.varName.toLowerCase().includes('request')));
  assert(plans[1].path.includes('${cursor}') || plans[1].path.includes('CUR-abcdef'));
  const cursor = plans[0].extractors.find((item) => item.sourceKey === 'cursor' || item.kind === 'cursor');
  assert(cursor);
});

test('tokenCorrelate / nested json string and query substitution', () => {
  const { substitutePath } = require('../lib/tokenCorrelate');
  const plans = correlateTokens([
    {
      url: 'https://example.com/create',
      method: 'POST',
      requestHeaders: {},
      requestBody: '{}',
      responseBody: JSON.stringify({ data: JSON.stringify({ ticket: 'TICKET-778899' }) })
    },
    {
      url: 'https://example.com/pay?ticket=TICKET-778899',
      method: 'GET',
      requestHeaders: {},
      requestBody: '',
      responseBody: '{}'
    }
  ]);
  assert(plans[0].extractors.some((item) => item.sourceKey === 'ticket' && item.type === 'regex'));
  assert(plans[1].path.includes('ticket=${ticket}') || plans[1].path.includes('${ticket}'));
  const q = substitutePath('/x?ticket=TICKET-778899', [{ value: 'TICKET-778899', varName: 'ticket' }]);
  assertEqual(q, '/x?ticket=${ticket}');
});

test('tokenCorrelate / location code and disable edit', () => {
  const records = [
    {
      url: 'https://example.com/oauth',
      method: 'GET',
      requestHeaders: {},
      requestBody: '',
      responseHeaders: { Location: 'https://app.example.com/cb?code=AUTHCODE99' },
      responseBody: ''
    },
    {
      url: 'https://example.com/token',
      method: 'POST',
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: JSON.stringify({ code: 'AUTHCODE99' }),
      responseBody: '{}'
    }
  ];
  const plans = correlateTokens(records);
  assert(plans[0].extractors.some((item) => item.useHeaders && (item.sourceKey === 'code' || item.kind === 'location')));
  const id = plans.report.vars[0].id;
  const edited = correlateTokens(records, { edits: { disabled: [id] } });
  assertEqual(edited[0].extractors.length, 0);
  assert(edited[1].body.includes('AUTHCODE99'));
});

test('tokenCorrelate / static value seen earlier is not extracted', () => {
  const plans = correlateTokens([
    {
      url: 'https://example.com/a?tenant=TENANT99',
      method: 'GET',
      requestHeaders: {},
      requestBody: '',
      responseBody: '{}'
    },
    {
      url: 'https://example.com/b',
      method: 'GET',
      requestHeaders: {},
      requestBody: '',
      responseBody: JSON.stringify({ tenant: 'TENANT99' })
    },
    {
      url: 'https://example.com/c?tenant=TENANT99',
      method: 'GET',
      requestHeaders: {},
      requestBody: '',
      responseBody: '{}'
    }
  ]);
  assert(!plans[1].extractors.some((item) => item.varName.toLowerCase().includes('tenant')));
});
