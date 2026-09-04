'use strict';

const zlib = require('zlib');
const { test, assert, assertEqual, assertMatch } = require('./harness');
const {
  isStaticAsset,
  isWhistleSelfTraffic,
  looksBinary,
  decodeCapturedBody,
  inflateBody,
  createRecordId,
  safeRecordId,
  getContentType,
  getHeader,
  isMultipart,
  normalizeHeaders,
  sanitizeXmlText,
  limitUtf8Body,
  truncateUtf8,
  MAX_BODY_BYTES,
  resourceName,
  initiatorFromHeaders,
  responseTransferSize,
  resourceType,
  mimeType,
  durationMs,
  formatDuration
} = require('../lib/utils');

test('utils / isStaticAsset css js image font', () => {
  assert(isStaticAsset('https://x.com/a.css'));
  assert(isStaticAsset('https://x.com/a.js?v=1'));
  assert(isStaticAsset('https://x.com/img/a.png'));
  assert(isStaticAsset('https://x.com/f.woff2'));
  assert(isStaticAsset('https://x.com/a.less'));
  assert(!isStaticAsset('https://x.com/api/list'));
  assert(!isStaticAsset('https://x.com/index.html'));
});

test('utils / isStaticAsset invalid url falls back to path', () => {
  assert(isStaticAsset('/static/app.js'));
  assert(!isStaticAsset('not a url'));
});

test('utils / isWhistleSelfTraffic known hosts and ports', () => {
  assert(isWhistleSelfTraffic('http://local.whistlejs.com/whistle.jmeter-exporter/'));
  assert(isWhistleSelfTraffic('http://local.wproxy.org/'));
  assert(isWhistleSelfTraffic('http://127.0.0.1:8899/api/records'));
  assert(isWhistleSelfTraffic('http://localhost:8900/'));
  assert(isWhistleSelfTraffic('http://[::1]:8899/'));
  assert(isWhistleSelfTraffic('https://api.example.com/whistle.jmeter-exporter/ui'));
  assert(isWhistleSelfTraffic('https://x.com/a', { isInternal: true }));
  assert(!isWhistleSelfTraffic('https://api.example.com/v1'));
  assert(!isWhistleSelfTraffic(''));
});

test('utils / isWhistleSelfTraffic malformed url with plugin name', () => {
  assert(isWhistleSelfTraffic('not-a-url-whistle.jmeter-exporter'));
});

test('utils / looksBinary and decodeCapturedBody', () => {
  assert(looksBinary(Buffer.from([0, 1, 2, 3])));
  assert(!looksBinary('{"ok":true}'));
  assert(!looksBinary(''));
  assertEqual(decodeCapturedBody('hello').text, 'hello');
  assertEqual(decodeCapturedBody('hello').binary, false);
  assertEqual(decodeCapturedBody(Buffer.from([0, 1, 2])).binary, true);
  assertEqual(decodeCapturedBody(Buffer.from([0, 1, 2])).text, '');
  assertEqual(decodeCapturedBody('').text, '');
});

test('utils / headers content-type multipart', () => {
  assertMatch(getContentType({ 'Content-Type': 'application/json' }), /json/);
  assertEqual(getHeader({ 'X-Token': 'abc' }, 'x-token'), 'abc');
  assertEqual(getHeader(null, 'x'), '');
  assert(isMultipart({ 'content-type': 'multipart/form-data; boundary=x' }));
  assert(!isMultipart({ 'content-type': 'application/json' }));
});

test('utils / normalizeHeaders joins cookie and other arrays', () => {
  const out = normalizeHeaders({
    Cookie: ['a=1', 'b=2'],
    Accept: ['text/html', 'application/json'],
    empty: null
  });
  assertEqual(out.Cookie, 'a=1; b=2');
  assertEqual(out.Accept, 'text/html, application/json');
  assertEqual(out.empty, '');
  assertEqual(Object.keys(normalizeHeaders(null)).length, 0);
});

test('utils / sanitizeXmlText strips control chars', () => {
  assertEqual(sanitizeXmlText('a\x00b\x08c'), 'abc');
  assertEqual(sanitizeXmlText(null), '');
});

test('utils / createRecordId unique; safeRecordId strips traversal', () => {
  assert(createRecordId() !== createRecordId());
  const id = safeRecordId('../..\\etc/passwd');
  assert(!id.includes('/'));
  assert(!id.includes('\\'));
  assert(!id.includes('..'));
  assert(safeRecordId('ok-id_1').startsWith('ok-id_1'));
  assert(safeRecordId('').length > 0);
});

