const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  paused: false,
  includeHost: '',
  includePath: '',
  skipDuplicates: true,
  persistEngine: 'sqlite',
  mysqlConnectionId: '',
  postgresConnectionId: ''
};

let config = { ...DEFAULTS };

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return;
    config = normalizeConfig(parsed);
  } catch (e) {
    config = { ...DEFAULTS };
  }
}

function normalizeConfig(src) {
  const rawEngine = src && src.persistEngine;
  const engine = rawEngine === 'mysql' || rawEngine === 'postgres' ? rawEngine : 'sqlite';
  return {
    paused: Boolean(src && src.paused),
    includeHost: String((src && src.includeHost) || '').trim().slice(0, 200),
    includePath: String((src && src.includePath) || '').trim().slice(0, 200),
    skipDuplicates: !src || src.skipDuplicates !== false,
    persistEngine: engine,
    mysqlConnectionId: engine === 'mysql'
      ? String((src && src.mysqlConnectionId) || '').trim().slice(0, 80)
      : '',
    postgresConnectionId: engine === 'postgres'
      ? String((src && src.postgresConnectionId) || '').trim().slice(0, 80)
      : ''
  };
}

function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    // ignore
  }
}

function getCaptureConfig() {
  return { ...config };
}

function setCaptureConfig(partial) {
  config = normalizeConfig({ ...config, ...(partial || {}) });
  saveConfig();
  return getCaptureConfig();
}

function allowsUrl(url) {
  if (config.paused) return false;
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return false;
  }
  if (config.includeHost) {
    const host = config.includeHost.toLowerCase();
    if (!parsed.hostname.toLowerCase().includes(host)) return false;
  }
  if (config.includePath) {
    const needle = config.includePath.toLowerCase();
    const haystack = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

loadConfig();

module.exports = {
  getCaptureConfig,
  setCaptureConfig,
  allowsUrl
};
