'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');
const { createWebSocketFrameAdapter } = require('./websocketFrameAdapter');

const MAX_FRAMES = 10000;
const MAX_FRAME_PAYLOAD_BYTES = 1024 * 1024;
const FRAME_FILE = path.join(DATA_DIR, 'websocket-frames.json');
const frames = [];
let loaded = false;
let persistTimer = null;

function loadFrames() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse(fs.readFileSync(FRAME_FILE, 'utf8'));
    if (Array.isArray(saved)) frames.push(...saved.slice(-MAX_FRAMES));
  } catch (error) {
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      atomicWriteFile(FRAME_FILE, JSON.stringify(frames));
    } catch (error) {
    }
  }, 100);
}

function connectionId(req) {
  const original = req && req.originalReq;
  const headers = (req && req.headers) || {};
  return String(
    headers['x-whistle-request-id']
      || (original && (original.id || original.fullUrl))
      || `${headers.host || 'websocket'}:${headers['x-whistle-client-port'] || ''}`
  );
}

function captureFrame(req, direction, payload, options) {
  loadFrames();
  const binary = Boolean(options && options.opcode === 2);
  const rawPayload = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''), 'utf8');
  const truncated = rawPayload.length > MAX_FRAME_PAYLOAD_BYTES;
  const storedPayload = truncated ? rawPayload.subarray(0, MAX_FRAME_PAYLOAD_BYTES) : rawPayload;
  const item = {
    connectionId: connectionId(req),
    direction,
    opcode: options && options.opcode ? options.opcode : Buffer.isBuffer(payload) ? 2 : 1,
    fin: !(options && options.fin === false),
    timestamp: Date.now(),
    payload: binary ? storedPayload.toString('base64') : storedPayload.toString('utf8'),
    binary,
    truncated,
    payloadBytes: rawPayload.length,
    decoded: options && options.decoded ? options.decoded : null
  };
  frames.push(item);
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
  schedulePersist();
  return item;
}

function captureClose(req, info) {
  loadFrames();
  const item = {
    type: 'close',
    connectionId: connectionId(req),
    code: info && info.code != null ? info.code : 1000,
    reason: String((info && info.reason) || ''),
    timestamp: Number(info && info.timestamp) || Date.now()
  };
  frames.push(item);
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
  schedulePersist();
  return item;
}

function attachHook(server, direction, onFrame) {
  if (!server || typeof server.on !== 'function') return;
  server.on('connect', (req, socket) => {
    const adapter = createWebSocketFrameAdapter({
      connectionId: connectionId(req),
      decoderContext: { contentType: 'application/json' },
      onFrame: frame => {
        const item = captureFrame(req, direction, frame.payload, frame);
        if (typeof onFrame === 'function') onFrame(item);
      },
      onClose: info => {
        const item = captureClose(req, info);
        if (typeof onFrame === 'function') onFrame(item);
      }
    });
    socket.on('data', (payload, options) => {
      adapter.handleFrame({
        data: payload,
        opcode: options && options.opcode,
        fin: options && options.fin,
        direction
      });
      if (typeof socket.write === 'function') socket.write(payload, options);
    });
    socket.on('close', adapter.handleClose);
  });
}

function startWebSocketCapture(options) {
  const config = options || {};
  return {
    wsReqRead: server => attachHook(server, 'outgoing', config.onFrame),
    wsResRead: server => attachHook(server, 'incoming', config.onFrame)
  };
}

function listFrames(connection) {
  loadFrames();
  return connection ? frames.filter(item => item.connectionId === String(connection)) : frames.slice();
}

function queryFrames(options) {
  const config = options && typeof options === 'object' ? options : {};
  const connection = config.connectionId ? String(config.connectionId) : '';
  const direction = config.direction ? String(config.direction) : '';
  const offset = Math.max(0, Number.parseInt(config.offset, 10) || 0);
  const limit = Math.min(1000, Math.max(1, Number.parseInt(config.limit, 10) || 500));
  const matched = listFrames().filter(item => {
    if (connection && item.connectionId !== connection) return false;
    if (direction && item.direction !== direction) return false;
    return true;
  });
  return { total: matched.length, data: matched.slice(offset, offset + limit), offset, limit };
}

function clearFrames() {
  loadFrames();
  frames.length = 0;
  schedulePersist();
}

module.exports = {
  FRAME_FILE,
  MAX_FRAMES,
  MAX_FRAME_PAYLOAD_BYTES,
  startWebSocketCapture,
  listFrames,
  queryFrames,
  clearFrames
};