'use strict';

const fs = require('fs');
const path = require('path');
const { test, assert, assertEqual, assertThrows } = require('./harness');
const { DATA_DIR } = require('../lib/paths');
const {
  DEFAULT_RULES,
  MAX_RULES_CHARS,
  USER_FILE,
  loadRules,
  saveRules,
  resetRules
} = require('../lib/pluginRules');

function cleanup() {
  try { fs.unlinkSync(USER_FILE); } catch (e) {}
  try { fs.unlinkSync(USER_FILE + '.tmp'); } catch (e) {}
}

test('pluginRules / default load uses packaged or builtin rules', () => {
  cleanup();
  const text = loadRules();
  assert(text.indexOf('whistle.jmeter-exporter://') !== -1, 'default should include plugin protocol');
  assertEqual(DEFAULT_RULES.indexOf('* whistle.jmeter-exporter://') !== -1, true);
});

test('pluginRules / save then load roundtrip', () => {
  cleanup();
  const custom = 'api.example.com whistle.jmeter-exporter://\n';
  const saved = saveRules(custom);
  assertEqual(saved, custom);
  assertEqual(loadRules(), custom);
  assert(fs.existsSync(path.join(DATA_DIR, 'plugin-rules.txt')));
  cleanup();
});

test('pluginRules / reset restores default protocol', () => {
  cleanup();
  saveRules('example.com whistle.jmeter-exporter://\n');
  const restored = resetRules();
  assert(restored.indexOf('* whistle.jmeter-exporter://') !== -1);
  cleanup();
});

test('pluginRules / oversized text is rejected', () => {
  cleanup();
  assertThrows(() => saveRules('x'.repeat(MAX_RULES_CHARS + 1)), /too large/);
  cleanup();
});
