'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
process.chdir(root);

const pkg = require(path.join(root, 'package.json'));
const tgzName = `${pkg.name}-${pkg.version}.tgz`;
const tgzPath = path.join(root, tgzName);

function run(command, args) {
  const line = [command].concat(args).join(' ');
  console.log('\n> ' + line);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true
  });
  if (result.error) {
    console.error(result.error.message || result.error);
    process.exit(1);
  }
  if (result.status) {
    process.exit(result.status);
  }
}

function cleanOldPackArtifacts(keepFile) {
  let removed = 0;
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith('.tgz')) continue;
    if (!name.startsWith(pkg.name + '-')) continue;
    if (name === path.basename(keepFile)) continue;
    fs.unlinkSync(path.join(root, name));
    removed += 1;
  }
  if (removed) {
    console.log(`cleaned ${removed} old pack artifact(s); kept ${path.basename(keepFile)}`);
  }
}

console.log(`pack / install / restart  ${pkg.name}@${pkg.version}`);
run('npm', ['pack']);

if (!fs.existsSync(tgzPath)) {
  console.error('npm pack 未生成: ' + tgzPath);
  process.exit(1);
}

cleanOldPackArtifacts(tgzPath);
run('w2', ['install', tgzPath]);
run('w2', ['restart']);

console.log('');
console.log(`完成: 已安装 ${tgzName} 并重启 Whistle。`);
console.log('插件页请 Ctrl+F5 刷新。');
