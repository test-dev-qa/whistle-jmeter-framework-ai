'use strict';

const fs = require('fs');
const { test, assert, assertEqual } = require('./harness');
const {
  captureRequestPayload,
  saveMultipart,
  parseBoundary,
  toBuffer,
  toUploadVarPath,
  removeRecordUploads,
  UPLOAD_ROOT
} = require('../lib/multipart');

function buildMultipart(boundary, parts) {
  const chunks = [];
  parts.forEach((part) => {
    chunks.push(`--${boundary}`);
    chunks.push(`Content-Disposition: form-data; ${part.disposition}`);
    if (part.type) chunks.push(`Content-Type: ${part.type}`);
    chunks.push('');
    chunks.push(part.body);
  });
  chunks.push(`--${boundary}--`);
  chunks.push('');
  return chunks.join('\r\n');
}

test('multipart / parseBoundary quoted and raw', () => {
  assertEqual(parseBoundary('multipart/form-data; boundary=abc'), 'abc');
  assertEqual(parseBoundary('multipart/form-data; boundary="xyz"'), 'xyz');
  assertEqual(parseBoundary('text/plain'), '');
});

test('multipart / toBuffer empty string and buffer', () => {
  assertEqual(toBuffer('').length, 0);
  assertEqual(toBuffer(Buffer.from('ab')).toString(), 'ab');
});

test('multipart / unquoted field plus file saved under uploads', () => {
  const boundary = '----WJE';
  const body = buildMultipart(boundary, [
    { disposition: 'name=title', body: 'hello' },
    { disposition: 'name="file"; filename="a.txt"', type: 'text/plain', body: 'file-bytes' }
  ]);
  const payload = captureRequestPayload('mp-1', {
    'content-type': `multipart/form-data; boundary=${boundary}`
  }, Buffer.from(body));
  assert(payload.multipart);
  assertEqual(payload.multipart.fields[0].value, 'hello');
  assertEqual(payload.multipart.files[0].filename, 'a.txt');
  assertEqual(payload.multipart.files[0].size, Buffer.byteLength('file-bytes'));
  assert(fs.existsSync(payload.multipart.files[0].path));
  const varPath = toUploadVarPath(payload.multipart.files[0].path);
  assert(varPath.startsWith('${uploadDir}/'));
  removeRecordUploads('mp-1');
  assert(!fs.existsSync(payload.multipart.files[0].path));
});

test('multipart / missing boundary treated as binary', () => {
  const payload = captureRequestPayload('mp-2', {
    'content-type': 'multipart/form-data'
  }, Buffer.from('nope'));
  assertEqual(payload.binary, true);
  assertEqual(payload.multipart, null);
});

test('multipart / json body not multipart', () => {
  const payload = captureRequestPayload('json-1', {
    'content-type': 'application/json'
  }, '{"a":1}');
  assertEqual(payload.text, '{"a":1}');
  assertEqual(payload.binary, false);
});

test('multipart / saveMultipart no parts returns null', () => {
  assertEqual(saveMultipart('x', { 'content-type': 'multipart/form-data; boundary=zz' }, Buffer.alloc(0)), null);
});

test('multipart / UPLOAD_ROOT lives under data dir', () => {
  assert(UPLOAD_ROOT.replace(/\\/g, '/').includes('/uploads') || UPLOAD_ROOT.toLowerCase().includes('\\uploads'));
});
