'use strict';

const fs = require('fs');
const path = require('path');

const yml = path.join(__dirname, '..', '.gitee', 'pipelines', 'unit-test.yml');
if (!fs.existsSync(yml)) {
  console.error('missing', yml);
  process.exit(1);
}
const text = fs.readFileSync(yml, 'utf8');
if (!/npm run ci/.test(text)) {
  console.error('pipeline must run npm run ci');
  process.exit(1);
}
console.log('CI YAML OK:', yml);
