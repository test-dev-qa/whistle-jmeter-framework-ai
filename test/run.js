'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(os.tmpdir(), `wje-unit-${process.pid}`);
process.env.JMETER_EXPORTER_DATA_DIR = dataDir;
process.env.JMETER_EXPORTER_DOCS_DIR = path.join(dataDir, 'docs');
fs.mkdirSync(dataDir, { recursive: true });

const files = fs.readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (!files.length) {
  console.error('no test/*.test.js files found');
  process.exit(1);
}

process.env.JMETER_EXPORTER_SKIP_PACKAGED_RULES = '1';

console.log(`unit tests  dataDir=${dataDir}`);
console.log(`files: ${files.join(', ')}`);
console.log('');

for (const file of files) {
  require(path.join(__dirname, file));
}

const { run } = require('./harness');

run().finally(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
});