test('utils / inflateBody gzip deflate and identity', () => {
  const gz = zlib.gzipSync(Buffer.from('{"ok":true}'));
  const inflated = inflateBody(gz, { 'content-encoding': 'gzip' });
  assert(Buffer.isBuffer(inflated) && inflated.toString() === '{"ok":true}');
  const byMagic = inflateBody(gz, {});
  assert(Buffer.isBuffer(byMagic) && byMagic.toString() === '{"ok":true}');
  const deflated = zlib.deflateSync(Buffer.from('plain'));
  const out = inflateBody(deflated, { 'content-encoding': 'deflate' });
  assert(Buffer.isBuffer(out) && out.toString() === 'plain');
  assertEqual(inflateBody('not-gzip', { 'content-encoding': 'gzip' }), 'not-gzip');
  assertEqual(inflateBody('', { 'content-encoding': 'gzip' }), '');
});

test('utils / limitUtf8Body truncates over MAX_BODY_BYTES', () => {
  assertEqual(limitUtf8Body('hi'), 'hi');
  assertEqual(limitUtf8Body(''), '');
  const big = Buffer.alloc(MAX_BODY_BYTES + 8, 0x61);
  const limited = limitUtf8Body(big);
  assert(Buffer.byteLength(limited, 'utf8') <= MAX_BODY_BYTES);
});

test('utils / truncateUtf8 keeps valid multibyte boundary', () => {
  const text = 'a'.repeat(10) + '中文' + 'b'.repeat(10);
  const max = Buffer.byteLength('a'.repeat(10) + '中', 'utf8');
  const cut = truncateUtf8(text, max);
  assert(Buffer.byteLength(cut, 'utf8') <= max);
  assert(!cut.includes('\uFFFD'));
  assertEqual(cut, 'a'.repeat(10) + '中');
});

test('utils / resourceName last path segment', () => {
  assertEqual(resourceName('https://api.example.com/v1/getInfo'), 'getInfo');
  assertEqual(resourceName('https://api.example.com/tenant/'), 'tenant');
  assertEqual(resourceName('https://api.example.com/'), 'api.example.com');
  assertEqual(resourceName(''), '-');
});

test('utils / initiatorFromHeaders referer then origin then Other', () => {
  assertEqual(initiatorFromHeaders({ Referer: 'https://app.example.com/index.html' }).name, 'index.html');
  assertEqual(initiatorFromHeaders({ origin: 'https://app.example.com' }).name, 'app.example.com');
  assertEqual(initiatorFromHeaders({}).name, 'Other');
});

test('utils / responseTransferSize prefers content-length', () => {
  assertEqual(responseTransferSize({ responseHeaders: { 'Content-Length': '2048' }, responseBody: 'tiny' }), 2048);
  assertEqual(responseTransferSize({ responseHeaders: {}, responseBody: 'abc' }), 3);
});

test('utils / resourceType from content-type', () => {
  assertEqual(resourceType({ 'content-type': 'application/json' }), 'json');
  assertEqual(resourceType({ 'content-type': 'text/html' }), 'document');
  assertEqual(resourceType({}), 'xhr');
});

test('utils / mimeType strips charset params', () => {
  assertEqual(mimeType({ 'Content-Type': 'application/json;charset=UTF-8' }), 'application/json');
  assertEqual(mimeType({ 'content-type': 'text/html' }), 'text/html');
  assertEqual(mimeType({}), '');
});

test('utils / durationMs uses end when later than start', () => {
  assertEqual(durationMs(1000, 1045), 45);
  assertEqual(durationMs(1000, 1000), 0);
  assertEqual(durationMs(0, 10), 0);
  assertEqual(durationMs(2000, 1000), 0);
});

test('utils / formatDuration auto converts ms to s', () => {
  assertEqual(formatDuration(null), '-');
  assertEqual(formatDuration(0), '0 ms');
  assertEqual(formatDuration(45), '45 ms');
  assertEqual(formatDuration(999), '999 ms');
  assertEqual(formatDuration(1000), '1 s');
  assertEqual(formatDuration(1234), '1.23 s');
  assertEqual(formatDuration(1500), '1.5 s');
  assertEqual(formatDuration(12500), '12.5 s');
  assertEqual(formatDuration(120000), '120 s');
});
