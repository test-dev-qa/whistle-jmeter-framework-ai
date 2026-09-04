'use strict';

const { normalizeHeaders, getContentType } = require('./utils');
const { correlateTokens } = require('./tokenCorrelate');
const { getExtractorsForRecords } = require('./extractVars');
const { collectValidRecords } = require('./k6Generator');

const SKIP_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'accept-encoding',
  'transfer-encoding',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
  'expect',
  'cookie'
]);

function filterHeaders(headers) {
  const out = [];
  Object.keys(headers || {}).forEach((key) => {
    if (SKIP_HEADERS.has(String(key).toLowerCase())) return;
    out.push({ key, value: String(headers[key]), type: 'text' });
  });
  return out;
}

function buildPlans(valid, options) {
  const manuals = getExtractorsForRecords(valid.map((item) => item.record && item.record.id));
  return correlateTokens(valid.map((item) => item.record), {
    edits: options && options.correlateEdits,
    manualExtractors: manuals,
    autoCorrelate: !options || options.correlateToken !== false
  });
}

function postmanUrl(parsedOrigin, pathPart) {
  const full = new URL(String(pathPart || '/'), parsedOrigin);
  const host = full.hostname.split('.');
  const pathSegments = (full.pathname || '/').split('/').filter(Boolean);
  const query = [];
  full.searchParams.forEach((value, key) => {
    query.push({ key, value });
  });
  return {
    raw: full.toString(),
    protocol: full.protocol.replace(':', ''),
    host,
    path: pathSegments.length ? pathSegments : [''],
    query: query.length ? query : undefined
  };
}

function requestBody(record, plan) {
  if (record.requestBodyBinary) return undefined;
  const multipart = plan.multipart || record.multipart;
  if (multipart && ((multipart.files && multipart.files.length) || (multipart.fields && multipart.fields.length))) {
    return undefined;
  }
  const headers = plan.headers || normalizeHeaders(record.requestHeaders || record.headers || {});
  const body = plan.body != null ? plan.body : (record.requestBody != null && record.requestBody !== ''
    ? String(record.requestBody)
    : String(record.body || ''));
  if (!body) return undefined;
  const ct = getContentType(headers);
  if (ct.includes('application/x-www-form-urlencoded')) {
    const urlencoded = body.split('&').map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return { key: pair, value: '' };
      return { key: pair.slice(0, eq), value: pair.slice(eq + 1) };
    }).filter((row) => row.key);
    return { mode: 'urlencoded', urlencoded };
  }
  const language = ct.includes('json') ? 'json' : (ct.includes('xml') ? 'xml' : 'text');
  return {
    mode: 'raw',
    raw: body,
    options: { raw: { language } }
  };
}

function itemName(method, path) {
  const p = String(path || '/').split('?')[0] || '/';
  const seg = p.split('/').filter(Boolean).pop() || p;
  return `${method} ${seg}`.slice(0, 120);
}

function generatePostmanCollection(records, options) {
  if (!records || records.length === 0) {
    throw new Error('No records provided to export Postman collection');
  }
  const { valid, skipped } = collectValidRecords(records);
  if (!valid.length) throw new Error('No valid HTTP records to export');
  const plans = buildPlans(valid, options);
  const items = valid.map((item, index) => {
    const plan = plans[index] || {};
    const record = item.record;
    const method = item.method;
    const headers = filterHeaders(plan.headers || normalizeHeaders(record.requestHeaders || record.headers || {}));
    const path = plan.path || ((item.parsedUrl.pathname || '/') + item.parsedUrl.search);
    const url = postmanUrl(item.parsedUrl.origin, path);
    const body = requestBody(record, plan);
    const req = {
      method,
      header: headers,
      url,
      description: record.url || ''
    };
    if (body) req.body = body;
    return { name: itemName(method, path), request: req };
  });
  return {
    info: {
      name: `Whistle Export ${new Date().toISOString().slice(0, 10)}`,
      description: skipped.length
        ? `Exported from whistle.jmeter-exporter; skipped ${skipped.length} invalid record(s).`
        : 'Exported from whistle.jmeter-exporter',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: items
  };
}

module.exports = {
  generatePostmanCollection
};
