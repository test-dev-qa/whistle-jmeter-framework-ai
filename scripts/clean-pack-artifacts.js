'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const keepName = `${pkg.name}-${pkg.version}.tgz`;
const keepAll = process.argv.includes('--all');

let removed = 0;
for (const name of fs.readdirSync(root)) {
  if (!name.endsWith('.tgz')) continue;
  if (!name.startsWith(pkg.name + '-')) continue;
  if (!keepAll && name === keepName) continue;
  fs.unlinkSync(path.join(root, name));
  removed += 1;
  console.log('removed ' + name);
}

if (removed === 0) {
  console.log(keepAll ? 'no .tgz artifacts' : `kept ${keepName}; nothing else to remove`);
} else {
  console.log(`cleaned ${removed} pack artifact(s)` + (keepAll ? '' : `; kept ${keepName}`));
}
