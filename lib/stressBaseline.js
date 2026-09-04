'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');

const BASELINE_FILE = path.join(DATA_DIR, 'stressBaseline.json');

let saved = { reportId: '', pinnedAt: '', label: '' };

function normalize(src) {
  const body = src && typeof src === 'object' ? src : {};
  return {
    reportId: String(body.reportId || '').trim(),
    pinnedAt: String(body.pinnedAt || '').trim(),
    label: String(body.label || '').trim().slice(0, 120)
  };
}

function load() {
  try {
    if (fs.existsSync(BASELINE_FILE)) {
      saved = normalize(JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')));
    }
  } catch (e) {
    saved = normalize({});
  }
  return get();
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteFile(BASELINE_FILE, JSON.stringify(saved, null, 2));
}

function get() {
  return Object.assign({}, saved);
}

function setBaseline(reportId, options) {
  const id = String(reportId || '').trim();
  if (!id) throw new Error('reportId is required');
  const opts = options && typeof options === 'object' ? options : {};
  saved = {
    reportId: id,
    pinnedAt: new Date().toISOString(),
    label: String(opts.label || '').trim().slice(0, 120)
  };
  persist();
  return get();
}

function clearBaseline() {
  saved = normalize({});
  try {
    if (fs.existsSync(BASELINE_FILE)) fs.unlinkSync(BASELINE_FILE);
  } catch (e) {
    // ignore
  }
  return get();
}

function clearIfMatches(reportId) {
  const id = String(reportId || '').trim();
  if (!id || saved.reportId !== id) return false;
  clearBaseline();
  return true;
}

load();

module.exports = {
  get,
  setBaseline,
  clearBaseline,
  clearIfMatches,
  load
};
