'use strict';

const { test, assert, assertThrows } = require('./harness');
const { generateJMX } = require('../lib/jmxGenerator');
const { captureRequestPayload, removeRecordUploads } = require('../lib/multipart');

test('jmx / multipart export uses uploadDir and DO_MULTIPART_POST', () => {
  const boundary = '----WJE';
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="a.txt"',
    'Content-Type: text/plain',
    '',
    'file-bytes',
    `--${boundary}--`,
    ''
  ].join('\r\n');
  const payload = captureRequestPayload('jmx-mp', {
    'content-type': `multipart/form-data; boundary=${boundary}`
  }, Buffer.from(body));
  const xml = generateJMX([{
    url: 'https://example.com/upload',
    method: 'POST',
    requestHeaders: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    requestBody: '',
    responseStatus: 200,
    multipart: payload.multipart
  }], { correlateToken: false });
  assert(xml.includes('uploadDir'));
  assert(xml.includes('DO_MULTIPART_POST'));
  assert(xml.includes('${uploadDir}'));
  removeRecordUploads('jmx-mp');
});

test('jmx / correlateToken true writes JSONPostProcessor', () => {
  const token = 'abcdefghijklmnopqr';
  const xml = generateJMX([
    {
      url: 'https://example.com/login',
      method: 'POST',
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: '{}',
      responseBody: JSON.stringify({ access_token: token }),
      responseStatus: 200
    },
    {
      url: 'https://example.com/me',
      method: 'GET',
      requestHeaders: { Authorization: `Bearer ${token}` },
      requestBody: '',
      responseStatus: 200
    }
  ], { correlateToken: true });
  assert(xml.includes('JSONPostProcessor'));
  assert(xml.includes('${authToken}'));
});

test('jmx / no records argument throws', () => {
  assertThrows(() => generateJMX(), /No records/);
});
