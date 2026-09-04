'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');

const CONFIG_FILE = path.join(DATA_DIR, 'projectSettings.json');

const DEFAULTS = {
  name: '',
  description: ''
};

let saved = Object.assign({}, DEFAULTS);

function normalize(src) {
  const body = src && typeof src === 'object' ? src : {};
  return {
    name: String(body.name || '').trim().slice(0, 120),
    description: String(body.description || '').trim().slice(0, 1000)
  };
}

function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFile(CONFIG_FILE, JSON.stringify(saved, null, 2));
  } catch (e) {
    // ignore
  }
}

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      saved = normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
    }
  } catch (e) {
    saved = Object.assign({}, DEFAULTS);
  }
  return get();
}

function get() {
  return Object.assign({}, saved);
}

function save(src) {
  saved = normalize(src);
  saveConfig();
  return get();
}

load();

module.exports = {
  DEFAULTS,
  normalize,
  load,
  get,
  save
};
