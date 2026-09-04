'use strict';

const { spawnSync } = require('child_process');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}

let ok = true;
if (!run(process.execPath, ['scripts/verify-ci-yml.js'])) ok = false;
if (!run(process.execPath, ['test/run.js'])) ok = false;
console.log('');
if (ok) {
  console.log('CI: all checks passed');
  process.exit(0);
}
console.error('CI: failed');
process.exit(1);
