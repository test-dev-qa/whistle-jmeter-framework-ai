'use strict';

const { getHeader } = require('./utils');

function parseUrlScheme(url) {
  const text = String(url || '').trim();
  if (!text) return 'http';
  try {
    return String(new URL(text).protocol || 'http:').replace(':', '').toLowerCase();
  } catch (e) {
    const m = text.match(/^(https?):\/\//i);
    return m ? m[1].toLowerCase() : 'http';
  }
}

function resolveProtocolLabel(meta, url) {
  const body = meta && typeof meta === 'object' ? meta : {};
  const hint = body.protocolHint || 'http';
  const scheme = parseUrlScheme(url);
  if (hint === 'websocket' || body.wsHandshake) {
    return scheme === 'https' ? 'wss' : 'ws';
  }
  if (hint === 'grpc' || body.grpcHint) {
    return 'grpc';
  }
  return scheme === 'https' ? 'https' : 'http';
}

function detectProtocolMeta(reqHeaders, resHeaders, url) {
  const reqH = reqHeaders || {};
  const resH = resHeaders || {};
  const upgradeReq = String(getHeader(reqH, 'upgrade') || '').toLowerCase();
  const upgradeRes = String(getHeader(resH, 'upgrade') || '').toLowerCase();
  const connReq = String(getHeader(reqH, 'connection') || '').toLowerCase();
  const wsKey = getHeader(reqH, 'sec-websocket-key');
  const wsAccept = getHeader(resH, 'sec-websocket-accept');
  const ctReq = String(getHeader(reqH, 'content-type') || '').toLowerCase();
  const ctRes = String(getHeader(resH, 'content-type') || '').toLowerCase();
  const urlText = String(url || '').toLowerCase();

  const wsHandshake = upgradeReq.includes('websocket')
    || upgradeRes.includes('websocket')
    || Boolean(wsKey && wsAccept)
    || (connReq.includes('upgrade') && wsAccept);

  if (wsHandshake) {
    return {
      protocolHint: 'websocket',
      wsHandshake: true,
      grpcHint: false,
      note: 'WebSocket 握手已捕获；帧级流量需 Whistle 规则配合，后续版本扩展'
    };
  }

  const grpcHint = ctReq.includes('application/grpc')
    || ctRes.includes('application/grpc')
    || ctReq.includes('grpc+proto')
    || urlText.includes('/grpc.');

  if (grpcHint) {
    return {
      protocolHint: 'grpc',
      wsHandshake: false,
      grpcHint: true,
      note: 'gRPC over HTTP/2 请求标记；完整帧解析后续扩展'
    };
  }

  return {
    protocolHint: 'http',
    wsHandshake: false,
    grpcHint: false,
    note: ''
  };
}

module.exports = {
  detectProtocolMeta
};
