'use strict';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertMatch(actual, re, msg) {
  if (!re.test(String(actual))) {
    throw new Error(msg || `expected ${JSON.stringify(actual)} to match ${re}`);
  }
}

function assertThrows(fn, re, msg) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(msg || 'expected function to throw');
  if (re && !re.test(String(err.message || err))) {
    throw new Error(msg || `thrown message mismatch: ${err.message}`);
  }
}

async function run() {
  let passed = 0;
  let failed = 0;
  const start = Date.now();
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`  ok  ${item.name}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL  ${item.name}`);
      console.error(`        ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n        ') : err}`);
    }
  }
  const ms = Date.now() - start;
  console.log('');
  console.log(`${passed} passed, ${failed} failed, ${tests.length} total (${ms}ms)`);
  if (failed) process.exitCode = 1;
  return failed === 0;
}

module.exports = {
  test,
  assert,
  assertEqual,
  assertMatch,
  assertThrows,
  run,
  tests
};
