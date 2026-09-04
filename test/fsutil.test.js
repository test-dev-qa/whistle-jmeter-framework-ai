'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assertEqual } = require('./harness');
const { atomicWriteFile } = require('../lib/fsutil');
const { DATA_DIR } = require('../lib/paths');

test('paths / DATA_DIR uses env set by runner', () => {
  assertEqual(DATA_DIR, process.env.JMETER_EXPORTER_DATA_DIR);
});

test('fsutil / atomicWriteFile writes content', () => {
  const file = path.join(os.tmpdir(), `wje-atomic-${process.pid}.json`);
  try {
    atomicWriteFile(file, '{"ok":1}');
    assertEqual(fs.readFileSync(file, 'utf8'), '{"ok":1}');
  } finally {
    try {
      fs.unlinkSync(file);
    } catch (e) {
      // ignore
    }
  }
});
