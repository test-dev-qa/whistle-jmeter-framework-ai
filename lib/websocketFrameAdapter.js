'use strict';

const { decodeProtocolPayload } = require('./protocolDecoders');

function normalizeFrame(frame, fallback) {
  const source = frame && typeof frame === 'object' ? frame : {};
  const payload = source.payload != null ? source.payload : source.data;
  return {
    connectionId: String(source.connectionId || fallback.connectionId || ''),
    direction: source.direction === 'outgoing' || source.direction === 'send' ? 'outgoing' : 'incoming',
    opcode: source.opcode || (Buffer.isBuffer(payload) ? 2 : 1),
    payload: payload == null ? '' : payload,
    timestamp: Number(source.timestamp) || Date.now(),
    fin: source.fin !== false
  };
}

function createWebSocketFrameAdapter(options) {
  const config = options && typeof options === 'object' ? options : {};
  const onFrame = typeof config.onFrame === 'function' ? config.onFrame : () => {};
  const onClose = typeof config.onClose === 'function' ? config.onClose : () => {};
  const decoderContext = config.decoderContext && typeof config.decoderContext === 'object'
    ? config.decoderContext
    : {};

  function handleFrame(frame) {
    const normalized = normalizeFrame(frame, config);
    const decoded = normalized.opcode === 1 || normalized.opcode === 2
      ? decodeProtocolPayload(normalized.payload, decoderContext)
      : null;
    const message = Object.assign({}, normalized, {
      decoded
    });
    onFrame(message);
    return message;
  }

  function handleClose(info) {
    const close = info && typeof info === 'object' ? info : {};
    onClose({
      connectionId: String(close.connectionId || config.connectionId || ''),
      code: close.code == null ? 1000 : close.code,
      reason: String(close.reason || ''),
      timestamp: Number(close.timestamp) || Date.now()
    });
  }

  function attach(source) {
    if (!source || typeof source.on !== 'function') {
      throw new TypeError('WebSocket frame source must provide on(event, handler)');
    }
    source.on('frame', handleFrame);
    source.on('message', handleFrame);
    source.on('close', handleClose);
    return () => {
      if (typeof source.off !== 'function') return;
      source.off('frame', handleFrame);
      source.off('message', handleFrame);
      source.off('close', handleClose);
    };
  }

  return { attach, handleFrame, handleClose };
}

module.exports = {
  createWebSocketFrameAdapter,
  normalizeFrame
};