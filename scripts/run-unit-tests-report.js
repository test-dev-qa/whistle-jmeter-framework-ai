'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'test-results');
const outFile = path.join(outDir, 'unit-test-latest.txt');

fs.mkdirSync(outDir, { recursive: true });

const startedAt = new Date();
const header = [
  '# whistle.jmeter-exporter unit test report',
  `# started: ${startedAt.toISOString()}`,
  `# cwd: ${root}`,
  `# command: node test/run.js`,
  '',
  ''
].join('\n');

const chunks = [header];
const child = spawn(process.execPath, [path.join('test', 'run.js')], {
  cwd: root,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe']
});

function append(buf, stream) {
  const text = buf.toString();
  stream.write(text);
  chunks.push(text);
}

child.stdout.on('data', (buf) => append(buf, process.stdout));
child.stderr.on('data', (buf) => append(buf, process.stderr));

child.on('error', (err) => {
  const msg = err && err.stack ? err.stack : String(err);
  process.stderr.write(msg + '\n');
  chunks.push(msg + '\n');
  finish(1);
});

child.on('close', (code) => {
  finish(code == null ? 1 : code);
});

function finish(code) {
  const endedAt = new Date();
  const footer = [
    '',
    `# finished: ${endedAt.toISOString()}`,
    `# duration_ms: ${endedAt.getTime() - startedAt.getTime()}`,
    `# exit_code: ${code}`,
    ''
  ].join('\n');
  chunks.push(footer);
  fs.writeFileSync(outFile, chunks.join(''), 'utf8');
  process.stdout.write(`\n[test-report] wrote ${path.relative(root, outFile)}\n`);
  process.exit(code);
}
