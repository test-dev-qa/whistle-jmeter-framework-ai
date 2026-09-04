const { addRecord, getLastRecord } = require('./lib/dataStore');
const { allowsUrl, getCaptureConfig } = require('./lib/captureConfig');
const { captureRequestPayload, MAX_MULTIPART_BYTES } = require('./lib/multipart');
const { detectProtocolMeta } = require('./lib/protocolDetect');
const { setLastError } = require('./lib/pluginStatus');
const {
  MAX_BODY_BYTES,
  isStaticAsset,
  isWhistleSelfTraffic,
  normalizeHeaders,
  decodeCapturedBody,
  inflateBody,
  isMultipart,
  createRecordId,
  safeRecordId,
  durationMs,
  requestDurationMs
} = require('./lib/utils');

const STREAM_TIMEOUT_MS = 60000;
let lastCaptureErrorAt = 0;

function shouldCapture(url, originalReq) {
  return Boolean(url)
    && /^https?:\/\//i.test(url)
    && !isWhistleSelfTraffic(url, originalReq)
    && !isStaticAsset(url)
    && allowsUrl(url);
}

function isConsecutiveDuplicate(method, url) {
  if (!getCaptureConfig().skipDuplicates) return false;
  const last = getLastRecord();
  return Boolean(last && last.method === method && last.url === url);
}

function appendLimited(chunk, chunks, size, maxBytes) {
  const limit = maxBytes || MAX_BODY_BYTES;
  if (size >= limit) return size;
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remain = limit - size;
  chunks.push(buf.length > remain ? buf.subarray(0, remain) : buf);
  return size + Math.min(buf.length, remain);
}

function concatChunks(chunks) {
  if (!chunks || !chunks.length) return Buffer.alloc(0);
  if (chunks.length === 1) return chunks[0];
  return Buffer.concat(chunks);
}

function logCaptureError(err) {
  const now = Date.now();
  setLastError('capture', err);
  if (now - lastCaptureErrorAt < 5000) return;
  lastCaptureErrorAt = now;
  console.error('[jmeter-exporter] capture error:', err && err.message ? err.message : err);
}

function saveFromSession(session, originalReq) {
  if (!session) return;
  const url = session.url || originalReq.fullUrl || originalReq.url || '';
  if (!shouldCapture(url, originalReq)) return;

  const reqInfo = session.req || {};
  const resInfo = session.res || {};
  const method = String(reqInfo.method || originalReq.method || 'GET').toUpperCase();
  if (isConsecutiveDuplicate(method, url)) return;

  const reqHeaders = normalizeHeaders(reqInfo.headers || originalReq.headers);
  const resHeaders = normalizeHeaders(resInfo.headers);
  const id = safeRecordId(session.id || createRecordId());
  const reqBody = captureRequestPayload(id, reqHeaders, inflateBody(reqInfo.body, reqHeaders));
  const resBody = decodeCapturedBody(inflateBody(resInfo.body, resHeaders));
  const reqStartTime = Number(session.startTime) || Date.now();
  const reqEndTime = Number(session.endTime) || Date.now();
  const protocol = detectProtocolMeta(reqHeaders, resHeaders, url);
  addRecord({
    id,
    url,
    method,
    protocolHint: protocol.protocolHint,
    wsHandshake: protocol.wsHandshake,
    grpcHint: protocol.grpcHint,
    protocolNote: protocol.note || '',
    requestHeaders: reqHeaders,
    requestBody: reqBody.text,
    requestBodyBinary: reqBody.binary,
    multipart: reqBody.multipart || undefined,
    responseStatus: resInfo.statusCode != null ? Number(resInfo.statusCode) || resInfo.statusCode : '',
    responseHeaders: resHeaders,
    responseBody: resBody.text,
    responseBodyBinary: resBody.binary,
    timestamp: reqStartTime,
    reqStartTime,
    reqEndTime,
    duration: requestDurationMs(session, reqStartTime, reqEndTime)
  });
}

function captureViaStream(req, originalReq, url) {
  const reqData = req.req || req;
  const reqChunks = [];
  const resChunks = [];
  let reqSize = 0;
  let resSize = 0;
  let statusCode = '';
  let responseHeaders = {};
  let reqFinished = false;
  let resFinished = false;
  let saved = false;
  let timer = null;
  const startedAt = Date.now();

  const trySave = () => {
    if (saved || !reqFinished || !resFinished) return;
    saved = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      const method = String(reqData.method || originalReq.method || 'GET').toUpperCase();
      if (isConsecutiveDuplicate(method, url)) return;
      const reqHeaders = normalizeHeaders(reqData.headers || originalReq.headers);
      const id = safeRecordId(createRecordId());
      const reqBody = captureRequestPayload(id, reqHeaders, inflateBody(concatChunks(reqChunks), reqHeaders));
      const resBody = decodeCapturedBody(inflateBody(concatChunks(resChunks), responseHeaders));
      const resHeaders = normalizeHeaders(responseHeaders);
      const protocol = detectProtocolMeta(reqHeaders, resHeaders, url);
      const endedAt = Date.now();
      addRecord({
        id,
        url,
        method,
        protocolHint: protocol.protocolHint,
        wsHandshake: protocol.wsHandshake,
        grpcHint: protocol.grpcHint,
        protocolNote: protocol.note || '',
        requestHeaders: reqHeaders,
        requestBody: reqBody.text,
        requestBodyBinary: reqBody.binary,
        multipart: reqBody.multipart || undefined,
        responseStatus: statusCode !== '' && statusCode != null ? Number(statusCode) || statusCode : '',
        responseHeaders: resHeaders,
        responseBody: resBody.text,
        responseBodyBinary: resBody.binary,
        timestamp: startedAt,
        reqStartTime: startedAt,
        reqEndTime: endedAt,
        duration: durationMs(startedAt, endedAt)
      });
    } catch (err) {
      logCaptureError(err);
    }
  };

  const finishReq = () => {
    reqFinished = true;
    trySave();
  };
  const finishRes = () => {
    resFinished = true;
    trySave();
  };

  const reqLimit = isMultipart(originalReq.headers || reqData.headers || {})
    ? MAX_MULTIPART_BYTES
    : MAX_BODY_BYTES;

  req.on('data', (chunk) => {
    reqSize = appendLimited(chunk, reqChunks, reqSize, reqLimit);
  });
  req.on('end', finishReq);
  req.on('error', () => {
    reqFinished = true;
    resFinished = true;
    trySave();
  });

  req.on('response', (response) => {
    statusCode = response.statusCode;
    responseHeaders = response.headers || {};
    response.on('data', (chunk) => {
      resSize = appendLimited(chunk, resChunks, resSize);
    });
    response.on('end', finishRes);
    response.on('error', finishRes);
  });

  timer = setTimeout(() => {
    timer = null;
    if (saved) return;
    reqFinished = true;
    resFinished = true;
    trySave();
  }, STREAM_TIMEOUT_MS);
}

module.exports = (server) => {
  server.on('request', (req) => {
    try {
      const originalReq = req.originalReq || {};
      const url = originalReq.fullUrl || originalReq.url || '';
      if (shouldCapture(url, originalReq)) {
        if (typeof req.getSession === 'function') {
          req.getSession((session) => {
            try {
              saveFromSession(session, originalReq);
            } catch (err) {
              logCaptureError(err);
            }
          });
        } else {
          captureViaStream(req, originalReq, url);
        }
      }
    } catch (err) {
      logCaptureError(err);
    } finally {
      if (typeof req.passThrough === 'function') {
        req.passThrough();
      }
    }
  });
};
