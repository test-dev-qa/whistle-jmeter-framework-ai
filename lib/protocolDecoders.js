'use strict';

const decoders = new Map();

function toJson(value) {
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8'));
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function isJsonRpcMessage(value) {
  return Boolean(value && typeof value === 'object' && value.jsonrpc === '2.0');
}

function classifyJsonRpcMessage(message) {
  if (!isJsonRpcMessage(message)) return null;
  const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
  const hasMethod = typeof message.method === 'string';
  const hasResult = Object.prototype.hasOwnProperty.call(message, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(message, 'error');
  if (hasMethod) {
    return {
      type: hasId ? 'request' : 'notification',
      id: hasId ? message.id : undefined,
      method: message.method,
      params: message.params
    };
  }
  if (hasId && (hasResult || hasError)) {
    return {
      type: hasError ? 'error' : 'response',
      id: message.id,
      result: message.result,
      error: message.error
    };
  }
  return null;
}

function decodeJsonRpc(payload) {
  let parsed;
  try {
    parsed = toJson(payload);
  } catch (error) {
    return [];
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  return messages.map(classifyJsonRpcMessage).filter(Boolean);
}

function registerProtocolDecoder(name, decoder) {
  const key = String(name || '').trim().toLowerCase();
  if (!key || !decoder || typeof decoder.decode !== 'function') {
    throw new TypeError('protocol decoder requires a name and decode function');
  }
  decoders.set(key, {
    detect: typeof decoder.detect === 'function' ? decoder.detect : () => true,
    decode: decoder.decode
  });
}

function decodeProtocolPayload(payload, context) {
  const meta = context && typeof context === 'object' ? context : {};
  for (const [name, decoder] of decoders) {
    let matched = false;
    try {
      matched = decoder.detect(payload, meta) === true;
    } catch (error) {
      matched = false;
    }
    if (!matched) continue;
    const messages = decoder.decode(payload, meta);
    if (Array.isArray(messages) && messages.length) {
      return { protocol: name, messages };
    }
  }
  return null;
}

registerProtocolDecoder('json-rpc', {
  detect(payload, context) {
    const contentType = String(context.contentType || '').toLowerCase();
    if (contentType.includes('json')) return decodeJsonRpc(payload).length > 0;
    return decodeJsonRpc(payload).length > 0;
  },
  decode: decodeJsonRpc
});

module.exports = {
  decodeJsonRpc,
  decodeProtocolPayload,
  registerProtocolDecoder
};