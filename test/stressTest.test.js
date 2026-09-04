'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { test, assert, assertEqual, assertThrows } = require('./harness');
const stressTest = require('../lib/stressTest');

test('stressTest / normalizeConfig clamps ranges', () => {
  const cfg = stressTest.normalizeConfig({ users: 99999, durationMin: 0, rampUpMin: -1 });
  assertEqual(cfg.users, 5000);
  assertEqual(cfg.durationMin, 1);
  assertEqual(cfg.rampUpMin, 0);
});

test('stressTest / buildRequest skips hop headers', () => {
  const req = stressTest.buildRequest({
    url: 'https://example.com/api',
    method: 'POST',
    requestHeaders: {
      'Content-Type': 'application/json',
      Host: 'example.com',
      Connection: 'keep-alive',
      'X-Token': 'abc'
    },
    requestBody: '{"a":1}'
  });
  assertEqual(req.method, 'POST');
  assertEqual(req.body, '{"a":1}');
  assertEqual(req.headers['X-Token'], 'abc');
  assertEqual(req.headers.Host, undefined);
  assertEqual(req.headers.Connection, undefined);
});

test('stressTest / buildRequest rejects non-http', () => {
  assertThrows(() => stressTest.buildRequest({ url: 'ftp://x', method: 'GET' }), /http\/https/);
});

test('stressTest / classifies HTTP 4xx and 5xx as failed by default', () => {
  assertEqual(stressTest.isHttpFailureStatus(200), false);
  assertEqual(stressTest.isHttpFailureStatus(302), false);
  assertEqual(stressTest.isHttpFailureStatus(400), true);
  assertEqual(stressTest.isHttpFailureStatus(499), true);
  assertEqual(stressTest.isHttpFailureStatus(500), true);
  assertEqual(stressTest.isHttpFailureStatus(599), true);
});

test('stressTest / measures elapsed time with sub-millisecond precision', () => {
  assertEqual(stressTest.elapsedMsBetween(0n, 1234567n), 1.235);
  assertEqual(stressTest.elapsedMsBetween(0n, 999999n), 1);
});

test('stressTest / calculates API and summary metrics from all request samples', () => {
  const req = {
    method: 'GET',
    name: '指标校验接口',
    url: 'http://example.test/metrics',
    path: '/metrics',
    headers: {},
    body: ''
  };
  const state = {
    stats: stressTest.emptyStats([req]),
    startedAt: 1000,
    endedAt: 3000,
    status: 'finished',
    config: {},
    requests: [req],
    endsAt: 3000,
    activeUsers: 0,
    reportId: 'metrics-test',
    executionSamples: [],
    executionDropped: 0,
    postOps: null,
    lastError: ''
  };
  [
    { ok: true, status: 200, latencyMs: 0 },
    { ok: false, status: 400, latencyMs: 2, error: 'HTTP 400' },
    { ok: false, status: 500, latencyMs: 4, error: 'HTTP 500' },
    { ok: true, status: 302, latencyMs: 10 }
  ].forEach((sample) => stressTest.recordSample(state, req, sample));

  const api = stressTest.buildApiRows(state)[0];
  assertEqual(api.total, 4);
  assertEqual(api.success, 2);
  assertEqual(api.failed, 2);
  assertEqual(api.rps, 2);
  assertEqual(api.avgLatencyMs, 4);
  assertEqual(api.minLatencyMs, 0);
  assertEqual(api.maxLatencyMs, 10);
  assertEqual(api.p90LatencyMs, 10);
  assertEqual(api.failRate, 50);

  const summary = stressTest.buildLiveSnapshot(state).result;
  assertEqual(summary.total, 4);
  assertEqual(summary.success, 2);
  assertEqual(summary.failed, 2);
  assertEqual(summary.rps, 2);
  assertEqual(summary.avgLatencyMs, 4);
  assertEqual(summary.p90LatencyMs, 10);
  assertEqual(summary.failRate, 50);
});

test('stressTest / percentile', () => {
  assertEqual(stressTest.percentile([1, 2, 3, 4, 5], 50), 3);
  assertEqual(stressTest.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assertEqual(stressTest.percentile([], 95), 0);
});

test('stressTest / saveConfig persists under DATA_DIR', () => {
  const saved = stressTest.saveConfig({ users: 17, durationMin: 10, rampUpMin: 0 });
  assertEqual(saved.users, 17);
  assertEqual(saved.durationMin, 10);
  assertEqual(stressTest.getConfig().users, 17);
  const file = path.join(process.env.JMETER_EXPORTER_DATA_DIR || '', 'stressConfig.json');
  if (file && fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEqual(parsed.users, 17);
  }
});

test('stressTest / start and stop against local server', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const records = [{
    id: 's1',
    url: 'http://127.0.0.1:' + port + '/ping',
    method: 'GET',
    requestHeaders: {},
    requestBody: ''
  }];
  const started = await stressTest.start(records, { users: 2, durationMin: 1, rampUpMin: 0 });
  assertEqual(started.status, 'running');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const stopped = stressTest.stop();
  assert(stopped.status === 'stopping' || stopped.status === 'stopped' || stopped.status === 'finished');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const finalStatus = stressTest.getStatus();
  assert(finalStatus.result && finalStatus.result.total >= 1);
  assert(finalStatus.reportSaved);
  assert(finalStatus.lastReportId);
  const frozenRps = finalStatus.result.rps;
  await new Promise((resolve) => setTimeout(resolve, 120));
  const again = stressTest.getStatus();
  assertEqual(again.result.rps, frozenRps);
  const reportStore = require('../lib/stressReportStore');
  const report = reportStore.getReport(finalStatus.lastReportId);
  assert(report);
  assert(report.apis && report.apis.length >= 1);
  assert(report.executions && report.executions.length >= 1);
  assertEqual(report.executions[0].method, 'GET');
  assert(report.executions[0].at > 0);
  assert(Array.isArray(report.series));
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test('stressTest / downsampleSeries keeps endpoints', () => {
  const points = [];
  for (let i = 0; i < 1200; i += 1) points.push({ ts: i, rps: i });
  const out = stressTest.downsampleSeries(points, 600);
  assertEqual(out.length, 600);
  assertEqual(out[0].ts, 0);
  assertEqual(out[out.length - 1].ts, 1199);
});

test('stressTest / buildRequest rejects binary body', () => {
  assertThrows(
    () => stressTest.buildRequest({
      url: 'http://127.0.0.1/x',
      method: 'POST',
      requestBodyBinary: true
    }),
    /二进制/
  );
});

test('stressTest / rejects start while stopping', async () => {
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    }, 300);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const records = [{
    id: 's2',
    url: 'http://127.0.0.1:' + port + '/ping',
    method: 'GET',
    requestHeaders: {},
    requestBody: ''
  }];
  await stressTest.start(records, { users: 4, durationMin: 1, rampUpMin: 0 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  stressTest.stop();
  let rejected = false;
  try {
    await stressTest.start(records, { users: 1, durationMin: 1, rampUpMin: 0 });
  } catch (e) {
    rejected = /停止|运行/.test(String(e && e.message || e));
  }
  assert(rejected);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});
