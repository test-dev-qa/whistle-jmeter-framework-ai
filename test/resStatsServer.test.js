'use strict';

const { EventEmitter } = require('events');
const { test, assert, assertEqual } = require('./harness');
const { getRecords, clearRecords, getRecordById, getRecordSummaries } = require('../lib/dataStore');
const { setCaptureConfig } = require('../lib/captureConfig');
const attach = require('../resStatsServer');

function reset() {
  setCaptureConfig({ paused: false, includeHost: '', includePath: '', skipDuplicates: true });
  clearRecords();
}

function makeReq({ url, method, body, status, headers, sessionId, noSession, passThrough }) {
  const originalReq = {
    fullUrl: url,
    url,
    method: method || 'GET',
    headers: headers || {}
  };
  const req = {
    originalReq,
    _passed: false,
    passThrough() {
      this._passed = true;
      if (typeof passThrough === 'function') passThrough();
    }
  };
  if (!noSession) {
    req.getSession = (cb) => {
      cb({
        id: sessionId || 'sid-1',
        url,
        startTime: Date.now(),
        req: { method: method || 'GET', headers: headers || {}, body: body || '' },
        res: { statusCode: status == null ? 200 : status, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }
      });
    };
  }
  return req;
}

test('resStatsServer / captures json api and passThrough', () => {
  reset();
  const server = new EventEmitter();
  attach(server);
  const req = makeReq({ url: 'https://api.example.com/v1/list', sessionId: 'cap-1' });
  server.emit('request', req);
  assert(req._passed);
  const saved = getRecordById('cap-1');
  assert(saved);
  assertEqual(saved.method, 'GET');
  assert(typeof saved.duration === 'number');
  const summary = getRecordSummaries().find((item) => item.id === 'cap-1');
  assertEqual(summary.name, 'list');
  assertEqual(summary.initiator, 'Other');
  reset();
});

test('resStatsServer / skips static assets', () => {
  reset();
  const server = new EventEmitter();
  attach(server);
  const req = makeReq({ url: 'https://cdn.example.com/app.js', sessionId: 'static-1' });
  server.emit('request', req);
  assert(req._passed);
  assertEqual(getRecordById('static-1'), null);
  reset();
});

test('resStatsServer / skips whistle self traffic', () => {
  reset();
  const server = new EventEmitter();
  attach(server);
  const req = makeReq({ url: 'http://127.0.0.1:8899/api/records', sessionId: 'self-1' });
  server.emit('request', req);
  assertEqual(getRecordById('self-1'), null);
  reset();
});

test('resStatsServer / skipDuplicates drops consecutive same method+url', () => {
  reset();
  const server = new EventEmitter();
  attach(server);
  server.emit('request', makeReq({ url: 'https://api.example.com/poll', sessionId: 'p1' }));
  server.emit('request', makeReq({ url: 'https://api.example.com/poll', sessionId: 'p2' }));
  assertEqual(getRecords().length, 1);
  reset();
});

test('resStatsServer / marks websocket upgrade handshake', () => {
  reset();
  const server = new EventEmitter();
  attach(server);
  const req = makeReq({
    url: 'https://api.example.com/ws',
    method: 'GET',
    sessionId: 'ws-1',
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ=='
    }
  });
  req.getSession = (cb) => {
    cb({
      id: 'ws-1',
      url: 'https://api.example.com/ws',
      startTime: Date.now(),
      req: {
        method: 'GET',
        headers: req.originalReq.headers,
        body: ''
      },
      res: {
        statusCode: 101,
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Accept': 's3pPLMBiTxaQ9kYGzzhZRbK+xOo='
        },
        body: ''
      }
    });
  };
  server.emit('request', req);
  const saved = getRecordById('ws-1');
  assert(saved);
  assertEqual(saved.protocolHint, 'websocket');
  assertEqual(saved.wsHandshake, true);
  reset();
});

test('resStatsServer / initiator from referer and duration from session times', () => {
  reset();
  const server = new EventEmitter();
  attach(server);
  const originalReq = {
    fullUrl: 'https://api.example.com/v1/getInfo',
    url: 'https://api.example.com/v1/getInfo',
    method: 'GET',
    headers: { referer: 'https://app.example.com/home.html' }
  };
  const req = {
    originalReq,
    _passed: false,
    passThrough() { this._passed = true; },
    getSession(cb) {
      cb({
        id: 'init-1',
        url: originalReq.url,
        startTime: 1000,
        endTime: 1088,
        req: { method: 'GET', headers: originalReq.headers, body: '' },
        res: { statusCode: 200, headers: { 'content-type': 'application/json', 'content-length': '64' }, body: '{"ok":true}' }
      });
    }
  };
  server.emit('request', req);
  const saved = getRecordById('init-1');
  assertEqual(saved.duration, 88);
  assertEqual(saved.reqStartTime, 1000);
  assertEqual(saved.reqEndTime, 1088);
  const summary = getRecordSummaries().find((item) => item.id === 'init-1');
  assertEqual(summary.name, 'getInfo');
  assertEqual(summary.initiator, 'home.html');
  assertEqual(summary.initiatorUrl, 'https://app.example.com/home.html');
  assertEqual(summary.size, 64);
  assertEqual(summary.resourceType, 'json');
  assertEqual(summary.mimeType, 'application/json');
  reset();
});

test('resStatsServer / paused capture writes nothing', () => {
  reset();
  setCaptureConfig({ paused: true });
  const server = new EventEmitter();
  attach(server);
  const req = makeReq({ url: 'https://api.example.com/v1', sessionId: 'paused-1' });
  server.emit('request', req);
  assert(req._passed);
  assertEqual(getRecordById('paused-1'), null);
  reset();
});
