'use strict';

const http = require('http');
const { test, assert, assertEqual } = require('./harness');
const stressNotify = require('../lib/stressNotify');

test('stressNotify / formatText includes fail items', () => {
  const text = stressNotify.formatText(
    {
      id: 'r1',
      status: 'finished',
      projectName: '订单中心',
      title: '2026-09-02 11:30:00 · 并发10 · 1000次 · RPS 50 · finished',
      summary: { total: 10, rps: 2, avgLatencyMs: 30, p90LatencyMs: 40, failRate: 5, avgDbLatencyMs: 12, dbTotal: 3 }
    },
    {
      enabled: true,
      passed: false,
      items: [{ label: '请求失败率', apiName: '订单查询', actual: 5, threshold: 1, op: 'lte', unit: '%', passed: false }]
    }
  );
  assert(text.indexOf('未通过') >= 0);
  assert(text.indexOf('订单中心') >= 0);
  assert(text.indexOf('并发10') >= 0);
  assert(text.indexOf('r1') < 0);
  assert(text.indexOf('请求失败率') >= 0);
  assert(text.indexOf('订单查询 - 请求失败率') >= 0);
  assert(text.indexOf('平均DB耗时') >= 0);
});

test('stressNotify / notifyThresholdResult posts webhook on fail', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/hook';

  const result = await stressNotify.notifyThresholdResult(
    { id: 'r2', status: 'finished', summary: { total: 1, failRate: 10, rps: 1, avgLatencyMs: 1, p90LatencyMs: 1 } },
    {
      enabled: true,
      passed: false,
      failedCount: 1,
      items: [{ key: 'failRate', label: '请求失败率', actual: 10, threshold: 1, op: 'lte', unit: '%', passed: false }]
    },
    { webhookUrl: url, webhookOnFail: true, notifyEmail: 'a@b.com' }
  );

  server.close();
  assertEqual(result.skipped, false);
  assertEqual(result.ok, true);
  assert(received);
  assertEqual(received.event, 'stress.threshold.fail');
  assertEqual(received.notifyEmail, 'a@b.com');
  assertEqual(received.channel, 'webhook');
});

test('stressNotify / skips when pass and webhookOnPass false', async () => {
  const result = await stressNotify.notifyThresholdResult(
    { id: 'r3', summary: {} },
    { enabled: true, passed: true, items: [] },
    { webhookUrl: 'http://127.0.0.1:9/x', webhookOnPass: false }
  );
  assertEqual(result.skipped, true);
});

test('stressNotify / feishu webhook uses msg_type text', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"StatusCode":0}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/open-apis/bot/v2/hook/demo';

  const result = await stressNotify.notifyThresholdResult(
    { id: 'r4', status: 'finished', summary: { total: 2, failRate: 20, rps: 1, avgLatencyMs: 5, p90LatencyMs: 8 } },
    {
      enabled: true,
      passed: false,
      failedCount: 1,
      items: [{ key: 'failRate', label: '请求失败率', actual: 20, threshold: 5, op: 'lte', unit: '%', passed: false }]
    },
    { webhookUrl: url, webhookFormat: 'feishu', webhookOnFail: true }
  );

  server.close();
  assertEqual(result.skipped, false);
  assertEqual(result.ok, true);
  assertEqual(received.msg_type, 'text');
  assert(received.content && String(received.content.text).indexOf('未通过') >= 0);
  assertEqual(stressNotify.isFeishuWebhook('https://open.feishu.cn/open-apis/bot/v2/hook/x'), true);
});

test('stressNotify / probeWebhook posts probe event', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/hook';

  const result = await stressNotify.probeWebhook({ webhookUrl: url, webhookFormat: 'json' });
  server.close();
  assertEqual(result.ok, true);
  assert(received);
  assertEqual(received.event, 'stress.webhook.probe');
  assert(String(received.text).indexOf('探测') >= 0);
});

test('stressNotify / probeWebhook feishu lark format', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"StatusCode":0}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/hook';

  const result = await stressNotify.probeWebhook({ webhookUrl: url, webhookFormat: 'lark' });
  server.close();
  assertEqual(result.ok, true);
  assertEqual(received.msg_type, 'text');
  assert(String(received.content.text).indexOf('探测') >= 0);
});
