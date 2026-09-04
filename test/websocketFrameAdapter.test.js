'use strict';

const EventEmitter = require('node:events');
const { test, assert, assertEqual } = require('./harness');
const { createWebSocketFrameAdapter, normalizeFrame } = require('../lib/websocketFrameAdapter');

test('websocketFrameAdapter / normalizes incoming JSON-RPC frame', () => {
  const frames = [];
  const adapter = createWebSocketFrameAdapter({ connectionId: 'ws-1', onFrame: frame => frames.push(frame) });
  const frame = adapter.handleFrame({ data: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
  assertEqual(frame.connectionId, 'ws-1');
  assertEqual(frame.direction, 'incoming');
  assertEqual(frame.decoded.protocol, 'json-rpc');
  assertEqual(frame.decoded.messages[0].method, 'ping');
  assertEqual(frames.length, 1);
});

test('websocketFrameAdapter / attaches and detaches frame source', () => {
  const source = new EventEmitter();
  const frames = [];
  const closes = [];
  const adapter = createWebSocketFrameAdapter({
    connectionId: 'ws-2',
    onFrame: frame => frames.push(frame),
    onClose: close => closes.push(close)
  });
  const detach = adapter.attach(source);
  source.emit('message', { direction: 'outgoing', payload: 'hello' });
  source.emit('close', { code: 1001, reason: 'going away' });
  assertEqual(frames[0].direction, 'outgoing');
  assertEqual(closes[0].code, 1001);
  detach();
  source.emit('message', { payload: 'ignored' });
  assertEqual(frames.length, 1);
});

test('websocketFrameAdapter / normalizes binary and fragmented metadata', () => {
  const frame = normalizeFrame({ data: Buffer.from([1, 2]), fin: false }, { connectionId: 'ws-3' });
  assertEqual(frame.opcode, 2);
  assertEqual(frame.fin, false);
  assertEqual(frame.connectionId, 'ws-3');
  assert(frame.timestamp > 0);
});