'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { atomicWriteFile } = require('./fsutil');

const PREFIX = 'enc:v1:';
const KEY_FILE = path.join(DATA_DIR, '.vault-key');
const KEY_BYTES = 32;

function deriveKeyFromEnv() {
  const raw = process.env.JMETER_EXPORTER_VAULT_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest();
}

function readKeyFile() {
  if (!fs.existsSync(KEY_FILE)) return null;
  const buf = fs.readFileSync(KEY_FILE);
  return buf.length >= KEY_BYTES ? buf.subarray(0, KEY_BYTES) : null;
}

function getVaultKey() {
  const envKey = deriveKeyFromEnv();
  if (envKey) return envKey;
  const existing = readKeyFile();
  if (existing) return existing;
  const key = crypto.randomBytes(KEY_BYTES);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteFile(KEY_FILE, key);
  return key;
}

function isEncrypted(value) {
  return String(value || '').startsWith(PREFIX);
}

function encryptSecret(plain) {
  const text = String(plain == null ? '' : plain);
  if (!text) return '';
  if (isEncrypted(text)) return text;
  const key = getVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

function decryptSecret(stored) {
  const text = String(stored == null ? '' : stored);
  if (!text) return '';
  if (!isEncrypted(text)) return text;
  const body = text.slice(PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3) return text;
  try {
    const key = getVaultKey();
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const data = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    return text;
  }
}

module.exports = {
  PREFIX,
  isEncrypted,
  encryptSecret,
  decryptSecret,
  getVaultKey
};
