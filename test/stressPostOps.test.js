'use strict';

const http = require('http');
const { test, assert, assertEqual } = require('./harness');
const stressPostOps = require('../lib/stressPostOps');
const extractVars = require('../lib/extractVars');
const assertions = require('../lib/assertions');
const stressTest = require('../lib/stressTest');

test('stressPostOps / applyVars replaces both dialects', () => {
  const vars = { token: 'abc', id: '9' };
  assertEqual(stressPostOps.applyVars('Bearer ${token}', vars), 'Bearer abc');
  assertEqual(stressPostOps.applyVars('/x/{{id}}', vars), '/x/9');
  assertEqual(stressPostOps.applyVars('${missing}', vars), '${missing}');
});

test('stressPostOps / attachPostOps and assert fail in stress', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (req.url.indexOf('/login') >= 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 200, token: 'tok-' + hits }));
      return;
    }
    const auth = String(req.headers.authorization || '');
    const ok = auth.indexOf('tok-') >= 0;
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: ok ? 200 : 401 }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  const records = [
    {
      id: 'stress-login',
      url: base + '/login',
      method: 'POST',
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: '{}',
      responseBody: JSON.stringify({ code: 200, token: 'tok-seed' }),
      responseHeaders: { 'content-type': 'application/json' },
      responseStatus: 200
    },
    {
      id: 'stress-biz',
      url: base + '/biz',
      method: 'GET',
      requestHeaders: { Authorization: 'Bearer tok-seed' },
      requestBody: '',
      responseBody: JSON.stringify({ code: 200 }),
      responseHeaders: { 'content-type': 'application/json' },
      responseStatus: 200
    }
  ];

  extractVars.setForRecord('stress-login', [{
    varName: 'token',
    source: 'json',
    method: 'jsonpath',
    jsonPath: '$.token',
    enabled: true
  }]);
  assertions.setForRecord('stress-biz', [{
    name: 'code200',
    source: 'json',
    jsonPath: '$.code',
    operator: 'equals',
    expected: '200',
    enabled: true
  }]);

  const started = await stressTest.start(records, { users: 1, durationMin: 1, rampUpMin: 0 });
  assert(started.postOps && started.postOps.enabled);
  assertEqual(started.postOps.extracts, 1);
  assertEqual(started.postOps.asserts, 1);
  await new Promise((resolve) => setTimeout(resolve, 350));
  stressTest.stop();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const st = stressTest.getStatus();
  assert(st.result && st.result.total >= 1);
  assert(st.result.success >= 1);
  extractVars.setForRecord('stress-login', []);
  assertions.setForRecord('stress-biz', []);
  await new Promise((resolve) => server.close(resolve));
});
