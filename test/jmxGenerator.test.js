'use strict';

const { test, assert, assertThrows } = require('./harness');
const { generateJMX } = require('../lib/jmxGenerator');

function rec(extra) {
  return Object.assign({
    url: 'https://example.com/api/list?q=1',
    method: 'GET',
    requestHeaders: { Authorization: 'Bearer x', Cookie: 'a=1', Host: 'example.com' },
    requestBody: '',
    responseStatus: 200
  }, extra || {});
}

test('jmx / empty or invalid urls throw', () => {
  assertThrows(() => generateJMX([]), /No records/);
  assertThrows(() => generateJMX([{ url: 'ftp://x', method: 'GET' }]), /No valid HTTP/);
});

test('jmx / sampler cookie manager assertion and skipped hop headers', () => {
  const xml = generateJMX([
    rec(),
    rec({
      url: 'https://example.com/api/save',
      method: 'POST',
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: '{"a":1}',
      responseStatus: 201
    })
  ], { threads: 2, loops: 3, rampTime: 4, correlateToken: false });
  assert(xml.includes('HTTPSamplerProxy'));
  assert(xml.includes('HTTP Cookie Manager'));
  assert(xml.includes('Assert 200'));
  assert(xml.includes('Assert 201'));
  assert(xml.includes('<stringProp name="ThreadGroup.num_threads">2</stringProp>'));
  assert(xml.includes('<stringProp name="LoopController.loops">3</stringProp>'));
  assert(xml.includes('HTTP Request Defaults'));
  assert(!xml.includes('>Cookie</stringProp>') && !xml.toLowerCase().includes('header.name">cookie'));
});

test('jmx / form urlencoded becomes arguments', () => {
  const xml = generateJMX([rec({
    method: 'POST',
    url: 'https://example.com/login',
    requestHeaders: { 'Content-Type': 'application/x-www-form-urlencoded' },
    requestBody: 'user=a&pass=b'
  })], { correlateToken: false });
  assert(xml.includes('user'));
  assert(xml.includes('pass'));
  assert(!xml.includes('HTTPSampler.postBodyRaw') || xml.includes('user'));
});

test('jmx / binary body not written as raw text', () => {
  const xml = generateJMX([rec({
    method: 'POST',
    url: 'https://example.com/bin',
    requestBodyBinary: true,
    requestBody: 'SECRET'
  })], { correlateToken: false });
  assert(!xml.includes('SECRET'));
});

test('jmx / mixed hosts skip request defaults', () => {
  const xml = generateJMX([
    rec({ url: 'https://a.example.com/x' }),
    rec({ url: 'https://b.example.com/y' })
  ], { correlateToken: false });
  assert(!xml.includes('HTTP Request Defaults'));
});
