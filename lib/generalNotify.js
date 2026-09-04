'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');

const CONFIG_FILE = path.join(DATA_DIR, 'generalNotify.json');

const DEFAULTS = {
  webhookEnabled: false,
  webhookUrl: '',
  webhookFormat: 'auto',
  emailEnabled: false,
  emailHookUrl: '',
  notifyEmail: ''
};

let saved = Object.assign({}, DEFAULTS);

function normalizeWebhookFormat(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'feishu' || raw === 'lark' || raw === 'json') return raw === 'lark' ? 'feishu' : raw;
  return 'auto';
}

function normalize(src) {
  const body = src && typeof src === 'object' ? src : {};
  const email = String(body.notifyEmail || body.email || '').trim().slice(0, 200);
  return {
    webhookEnabled: body.webhookEnabled === true,
    webhookUrl: String(body.webhookUrl || '').trim().slice(0, 2000),
    webhookFormat: normalizeWebhookFormat(body.webhookFormat),
    emailEnabled: body.emailEnabled === true,
    emailHookUrl: String(body.emailHookUrl || '').trim().slice(0, 2000),
    notifyEmail: email
  };
}

function migrateFromThresholdsIfNeeded() {
  const current = normalize(saved);
  if (current.webhookUrl || current.emailHookUrl || current.notifyEmail) return;
  try {
    const stressThresholds = require('./stressThresholds');
    const th = stressThresholds.get();
    if (!th.webhookUrl && !th.emailHookUrl && !th.notifyEmail) return;
    saved = normalize({
      webhookEnabled: !!th.webhookUrl,
      webhookUrl: th.webhookUrl,
      webhookFormat: th.webhookFormat,
      emailEnabled: !!th.emailHookUrl,
      emailHookUrl: th.emailHookUrl,
      notifyEmail: th.notifyEmail
    });
    saveConfig();
  } catch (e) {
    // ignore
  }
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
  migrateFromThresholdsIfNeeded();
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

/** Merge general notify channels with threshold trigger toggles for stressNotify. */
function resolveForThreshold(thresholdCfg) {
  const th = thresholdCfg && typeof thresholdCfg === 'object' ? thresholdCfg : {};
  const gn = normalize(saved);
  return {
    webhookUrl: gn.webhookEnabled ? gn.webhookUrl : '',
    webhookFormat: gn.webhookFormat,
    emailHookUrl: gn.emailEnabled ? gn.emailHookUrl : '',
    notifyEmail: gn.emailEnabled ? gn.notifyEmail : '',
    webhookOnFail: th.webhookOnFail !== false,
    webhookOnPass: th.webhookOnPass === true
  };
}

load();

module.exports = {
  DEFAULTS,
  normalize,
  load,
  get,
  save,
  resolveForThreshold
};
