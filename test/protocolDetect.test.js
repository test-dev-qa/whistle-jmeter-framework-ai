'use strict';

const { test, assertEqual } = require('./harness');
const { detectProtocolMeta } = require('../lib/protocolDetect');

test('protocolDetect / websocket upgrade handshake', () => {
  const meta = detectProtocolMeta(
    { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'abc' },
    { 'Sec-WebSocket-Accept': 'xyz', Upgrade: 'websocket' },
    'https://example.com/ws'
  );
  assertEqual(meta.protocolHint, 'websocket');
  assertEqual(meta.wsHandshake, true);
});

test('protocolDetect / grpc content-type', () => {
  const meta = detectProtocolMeta(
    { 'Content-Type': 'application/grpc' },
    { 'Content-Type': 'application/grpc+proto' },
    'https://api.example.com/foo.Service/Method'
  );
  assertEqual(meta.protocolHint, 'grpc');
  assertEqual(meta.grpcHint, true);
});

test('protocolDetect / plain http', () => {
  const meta = detectProtocolMeta(
    { Accept: 'application/json' },
    { 'Content-Type': 'application/json' },
    'https://example.com/api'
  );
  assertEqual(meta.protocolHint, 'http');
});
