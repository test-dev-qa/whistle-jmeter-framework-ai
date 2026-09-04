'use strict';

const { test, assert, assertEqual } = require('./harness');
const { encryptSecret, decryptSecret, isEncrypted } = require('../lib/secretVault');

test('secretVault / roundtrip encrypt decrypt', () => {
  const plain = 'my-db-pass-123';
  const enc = encryptSecret(plain);
  assert(isEncrypted(enc));
  assertEqual(decryptSecret(enc), plain);
});

test('secretVault / empty and idempotent', () => {
  assertEqual(encryptSecret(''), '');
  const enc = encryptSecret('x');
  assertEqual(encryptSecret(enc), enc);
});
