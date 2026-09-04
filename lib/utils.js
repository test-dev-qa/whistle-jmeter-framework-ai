const zlib = require('zlib');

const MAX_BODY_BYTES = 1024 * 1024;
const STATIC_EXT_RE = /\.(?:css|less|scss|js|mjs|cjs|map|png|jpe?g|gif|ico|svg|webp|avif|woff2?|ttf|otf|eot|mp[34]|webm|wasm)$/i;
const WHISTLE_HOSTS = new Set([
  'local.whistlejs.com',
  'local.wproxy.org',
  'rootca.pro'
]);
const WHISTLE_LOCAL_PORTS = new Set(['8899', '8900']);

function isStaticAsset(url) {
  try {
    return STATIC_EXT_RE.test(new URL(url).pathname);
  } catch (e) {
    return STATIC_EXT_RE.test(String(url).split('?')[0]);
  }
}

function isWhistleSelfTraffic(url, originalReq) {
  if (originalReq && (originalReq.isInternal || originalReq.isInternalUrl)) return true;
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (WHISTLE_HOSTS.has(host)) return true;
    if (parsed.pathname.includes('whistle.jmeter-exporter')) return true;
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
      const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
      if (WHISTLE_LOCAL_PORTS.has(port)) return true;
    }
  } catch (e) {
    return String(url).includes('whistle.jmeter-exporter');
  }
  return false;
}

function headerValueToString(key, value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    const sep = String(key).toLowerCase() === 'cookie' ? '; ' : ', ';
    return value.map((item) => (item == null ? '' : String(item))).join(sep);
  }
  return String(value);
}

function normalizeHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  for (const [key, value] of Object.entries(headers)) {
    if (!key) continue;
    out[key] = headerValueToString(key, value);
  }
  return out;
}

function sanitizeXmlText(value) {
  if (value == null) return '';
  return String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function looksBinary(body) {
  if (body == null || body === '') return false;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  if (!buf.length) return false;
  const n = Math.min(buf.length, 1024);
  let weird = 0;
  for (let i = 0; i < n; i += 1) {
    const c = buf[i];
    if (c === 0) return true;
    if (c < 8 || (c > 13 && c < 32)) weird += 1;
  }
  return weird / n > 0.3;
}

function truncateUtf8(text, maxBytes) {
  if (text == null || text === '') return '';
  const str = String(text);
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  const buf = Buffer.from(str, 'utf8');
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString('utf8');
}

function limitUtf8Body(body) {
  if (body == null || body === '') return '';
  if (Buffer.isBuffer(body)) {
    if (body.length <= MAX_BODY_BYTES) return body.toString('utf8');
    let end = MAX_BODY_BYTES;
    while (end > 0 && (body[end] & 0xc0) === 0x80) end -= 1;
    return body.subarray(0, end).toString('utf8');
  }
  return truncateUtf8(body, MAX_BODY_BYTES);
}

function decodeCapturedBody(body) {
  if (body == null || body === '') {
    return { text: '', binary: false };
  }
  if (looksBinary(body)) {
    return { text: '', binary: true };
  }
  return { text: limitUtf8Body(body), binary: false };
}

function bodyToBuffer(body) {
  if (body == null || body === '') return null;
  if (Buffer.isBuffer(body)) return body.length ? body : null;
  if (typeof body === 'string') return Buffer.from(body, 'latin1');
  return Buffer.from(String(body), 'latin1');
}

function inflateBody(body, headers) {
  const buf = bodyToBuffer(body);
  if (!buf) return body;
  const enc = getHeader(headers, 'content-encoding').toLowerCase();
  const gzipMagic = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
    if (enc.includes('gzip') || gzipMagic) return zlib.gunzipSync(buf);
    if (enc.includes('deflate')) {
      try {
        return zlib.inflateSync(buf);
      } catch (e) {
        return zlib.inflateRawSync(buf);
      }
    }
  } catch (e) {
    return body;
  }
  return body;
}

function safeRecordId(id) {
  const cleaned = String(id == null ? '' : id)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 80);
  return cleaned || createRecordId();
}

function getHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const target = String(name).toLowerCase();
  for (const key in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === target) {
      return String(headers[key] == null ? '' : headers[key]);
    }
  }
  return '';
}

function getContentType(headers) {
  return getHeader(headers, 'content-type').toLowerCase();
}

function isMultipart(headers) {
  return getContentType(headers).includes('multipart/form-data');
}

function createRecordId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resourceName(url) {
  const raw = String(url || '').trim();
  if (!raw) return '-';
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').filter(Boolean);
    let name = parts.length ? parts[parts.length - 1] : parsed.hostname;
    try {
      name = decodeURIComponent(name);
    } catch (e) {
      // keep encoded
    }
    return name || parsed.hostname || '-';
  } catch (e) {
    const path = raw.split('?')[0];
    const parts = path.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : path || '-';
  }
}

function initiatorFromHeaders(headers) {
  const referer = getHeader(headers, 'referer');
  const origin = getHeader(headers, 'origin');
  const source = referer || origin;
  if (!source) return { name: 'Other', url: '' };
  return { name: resourceName(source), url: source };
}

function responseTransferSize(record) {
  const raw = getHeader(record && record.responseHeaders, 'content-length').trim();
  if (raw !== '') {
    const len = Number(raw);
    if (Number.isFinite(len) && len >= 0) return Math.trunc(len);
  }
  return Buffer.byteLength(String((record && record.responseBody) || ''), 'utf8');
}

function resourceType(headers) {
  const ct = getContentType(headers);
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'document';
  if (ct.includes('javascript')) return 'script';
  return 'xhr';
}

function mimeType(headers) {
  const ct = getContentType(headers);
  if (!ct) return '';
  return ct.split(';')[0].trim();
}

function durationMs(startTime, endTime) {
  const start = Number(startTime);
  if (!Number.isFinite(start) || start <= 0) return 0;
  if (endTime == null || endTime === '') {
    const ms = Math.trunc(Date.now() - start);
    return ms >= 0 ? ms : 0;
  }
  const end = Number(endTime);
  if (!Number.isFinite(end) || end < start) return 0;
  return Math.trunc(end - start);
}

function requestDurationMs(session, fallbackStart, fallbackEnd) {
  const start = Number(session && session.startTime) || Number(fallbackStart) || 0;
  const end = Number(session && session.endTime) || Number(fallbackEnd) || 0;
  return durationMs(start, end);
}

function formatDuration(ms) {
  if (ms == null || ms === '') return '-';
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1000) return `${Math.round(n)} ms`;
  const sec = n / 1000;
  let text;
  if (sec < 10) text = sec.toFixed(2);
  else if (sec < 100) text = sec.toFixed(1);
  else text = String(Math.round(sec));
  text = text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${text} s`;
}

module.exports = {
  MAX_BODY_BYTES,
  isStaticAsset,
  isWhistleSelfTraffic,
  normalizeHeaders,
  sanitizeXmlText,
  looksBinary,
  limitUtf8Body,
  truncateUtf8,
  decodeCapturedBody,
  inflateBody,
  getHeader,
  getContentType,
  isMultipart,
  createRecordId,
  safeRecordId,
  resourceName,
  initiatorFromHeaders,
  responseTransferSize,
  resourceType,
  mimeType,
  durationMs,
  requestDurationMs,
  formatDuration
};
