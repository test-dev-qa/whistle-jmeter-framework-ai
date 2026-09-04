const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');

const USER_FILE = path.join(DATA_DIR, 'plugin-rules.txt');
const PACKAGED_FILE = path.join(__dirname, '..', 'rules.txt');
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');
const MAX_RULES_CHARS = 200000;

const DEFAULT_RULES = [
  '# 默认将匹配的请求交给插件 resStatsServer 统计',
  '* whistle.jmeter-exporter://',
  ''
].join('\n');

let touchTimer = null;

function normalizeRules(text) {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n');
}

function ensureTrailingNewline(text) {
  const value = normalizeRules(text);
  return value.endsWith('\n') ? value : value + '\n';
}

function readFileIfExists(file) {
  try {
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, 'utf8');
    }
  } catch (e) {
    // ignore
  }
  return '';
}

function loadRules() {
  const stored = readFileIfExists(USER_FILE);
  if (stored) return normalizeRules(stored);
  const packaged = readFileIfExists(PACKAGED_FILE);
  if (packaged) return normalizeRules(packaged);
  return DEFAULT_RULES;
}

function saveRules(text) {
  const value = normalizeRules(text);
  if (value.length > MAX_RULES_CHARS) {
    const err = new Error('rules too large');
    err.status = 400;
    throw err;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteFile(USER_FILE, ensureTrailingNewline(value));
  return loadRules();
}

function resetRules() {
  return saveRules(DEFAULT_RULES);
}

function scheduleTouchPackageJson() {
  if (touchTimer) return;
  touchTimer = setTimeout(() => {
    touchTimer = null;
    try {
      const now = new Date();
      fs.utimesSync(PACKAGE_JSON, now, now);
    } catch (e) {
      // ignore: plugin dir may be read-only
    }
  }, 300);
}

function syncPluginRulesFile(options) {
  if (process.env.JMETER_EXPORTER_SKIP_PACKAGED_RULES === '1') {
    return { packaged: false, skipped: true };
  }
  const text = ensureTrailingNewline(loadRules());
  try {
    atomicWriteFile(PACKAGED_FILE, text);
  } catch (e) {
    return { packaged: false, error: e && e.message ? e.message : String(e) };
  }
  if (!options || options.touchPackage !== false) {
    scheduleTouchPackageJson();
  }
  return { packaged: true };
}

function applyStoredRules() {
  if (!fs.existsSync(USER_FILE)) return { applied: false };
  const userText = ensureTrailingNewline(readFileIfExists(USER_FILE));
  const packagedText = ensureTrailingNewline(readFileIfExists(PACKAGED_FILE));
  if (userText === packagedText) return { applied: false, alreadyInSync: true };
  return Object.assign({ applied: true }, syncPluginRulesFile());
}

module.exports = {
  DEFAULT_RULES,
  MAX_RULES_CHARS,
  USER_FILE,
  PACKAGED_FILE,
  loadRules,
  saveRules,
  resetRules,
  syncPluginRulesFile,
  applyStoredRules
};
