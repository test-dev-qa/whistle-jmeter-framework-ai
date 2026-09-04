'use strict';

const { test, assertEqual } = require('./harness');
const { diffTextLines } = require('../lib/textDiff');

test('textDiff / detects add and remove', () => {
  const diff = diffTextLines('a\nb\nc', 'a\nx\nc');
  assertEqual(diff.stats.removed, 1);
  assertEqual(diff.stats.added, 1);
  assertEqual(diff.stats.unchanged, 2);
  const changes = diff.lines.filter((line) => line.op !== 'eq');
  assertEqual(changes.length, 2);
});

test('textDiff / identical text', () => {
  const diff = diffTextLines('same', 'same');
  assertEqual(diff.stats.added, 0);
  assertEqual(diff.stats.removed, 0);
  assertEqual(diff.stats.unchanged, 1);
});
