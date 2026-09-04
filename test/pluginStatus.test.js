'use strict';

const { test, assert, assertEqual } = require('./harness');
const { setLastError, getLastError, clearLastError } = require('../lib/pluginStatus');

test('pluginStatus / set get clear', () => {
  clearLastError();
  assertEqual(getLastError(), null);
  setLastError('capture', new Error('boom'));
  const err = getLastError();
  assert(err);
  assertEqual(err.scope, 'capture');
  assertEqual(err.message, 'boom');
  assert(typeof err.at === 'number');
  clearLastError();
  assertEqual(getLastError(), null);
});

test('pluginStatus / string error and default scope; message truncated', () => {
  clearLastError();
  setLastError('', 'plain');
  assertEqual(getLastError().scope, 'plugin');
  assertEqual(getLastError().message, 'plain');
  setLastError('storage', { message: 'x'.repeat(400) });
  assertEqual(getLastError().message.length, 300);
  clearLastError();
});
