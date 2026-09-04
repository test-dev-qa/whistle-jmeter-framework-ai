'use strict';

const EventEmitter = require('node:events');
const { test, assertEqual } = require('./harness');
const websocketFrames = require('../lib/websocketFrameCapture');
const plugin = require('../index');

test('websocketFrameCapture / Whistle hooks capture and forward frames', () => {
  websocketFrames.clearFrames();
  const reqServer = new EventEmitter();
  const socket = new EventEmitter();
  const writes = [];
  socket.write = (payload, options) => writes.push({ payload, options });
  plugin.wsReqRead(reqServer);
  reqServer.emit('connect', {
    headers: { host: 'api.example.com', 'x-whistle-client-port': '1234' },
    originalReq: { fullUrl: 'ws://api.example.com/rpc' }
  }, socket);
  const payload = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}');
  socket.emit('data', payload, { opcode: 1, fin: true });
  const captured = websocketFrames.listFrames();
  assertEqual(captured.length, 1);
  assertEqual(captured[0].direction, 'outgoing');
  assertEqual(captured[0].binary, false);
  assertEqual(captured[0].payload, payload.toString('utf8'));
  assertEqual(captured[0].decoded.messages[0].method, 'ping');
  assertEqual(writes.length, 1);
  assertEqual(writes[0].payload, payload);
});

test('websocketFrameCapture / response hook captures text frames', () => {
  websocketFrames.clearFrames();
  const resServer = new EventEmitter();
  const socket = new EventEmitter();
  socket.write = () => {};
  plugin.wsResRead(resServer);
  resServer.emit('connect', { headers: { host: 'api.example.com' }, originalReq: { fullUrl: 'wss://api.example.com/rpc' } }, socket);
  socket.emit('data', '{"jsonrpc":"2.0","id":1,"result":"ok"}', { opcode: 1 });
  const captured = websocketFrames.listFrames();
  assertEqual(captured.length, 1);
  assertEqual(captured[0].direction, 'incoming');
  assertEqual(captured[0].binary, false);
});

test('websocketFrameCapture / truncates oversized payloads', () => {
  websocketFrames.clearFrames();
  const server = new EventEmitter();
  const socket = new EventEmitter();
  socket.write = () => {};
  plugin.wsReqRead(server);
  server.emit('connect', { headers: { host: 'api.example.com' }, originalReq: { fullUrl: 'ws://api.example.com/rpc' } }, socket);
  const payload = Buffer.alloc(websocketFrames.MAX_FRAME_PAYLOAD_BYTES + 10, 65);
  socket.emit('data', payload, { opcode: 2, fin: true });
  const captured = websocketFrames.listFrames();
  assertEqual(captured.length, 1);
  assertEqual(captured[0].truncated, true);
  assertEqual(captured[0].payloadBytes, payload.length);
  assertEqual(Buffer.from(captured[0].payload, 'base64').length, websocketFrames.MAX_FRAME_PAYLOAD_BYTES);
});

test('websocketFrameCapture / persists close events and paginates', () => {
  websocketFrames.clearFrames();
  const server = new EventEmitter();
  const socket = new EventEmitter();
  socket.write = () => {};
  plugin.wsReqRead(server);
  server.emit('connect', { headers: { host: 'api.example.com' }, originalReq: { fullUrl: 'ws://api.example.com/rpc' } }, socket);
  socket.emit('close', { code: 1001, reason: 'done' });
  const result = websocketFrames.queryFrames({ limit: 1 });
  assertEqual(result.total, 1);
  assertEqual(result.data[0].type, 'close');
  assertEqual(result.data[0].code, 1001);
  assertEqual(result.data[0].reason, 'done');
});