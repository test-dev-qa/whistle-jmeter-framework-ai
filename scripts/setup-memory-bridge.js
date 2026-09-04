'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const defaultSource = path.resolve(repoRoot, '..', 'tools', 'memory-bridge');
const defaultRepository = 'git+https://github.com/jiabaobei/memory-bridge.git';

function run(command, args, options) {
  return spawnSync(command, args, Object.assign({
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true
  }, options || {}));
}

function canRun(command, args) {
  const result = run(command, args, { stdio: 'ignore', timeout: 8000 });
  return !result.error && result.status === 0;
}

function pythonCandidates() {
  return process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
}

function findPython() {
  return pythonCandidates().find((command) => canRun(command, ['--version'])) || null;
}

function hasPip(python) {
  return Boolean(python && canRun(python, ['-m', 'pip', '--version']));
}

function ensurePip(python) {
  if (hasPip(python)) return true;
  console.log('未找到 pip，尝试启用 Python ensurepip…');
  const result = run(python, ['-m', 'ensurepip', '--upgrade', '--user']);
  if (result.error || result.status !== 0) return false;
  return hasPip(python);
}

function checkInstalled(python) {
  if (python && canRun(python, ['-m', 'membridge', '--version'])) return true;
  return canRun(process.platform === 'win32' ? 'membridge.exe' : 'membridge', ['--version']);
}

function main() {
  const python = findPython();
  if (checkInstalled(python)) {
    console.log('MemoryBridge 已安装，跳过安装。');
    return 0;
  }
  if (!python) {
    console.error('未找到 Python 3.9+。请先安装 Python，并勾选 Add Python to PATH。');
    return 1;
  }
  if (!ensurePip(python)) {
    console.error('未找到 pip，无法安装 MemoryBridge。');
  let install = run(python, ['-m', 'pip', 'install', '--user', installTarget]);
  if (install.error || install.status !== 0) {
    console.log('当前 Python 受 PEP 668 外部管理环境保护，尝试 --break-system-packages…');
    install = run(python, ['-m', 'pip', 'install', '--user', '--break-system-packages', installTarget]);
  }
  if (install.error || install.status !== 0) {
      console.error('Debian/Ubuntu 请执行：sudo apt-get update && sudo apt-get install -y python3-pip');
    } else if (process.platform === 'darwin') {
      console.error('Debian/Ubuntu 可执行：sudo apt-get install -y python3-venv，然后使用 python3 -m venv 安装。');
    } else {
      console.error('请先为当前 Python 安装 pip，再重新执行本命令。');
    }
    return 1;
  }

  const configuredSource = process.env.MEMBRIDGE_SOURCE;
  const source = path.resolve(configuredSource || defaultSource);
  const hasLocalSource = fs.existsSync(path.join(source, 'pyproject.toml'));
  const repository = process.env.MEMBRIDGE_REPOSITORY || defaultRepository;
  const installTarget = configuredSource || hasLocalSource ? source : repository;
  if (configuredSource && !hasLocalSource) {
    console.error('未找到 MemoryBridge 源码：' + source);
    console.error('请检查 MEMBRIDGE_SOURCE，或删除该变量以使用官方 Git 仓库。');
    return 1;
  }

  console.log('正在安装 MemoryBridge：' + installTarget);
  const install = run(python, ['-m', 'pip', 'install', '--user', installTarget]);
  if (install.error || install.status !== 0) {
    console.error('MemoryBridge 安装失败。');
    return 1;
  }
  if (!checkInstalled(python)) {
    console.error('安装命令已结束，但仍无法执行 membridge。');
    console.error('可尝试设置 MEMBRIDGE_BIN，或执行：' + os.EOL + '  ' + python + ' -m membridge --version');
    return 1;
  }
  console.log('MemoryBridge 安装成功。');
  return 0;
}

process.exitCode = main();