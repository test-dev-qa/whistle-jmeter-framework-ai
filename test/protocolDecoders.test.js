'use strict';

const { test, assert, assertEqual } = require('./harness');
const {
  decodeJsonRpc,
  decodeProtocolPayload,
  registerProtocolDecoder
} = require('../lib/protocolDecoders');

test('protocolDecoders / decodes JSON-RPC request and response', () => {
  const request = decodeJsonRpc(Buffer.from('{"jsonrpc":"2.0","id":7,"method":"users.get","params":{"id":1}}'));
  assertEqual(request.length, 1);
  assertEqual(request[0].type, 'request');
  assertEqual(request[0].id, 7);
  assertEqual(request[0].method, 'users.get');

  const response = decodeJsonRpc('{"jsonrpc":"2.0","id":7,"result":{"name":"Ada"}}');
  assertEqual(response[0].type, 'response');
  assertEqual(response[0].result.name, 'Ada');
});

test('protocolDecoders / decodes notification and batch', () => {
  const messages = decodeJsonRpc(JSON.stringify([
    { jsonrpc: '2.0', method: 'health.check', params: {} },
    { jsonrpc: '2.0', id: 'x', error: { code: -1, message: 'failed' } }
  ]));
  assertEqual(messages.length, 2);
  assertEqual(messages[0].type, 'notification');
  assertEqual(messages[1].type, 'error');
  assertEqual(messages[1].error.code, -1);
});

test('protocolDecoders / ignores invalid JSON-RPC payload', () => {
  assertEqual(decodeJsonRpc('{"ok":true}').length, 0);
  assertEqual(decodeJsonRpc('not json').length, 0);
  assertEqual(decodeProtocolPayload('{"ok":true}', { contentType: 'application/json' }), null);
});

test('protocolDecoders / supports registered decoders', () => {
  registerProtocolDecoder('test-rpc', {
    detect: (payload, context) => context.protocol === 'test-rpc' && payload === 'ping',
    decode: () => [{ type: 'request', method: 'ping' }]
  });
  const result = decodeProtocolPayload('ping', { protocol: 'test-rpc' });
  assert(result);
  assertEqual(result.protocol, 'test-rpc');
  assertEqual(result.messages[0].method, 'ping');
});