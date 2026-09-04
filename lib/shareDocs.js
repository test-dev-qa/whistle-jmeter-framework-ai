'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PassThrough } = require('stream');
const { promisify } = require('util');
const gzipAsync = promisify(zlib.gzip);
const { DATA_DIR } = require('./paths');
const { atomicWriteFile, atomicWriteBuffer } = require('./fsutil');
const { diffTextLines } = require('./textDiff');
const { createRecordId } = require('./utils');
const { markdownToHtml, wrapSharePage } = require('./markdown');

// 默认：项目根 docs/；若设置了 DATA_DIR（单测/自定义），则落到 DATA_DIR/docs
const PROJECT_ROOT = path.join(__dirname, '..');
const ROOT = process.env.JMETER_EXPORTER_DOCS_DIR
  || (process.env.JMETER_EXPORTER_DATA_DIR
    ? path.join(process.env.JMETER_EXPORTER_DATA_DIR, 'docs')
    : path.join(PROJECT_ROOT, 'docs'));
const LEGACY_ROOT = path.join(DATA_DIR, 'shareDocs');
const INDEX_FILE = path.join(ROOT, '.index.json');
const CONTENT_DIR = path.join(ROOT, 'files');
const MEDIA_DIR = path.join(ROOT, 'media');
const VERSIONS_DIR = path.join(ROOT, '.versions');
const MAX_VERSIONS_PER_DOC = 30;
const MAX_DOCS = 200;
const MAX_STATIONS = 50;
const MAX_CONTENT_CHARS = 1.5 * 1024 * 1024;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

const FORMATS = new Set(['md', 'html', 'doc']);
const MEDIA_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv'
};

function ensureDirs() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function migrateLegacyIfNeeded() {
  try {
    if (fs.existsSync(INDEX_FILE)) return;
    const legacyIndex = path.join(LEGACY_ROOT, 'index.json');
    if (!fs.existsSync(legacyIndex)) return;
    ensureDirs();
    const raw = JSON.parse(fs.readFileSync(legacyIndex, 'utf8'));
    atomicWriteFile(INDEX_FILE, JSON.stringify(raw, null, 2));
    const legacyContent = path.join(LEGACY_ROOT, 'content');
    if (fs.existsSync(legacyContent)) {
      fs.readdirSync(legacyContent).forEach((name) => {
        const src = path.join(legacyContent, name);
        const dest = path.join(CONTENT_DIR, name);
        if (fs.statSync(src).isFile() && !fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      });
    }
  } catch (e) {
    // ignore migrate errors
  }
}

function loadIndex() {
  ensureDirs();
  migrateLegacyIfNeeded();
  if (!fs.existsSync(INDEX_FILE)) {
    const idx = defaultIndex();
    saveIndex(idx);
    return idx;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return {
      stations: Array.isArray(raw.stations) ? raw.stations : defaultIndex().stations,
      docs: Array.isArray(raw.docs) ? raw.docs : []
    };
  } catch (e) {
    const backup = `${INDEX_FILE}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(INDEX_FILE, backup);
    } catch (_) {
      // ignore backup failure
    }
    throw new Error(`分享索引损坏，已备份为 ${path.basename(backup)}，请修复后重试`);
  }
}

function defaultIndex() {
  return {
    stations: [
      {
        id: 'local',
        name: '本机文档站',
        url: 'plugin://share',
        status: 'published',
        createdAt: Date.now()
      }
    ],
    docs: []
  };
}

function saveIndex(idx) {
  ensureDirs();
  atomicWriteFile(INDEX_FILE, JSON.stringify(idx, null, 2));
}

function contentPath(id, format) {
  const ext = FORMATS.has(format) ? format : 'md';
  return path.join(CONTENT_DIR, `${id}.${ext}`);
}

function readablePath(meta) {
  const ext = FORMATS.has(meta.format) ? meta.format : 'md';
  const slug = String(meta.slug || meta.id || 'doc').replace(/[\\/:*?"<>|]+/g, '_');
  return path.join(ROOT, `${slug}.${ext}`);
}

function readContent(meta) {
  const file = contentPath(meta.id, meta.format);
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  } catch (e) {
    // ignore
  }
  try {
    const alt = readablePath(meta);
    if (fs.existsSync(alt)) return fs.readFileSync(alt, 'utf8');
  } catch (e) {
    // ignore
  }
  return '';
}

function versionManifestPath(docId) {
  return path.join(VERSIONS_DIR, String(docId), 'manifest.json');
}

function listDocVersions(docId) {
  const manifest = versionManifestPath(docId);
  if (!fs.existsSync(manifest)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveVersionSnapshot(meta, content) {
  if (!meta || !meta.id) return;
  const text = String(content == null ? '' : content);
  const dir = path.join(VERSIONS_DIR, String(meta.id));
  fs.mkdirSync(dir, { recursive: true });
  const versions = listDocVersions(meta.id);
  const versionId = `v${Date.now()}`;
  const entry = {
    id: versionId,
    savedAt: Date.now(),
    title: meta.title,
    format: meta.format,
    size: Buffer.byteLength(text, 'utf8')
  };
  atomicWriteFile(path.join(dir, `${versionId}.${meta.format}`), text);
  versions.unshift(entry);
  while (versions.length > MAX_VERSIONS_PER_DOC) {
    const old = versions.pop();
    if (!old) break;
    try {
      fs.unlinkSync(path.join(dir, `${old.id}.${old.format}`));
    } catch (e) {
      // ignore
    }
  }
  atomicWriteFile(versionManifestPath(meta.id), JSON.stringify(versions, null, 2));
}

function getDocVersion(docId, versionId) {
  const versions = listDocVersions(docId);
  const entry = versions.find((item) => item.id === String(versionId || ''));
  if (!entry) throw new Error('版本不存在');
  const file = path.join(VERSIONS_DIR, String(docId), `${entry.id}.${entry.format}`);
  if (!fs.existsSync(file)) throw new Error('版本文件缺失');
  return Object.assign({}, entry, {
    docId: String(docId),
    content: fs.readFileSync(file, 'utf8')
  });
}

function restoreDocVersion(docId, versionId) {
  const version = getDocVersion(docId, versionId);
  return updateDoc(docId, { content: version.content });
}

function compareDocVersions(docId, fromVersionId, toVersionId) {
  const fromId = String(fromVersionId || '');
  const toId = String(toVersionId || '');
  if (!fromId || !toId) throw new Error('请选择两个版本');
  if (fromId === toId) throw new Error('请选择不同的版本');
  const from = getDocVersion(docId, fromId);
  const to = getDocVersion(docId, toId);
  const diff = diffTextLines(from.content, to.content);
  return {
    from: { id: from.id, savedAt: from.savedAt, size: from.size },
    to: { id: to.id, savedAt: to.savedAt, size: to.size },
    stats: diff.stats,
    lines: diff.lines.filter((line) => line.op !== 'eq')
  };
}

function deleteDocVersions(docId) {
  const dir = path.join(VERSIONS_DIR, String(docId));
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

function writeContent(meta, content) {
  ensureDirs();
  const text = String(content == null ? '' : content);
  if (text.length > MAX_CONTENT_CHARS) {
    throw new Error(`文档内容过大（上限约 ${Math.round(MAX_CONTENT_CHARS / 1024)}KB）`);
  }
  FORMATS.forEach((fmt) => {
    const p = contentPath(meta.id, fmt);
    if (fmt !== meta.format && fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) { /* ignore */ }
    }
  });
  atomicWriteFile(contentPath(meta.id, meta.format), text);
  // 同步一份可读文件到 docs/{slug}.ext，便于在项目目录直接打开
  try {
    const readable = readablePath(meta);
    // 清理同 id 的旧 slug 文件较难追踪，仅覆盖当前 slug
    atomicWriteFile(readable, text);
  } catch (e) {
    // ignore readable copy errors
  }
}

function normalizeFormat(raw) {
  const f = String(raw || 'md').trim().toLowerCase().replace(/^\./, '');
  if (f === 'htm') return 'html';
  if (f === 'markdown') return 'md';
  if (f === 'docx') return 'doc';
  if (FORMATS.has(f)) return f;
  return 'md';
}

/** 列表「类型」列：优先真实扩展名，回退 format；视频扩展名大写展示 */
function normalizeFileType(raw, formatFallback) {
  let ext = String(raw || '').trim().replace(/^\./, '');
  if (!ext && formatFallback != null) ext = String(formatFallback).trim().replace(/^\./, '');
  ext = ext.toLowerCase();
  if (!ext) return 'md';
  if (ext === 'markdown') return 'md';
  if (ext === 'htm') return 'html';
  if (ext === 'jpeg') return 'jpg';
  if (ext === 'mpeg4') return 'mp4';
  if (ext === 'mp4' || ext === 'webm' || ext === 'ogv' || ext === 'mov' || ext === 'avi') {
    return ext.toUpperCase();
  }
  return ext;
}

function fileTypeFromFilename(filename, formatFallback) {
  const ext = path.extname(String(filename || '')).replace(/^\./, '');
  return normalizeFileType(ext, formatFallback);
}

function resolveFileType(doc) {
  if (!doc) return 'md';
  return normalizeFileType(doc.fileExt || doc.fileType, doc.format);
}

function normalizeExpire(value) {
  if (value == null || value === '' || value === 'forever' || value === 'permanent') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function slugify(title, id) {
  const base = String(title || 'doc')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const short = String(id || createRecordId()).slice(-8);
  return (base || 'doc') + '-' + short;
}

function resolveDocSlug(body, idx, id) {
  const requested = String((body && body.slug) || '').trim().slice(0, 80);
  if (!requested) return slugify(body && body.title, id);
  const taken = (idx.docs || []).some((d) => d.slug === requested);
  if (!taken) return requested;
  return `${requested}-${String(id).slice(-6)}`;
}

function publicMeta(doc) {
  if (!doc) return null;
  const fileType = resolveFileType(doc);
  return {
    id: doc.id,
    title: doc.title,
    format: doc.format,
    fileExt: doc.fileExt || null,
    fileType,
    source: doc.source || 'local',
    stationId: doc.stationId || 'local',
    slug: doc.slug,
    expireAt: doc.expireAt == null ? null : doc.expireAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    size: Number(doc.size) || 0
  };
}

function listStations() {
  return loadIndex().stations.map((s) => Object.assign({}, s));
}

function listDocs(query) {
  const q = String((query && query.q) || '').trim().toLowerCase();
  const stationId = query && query.stationId ? String(query.stationId) : '';
  let docs = loadIndex().docs.map(publicMeta);
  if (stationId) docs = docs.filter((d) => d.stationId === stationId);
  if (q) {
    docs = docs.filter((d) =>
      String(d.title || '').toLowerCase().indexOf(q) >= 0 ||
      String(d.slug || '').toLowerCase().indexOf(q) >= 0 ||
      String(d.format || '').toLowerCase().indexOf(q) >= 0 ||
      String(d.fileType || '').toLowerCase().indexOf(q) >= 0
    );
  }
  return docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function getDoc(id, withContent) {
  const idx = loadIndex();
  const meta = idx.docs.find((d) => d.id === String(id || ''));
  if (!meta) return null;
  const out = publicMeta(meta);
  if (withContent) out.content = readContent(meta);
  return out;
}

function getDocBySlug(slug, withContent) {
  const idx = loadIndex();
  const meta = idx.docs.find((d) => d.slug === String(slug || ''));
  if (!meta) return null;
  const out = publicMeta(meta);
  if (withContent) out.content = readContent(meta);
  return out;
}

function isExpired(doc) {
  if (!doc || doc.expireAt == null) return false;
  return Number(doc.expireAt) > 0 && Date.now() > Number(doc.expireAt);
}

function createStation(body) {
  const idx = loadIndex();
  if (idx.stations.length >= MAX_STATIONS) throw new Error(`文档站数量已达上限 ${MAX_STATIONS}`);
  const name = String((body && body.name) || '').trim().slice(0, 80);
  if (!name) throw new Error('文档站名称必填');
  const station = {
    id: createRecordId(),
    name,
    url: String((body && body.url) || '').trim().slice(0, 300) || 'plugin://share',
    status: (body && body.status) === 'draft' ? 'draft' : 'published',
    createdAt: Date.now()
  };
  idx.stations.push(station);
  saveIndex(idx);
  return station;
}

function updateStation(id, body) {
  const idx = loadIndex();
  const i = idx.stations.findIndex((s) => s.id === String(id || ''));
  if (i < 0) throw new Error('文档站不存在');
  if (body && body.name != null) {
    const name = String(body.name).trim().slice(0, 80);
    if (!name) throw new Error('文档站名称必填');
    idx.stations[i].name = name;
  }
  if (body && body.url != null) idx.stations[i].url = String(body.url).trim().slice(0, 300);
  if (body && body.status != null) {
    idx.stations[i].status = body.status === 'draft' ? 'draft' : 'published';
  }
  saveIndex(idx);
  return Object.assign({}, idx.stations[i]);
}

function deleteStation(id) {
  const key = String(id || '');
  if (key === 'local') throw new Error('默认本机文档站不可删除');
  const idx = loadIndex();
  const before = idx.stations.length;
  idx.stations = idx.stations.filter((s) => s.id !== key);
  if (idx.stations.length === before) return false;
  idx.docs.forEach((d) => {
    if (d.stationId === key) d.stationId = 'local';
  });
  saveIndex(idx);
  return true;
}

function escapeBasic(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createDoc(body) {
  const idx = loadIndex();
  if (idx.docs.length >= MAX_DOCS) throw new Error(`分享文档数量已达上限 ${MAX_DOCS}`);
  const title = String((body && body.title) || '').trim().slice(0, 120) || '未命名文档';
  const format = normalizeFormat(body && body.format);
  const stationId = String((body && body.stationId) || 'local');
  if (!idx.stations.some((s) => s.id === stationId)) throw new Error('文档站不存在');
  const id = createRecordId();
  const now = Date.now();
  let content = body && body.content != null ? String(body.content) : '';
  if (!content) {
    if (format === 'md') content = `# ${title}\n\n在此编写 Markdown 内容。\n`;
    else if (format === 'html') content = `<h1>${escapeBasic(title)}</h1>\n<p>在此编写 HTML 内容。</p>\n`;
    else {
      content = `<html><head><meta charset="utf-8"><title>${escapeBasic(title)}</title></head>` +
        `<body><h1>${escapeBasic(title)}</h1><p>Word 可打开的 HTML 文档。</p></body></html>\n`;
    }
  }
  let fileExt;
  if (body && body.fileExt) {
    fileExt = normalizeFileType(body.fileExt, format).toLowerCase();
  } else if (body && body.filename) {
    fileExt = fileTypeFromFilename(body.filename, format).toLowerCase();
  } else {
    fileExt = normalizeFileType(format, format).toLowerCase();
  }
  const meta = {
    id,
    title,
    format,
    fileExt,
    source: String((body && body.source) || 'local'),
    stationId,
    slug: resolveDocSlug(body, idx, id),
    expireAt: normalizeExpire(body && body.expireAt),
    createdAt: now,
    updatedAt: now,
    size: Buffer.byteLength(content, 'utf8')
  };
  writeContent(meta, content);
  idx.docs.unshift(meta);
  saveIndex(idx);
  return getDoc(id, true);
}

function updateDoc(id, body) {
  const idx = loadIndex();
  const i = idx.docs.findIndex((d) => d.id === String(id || ''));
  if (i < 0) throw new Error('文档不存在');
  const meta = idx.docs[i];
  if (body && body.title != null) {
    const title = String(body.title).trim().slice(0, 120);
    if (!title) throw new Error('标题必填');
    meta.title = title;
  }
  if (body && body.stationId != null) {
    const stationId = String(body.stationId);
    if (!idx.stations.some((s) => s.id === stationId)) throw new Error('文档站不存在');
    meta.stationId = stationId;
  }
  if (body && body.expireAt !== undefined) {
    meta.expireAt = normalizeExpire(body.expireAt);
  }
  if (body && body.format != null) {
    const oldFormat = meta.format;
    meta.format = normalizeFormat(body.format);
    if (body.fileExt == null && body.filename == null) {
      meta.fileExt = meta.format;
    }
    if (body.content == null && meta.format !== oldFormat) {
      const content = readContent(Object.assign({}, meta, { format: oldFormat }));
      writeContent(meta, content);
      meta.size = Buffer.byteLength(content, 'utf8');
    }
  }
  if (body && (body.fileExt != null || body.filename != null)) {
    meta.fileExt = normalizeFileType(body.fileExt || body.filename, meta.format).toLowerCase();
  }
  if (body && body.content != null) {
    const next = String(body.content);
    const prev = readContent(meta);
    if (prev !== next) {
      saveVersionSnapshot(meta, prev);
    }
    writeContent(meta, next);
    meta.size = Buffer.byteLength(next, 'utf8');
  }
  meta.updatedAt = Date.now();
  saveIndex(idx);
  return getDoc(meta.id, true);
}

function deleteDoc(id) {
  const idx = loadIndex();
  const key = String(id || '');
  const meta = idx.docs.find((d) => d.id === key);
  if (!meta) return false;
  idx.docs = idx.docs.filter((d) => d.id !== key);
  saveIndex(idx);
  deleteDocVersions(key);
  FORMATS.forEach((fmt) => {
    const p = contentPath(key, fmt);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) { /* ignore */ }
    }
  });
  try {
    const readable = readablePath(meta);
    if (fs.existsSync(readable)) fs.unlinkSync(readable);
  } catch (e) {
    // ignore
  }
  return true;
}

function stripXml(text) {
  return String(text || '')
    .replace(/<w:tab[^/]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeZipName(name) {
  return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function readZipLocalEntry(buf, offset) {
  if (offset + 30 > buf.length) return null;
  if (buf.readUInt32LE(offset) !== 0x04034b50) return null;
  const flags = buf.readUInt16LE(offset + 6);
  let compSize = buf.readUInt32LE(offset + 18);
  let uncompSize = buf.readUInt32LE(offset + 22);
  const nameLen = buf.readUInt16LE(offset + 26);
  const extraLen = buf.readUInt16LE(offset + 28);
  const method = buf.readUInt16LE(offset + 8);
  const fileName = buf.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
  let dataStart = offset + 30 + nameLen + extraLen;
  let dataEnd = dataStart + compSize;
  if ((flags & 0x8) && compSize === 0) {
    const descOffset = dataStart;
    if (descOffset + 16 <= buf.length && buf.readUInt32LE(descOffset) === 0x08074b50) {
      compSize = buf.readUInt32LE(descOffset + 8);
      uncompSize = buf.readUInt32LE(descOffset + 12);
      dataStart = descOffset + 16;
      dataEnd = dataStart + compSize;
    }
  }
  return {
    method,
    fileName,
    compressed: buf.slice(dataStart, dataEnd),
    uncompSize,
    nextOffset: dataEnd
  };
}

function readZipCentralEntry(buf, offset) {
  if (offset + 46 > buf.length) return null;
  if (buf.readUInt32LE(offset) !== 0x02014b50) return null;
  const method = buf.readUInt16LE(offset + 10);
  const compSize = buf.readUInt32LE(offset + 20);
  const uncompSize = buf.readUInt32LE(offset + 24);
  const nameLen = buf.readUInt16LE(offset + 28);
  const extraLen = buf.readUInt16LE(offset + 30);
  const commentLen = buf.readUInt16LE(offset + 32);
  const localOffset = buf.readUInt32LE(offset + 42);
  const fileName = buf.slice(offset + 46, offset + 46 + nameLen).toString('utf8');
  const local = readZipLocalEntry(buf, localOffset);
  if (!local) return null;
  return {
    method,
    fileName,
    compressed: local.compressed,
    uncompSize: uncompSize || local.uncompSize,
    nextOffset: offset + 46 + nameLen + extraLen + commentLen
  };
}

function inflateZipEntry(entry) {
  if (!entry) return null;
  const { method, compressed, uncompSize } = entry;
  if (method === 0) return compressed.slice(0, uncompSize || compressed.length);
  if (method === 8) return zlib.inflateRawSync(compressed);
  throw new Error('不支持的 DOCX 压缩方式');
}

function findZipEntry(buf, name) {
  const target = normalizeZipName(name);
  let offset = 0;
  while (offset + 30 < buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x04034b50) {
      const entry = readZipLocalEntry(buf, offset);
      if (!entry) break;
      if (normalizeZipName(entry.fileName) === target) {
        return inflateZipEntry(entry);
      }
      offset = entry.nextOffset;
      continue;
    }
    if (sig === 0x02014b50) {
      const entry = readZipCentralEntry(buf, offset);
      if (!entry) break;
      if (normalizeZipName(entry.fileName) === target) {
        return inflateZipEntry(entry);
      }
      offset = entry.nextOffset;
      continue;
    }
    if (sig === 0x06054b50) break;
    offset += 1;
  }
  return null;
}

function extractDocxText(buf) {
  const xml = findZipEntry(buf, 'word/document.xml');
  if (!xml) throw new Error('无法解析 DOCX（缺少 document.xml）');
  return stripXml(xml.toString('utf8'));
}

function detectImport(filename, raw, isBase64) {
  const name = String(filename || 'import.md');
  const lower = name.toLowerCase();
  let buf;
  if (Buffer.isBuffer(raw)) buf = raw;
  else if (isBase64) buf = Buffer.from(String(raw || ''), 'base64');
  else buf = Buffer.from(String(raw || ''), 'utf8');

  if (lower.endsWith('.docx') || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const text = extractDocxText(buf);
    return { format: 'md', content: text, title: path.basename(name, path.extname(name)) };
  }
  const text = buf.toString('utf8');
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return { format: 'html', content: text, title: path.basename(name, path.extname(name)) };
  }
  if (lower.endsWith('.doc')) {
    return { format: 'doc', content: text, title: path.basename(name, path.extname(name)) };
  }
  if (lower.endsWith('.txt')) {
    return { format: 'md', content: text, title: path.basename(name, path.extname(name)) };
  }
  return { format: 'md', content: text, title: path.basename(name, path.extname(name)) || '导入文档' };
}

function importDoc(body) {
  const detected = detectImport(
    body && body.filename,
    body && (body.contentBase64 != null ? body.contentBase64 : body.content),
    body && body.contentBase64 != null
  );
  const format = (body && body.format) || detected.format;
  const fileExt = fileTypeFromFilename(body && body.filename, format).toLowerCase();
  return createDoc({
    title: (body && body.title) || detected.title,
    format,
    fileExt,
    filename: body && body.filename,
    content: detected.content,
    stationId: body && body.stationId,
    source: 'import',
    expireAt: body && body.expireAt
  });
}

function renderDocHtml(doc) {
  if (!doc) return '';
  if (isExpired(doc)) {
    return wrapSharePage('<p>该分享已过期。</p>', escapeBasic(doc.title || '分享文档'));
  }
  let content = doc.content != null ? doc.content : '';
  // /share/:slug 下相对 ./api 会错位；统一改成上一级
  content = String(content)
    .replace(/(src|href)=(["'])\.\/api\/share\/media\//gi, '$1=$2../api/share/media/')
    .replace(/(src|href)=(["'])\/api\/share\/media\//gi, '$1=$2../api/share/media/');

  const mediaCss =
    '<style>img,video{max-width:100%;height:auto;border-radius:6px;margin:8px 0;}' +
    'video{display:block;background:#000;}iframe.share-embed{width:100%;min-height:360px;border:0;border-radius:8px;margin:8px 0;}' +
    '</style>';

  if (doc.format === 'html' || doc.format === 'doc') {
    const trimmed = String(content).trim();
    if (/^<!DOCTYPE/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
      if (/<base\s/i.test(trimmed)) return content;
      return trimmed.replace(/<head([^>]*)>/i, '<head$1><base href="../">' + mediaCss);
    }
    return wrapSharePage(mediaCss + content, escapeBasic(doc.title || '分享文档'))
      .replace('<head>', '<head><base href="../">');
  }
  return wrapSharePage(mediaCss + markdownToHtml(content), escapeBasic(doc.title || '分享文档'))
    .replace('<head>', '<head><base href="../">');
}

function downloadPayload(doc) {
  if (!doc) return null;
  const content = doc.content != null ? doc.content : '';
  const format = normalizeFormat(doc.format);
  const safeTitle = String(doc.title || 'doc').replace(/[\\/:*?"<>|]+/g, '_');
  const filename = `${safeTitle}.${format === 'md' ? 'md' : (format === 'html' ? 'html' : 'doc')}`;
  let body = content;
  let contentType = 'text/plain; charset=utf-8';
  if (format === 'html') contentType = 'text/html; charset=utf-8';
  if (format === 'md') contentType = 'text/markdown; charset=utf-8';
  if (format === 'doc') {
    contentType = 'application/msword';
    if (!/<html[\s>]/i.test(content) && !/<!DOCTYPE/i.test(content)) {
      body = `<html><head><meta charset="utf-8"><title>${escapeBasic(doc.title)}</title></head><body>${content}</body></html>`;
    }
  }
  return { filename, contentType, body: Buffer.from(body, 'utf8') };
}

function safeMediaName(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
}

function saveMedia(body) {
  ensureDirs();
  const mime = String((body && body.mime) || '').toLowerCase().trim();
  const extFromMime = MEDIA_MIME[mime];
  if (!extFromMime) throw new Error('仅支持 png/jpg/gif/webp 图片与 mp4/webm 视频');

  let buf;
  if (body && body.contentBase64) {
    buf = Buffer.from(String(body.contentBase64), 'base64');
  } else if (Buffer.isBuffer(body && body.buffer)) {
    buf = body.buffer;
  } else {
    throw new Error('缺少媒体内容');
  }
  if (!buf.length) throw new Error('媒体内容为空');
  if (buf.length > MAX_MEDIA_BYTES) {
    throw new Error(`媒体过大（上限 ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)}MB）`);
  }

  const original = safeMediaName(body.filename || ('media.' + extFromMime));
  const base = original.replace(/\.[^.]+$/, '') || 'media';
  const name = `${Date.now().toString(36)}-${base.slice(0, 40)}.${extFromMime}`;
  const file = path.join(MEDIA_DIR, name);
  atomicWriteBuffer(file, buf);
  return {
    name,
    mime,
    size: buf.length,
    url: './api/share/media/' + encodeURIComponent(name),
    kind: mime.indexOf('video/') === 0 ? 'video' : 'image'
  };
}

function getMedia(name) {
  ensureDirs();
  const safe = safeMediaName(name);
  if (!safe || safe !== String(name || '')) return null;
  const file = path.join(MEDIA_DIR, safe);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(safe).slice(1).toLowerCase();
  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg'
  };
  return {
    name: safe,
    file,
    mime: mimeMap[ext] || 'application/octet-stream',
    body: fs.readFileSync(file)
  };
}

const SYNC_PACK_VERSION = 1;
const MAX_SYNC_PACK_BYTES = 32 * 1024 * 1024;

function collectReferencedMediaNames(content) {
  const names = new Set();
  const re = /(?:\.\/|\.\.\/|\/)?api\/share\/media\/([A-Za-z0-9._%-]+)/g;
  const text = String(content || '');
  let m;
  while ((m = re.exec(text))) {
    try {
      names.add(decodeURIComponent(m[1]));
    } catch (_) {
      names.add(m[1]);
    }
  }
  return names;
}

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function docPayloadFromMeta(meta) {
  const full = getDoc(meta.id, true);
  return {
    title: full.title,
    format: full.format,
    fileExt: full.fileExt || full.fileType,
    slug: full.slug,
    stationId: full.stationId,
    source: full.source || 'sync',
    expireAt: full.expireAt || null,
    content: full.content || ''
  };
}

function listSyncPackStations(idx) {
  return idx.stations
    .filter((s) => s.id !== 'local')
    .map((s) => ({
      name: s.name,
      url: s.url,
      status: s.status,
      originId: s.id
    }));
}

function filterSyncDocsMeta(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const idx = loadIndex();
  let docsMeta = idx.docs.slice();
  if (Array.isArray(options.docIds) && options.docIds.length) {
    const want = new Set(options.docIds.map(String));
    docsMeta = docsMeta.filter((d) => want.has(d.id));
  }
  return { options, idx, docsMeta };
}

function buildSyncPackData(opts) {
  const { options, idx, docsMeta } = filterSyncDocsMeta(opts);
  const docs = docsMeta.map((meta) => docPayloadFromMeta(meta));

  const mediaNames = new Set();
  if (options.includeMedia !== false) {
    docs.forEach((d) => {
      collectReferencedMediaNames(d.content).forEach((n) => mediaNames.add(n));
    });
  }

  const media = [];
  let mediaBytes = 0;
  for (const name of mediaNames) {
    const item = getMedia(name);
    if (!item) continue;
    mediaBytes += item.body.length;
    if (mediaBytes > MAX_SYNC_PACK_BYTES) {
      throw new Error(`同步包媒体过大（上限 ${Math.round(MAX_SYNC_PACK_BYTES / 1024 / 1024)}MB）`);
    }
    media.push({
      name: item.name,
      mime: item.mime,
      contentBase64: item.body.toString('base64')
    });
  }

  const stations = listSyncPackStations(idx);

  return { docs, media, stations };
}

function finalizeSyncPack(packData) {
  const pack = {
    version: SYNC_PACK_VERSION,
    kind: 'whistle.jmeter-exporter.share-sync',
    exportedAt: Date.now(),
    stations: packData.stations,
    docs: packData.docs,
    media: packData.media
  };
  const json = Buffer.from(JSON.stringify(pack), 'utf8');
  const gz = zlib.gzipSync(json);
  if (gz.length > MAX_SYNC_PACK_BYTES) {
    throw new Error(`同步包过大（上限 ${Math.round(MAX_SYNC_PACK_BYTES / 1024 / 1024)}MB）`);
  }
  return {
    filename: `share-sync-${new Date().toISOString().slice(0, 10)}.wjesync`,
    contentType: 'application/gzip',
    body: gz,
    meta: {
      docs: packData.docs.length,
      media: packData.media.length,
      stations: packData.stations.length,
      bytes: gz.length
    }
  };
}

async function finalizeSyncPackAsync(packData) {
  const pack = {
    version: SYNC_PACK_VERSION,
    kind: 'whistle.jmeter-exporter.share-sync',
    exportedAt: Date.now(),
    stations: packData.stations,
    docs: packData.docs,
    media: packData.media
  };
  const json = Buffer.from(JSON.stringify(pack), 'utf8');
  await yieldEventLoop();
  const gz = await gzipAsync(json);
  if (gz.length > MAX_SYNC_PACK_BYTES) {
    throw new Error(`同步包过大（上限 ${Math.round(MAX_SYNC_PACK_BYTES / 1024 / 1024)}MB）`);
  }
  return {
    filename: `share-sync-${new Date().toISOString().slice(0, 10)}.wjesync`,
    contentType: 'application/gzip',
    body: gz,
    meta: {
      docs: packData.docs.length,
      media: packData.media.length,
      stations: packData.stations.length,
      bytes: gz.length
    }
  };
}

function exportSyncPack(opts) {
  return finalizeSyncPack(buildSyncPackData(opts));
}

async function exportSyncPackStream(opts) {
  const { options, idx, docsMeta } = filterSyncDocsMeta(opts);
  const stations = listSyncPackStations(idx);
  const gzip = zlib.createGzip();
  const out = new PassThrough();
  gzip.pipe(out);

  const meta = {
    docs: docsMeta.length,
    media: 0,
    stations: stations.length,
    bytes: null,
    streamed: true
  };

  const ready = (async () => {
    try {
      gzip.write(
        `{"version":${SYNC_PACK_VERSION},"kind":"whistle.jmeter-exporter.share-sync","exportedAt":${Date.now()},` +
        `"stations":${JSON.stringify(stations)},"docs":[`
      );
      const mediaNames = new Set();
      for (let i = 0; i < docsMeta.length; i += 1) {
        const doc = docPayloadFromMeta(docsMeta[i]);
        if (options.includeMedia !== false) {
          collectReferencedMediaNames(doc.content).forEach((n) => mediaNames.add(n));
        }
        if (i) gzip.write(',');
        gzip.write(JSON.stringify(doc));
        if (i % 8 === 7) await yieldEventLoop();
      }
      gzip.write('],"media":[');
      let mediaBytes = 0;
      let firstMedia = true;
      for (const name of mediaNames) {
        const item = getMedia(name);
        if (!item) continue;
        mediaBytes += item.body.length;
        if (mediaBytes > MAX_SYNC_PACK_BYTES) {
          throw new Error(`同步包媒体过大（上限 ${Math.round(MAX_SYNC_PACK_BYTES / 1024 / 1024)}MB）`);
        }
        const entry = JSON.stringify({
          name: item.name,
          mime: item.mime,
          contentBase64: item.body.toString('base64')
        });
        if (!firstMedia) gzip.write(',');
        gzip.write(entry);
        firstMedia = false;
        meta.media += 1;
        if (meta.media % 4 === 0) await yieldEventLoop();
      }
      gzip.write(']}');
      gzip.end();
    } catch (e) {
      gzip.destroy(e);
      out.destroy(e);
      throw e;
    }
  })();

  return {
    filename: `share-sync-${new Date().toISOString().slice(0, 10)}.wjesync`,
    contentType: 'application/gzip',
    stream: out,
    meta,
    ready
  };
}

async function exportSyncPackAsync(opts) {
  const payload = await exportSyncPackStream(opts);
  const chunks = [];
  for await (const chunk of payload.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  await payload.ready;
  const body = Buffer.concat(chunks);
  if (body.length > MAX_SYNC_PACK_BYTES) {
    throw new Error(`同步包过大（上限 ${Math.round(MAX_SYNC_PACK_BYTES / 1024 / 1024)}MB）`);
  }
  return {
    filename: payload.filename,
    contentType: payload.contentType,
    body,
    meta: Object.assign({}, payload.meta, { bytes: body.length, streamed: false })
  };
}

function decodeSyncPackBuffer(raw, isBase64) {
  let buf;
  if (Buffer.isBuffer(raw)) buf = raw;
  else if (isBase64) buf = Buffer.from(String(raw || ''), 'base64');
  else buf = Buffer.from(String(raw || ''), 'binary');
  if (!buf.length) throw new Error('同步包为空');
  if (buf.length > MAX_SYNC_PACK_BYTES) {
    throw new Error(`同步包过大（上限 ${Math.round(MAX_SYNC_PACK_BYTES / 1024 / 1024)}MB）`);
  }
  let jsonBuf;
  try {
    if (buf[0] === 0x1f && buf[1] === 0x8b) jsonBuf = zlib.gunzipSync(buf);
    else jsonBuf = buf;
  } catch (e) {
    throw new Error('无法解压同步包');
  }
  let pack;
  try {
    pack = JSON.parse(jsonBuf.toString('utf8'));
  } catch (e) {
    throw new Error('同步包 JSON 无效');
  }
  if (!pack || pack.kind !== 'whistle.jmeter-exporter.share-sync') {
    throw new Error('不是有效的分享同步包');
  }
  if (Number(pack.version) > SYNC_PACK_VERSION) {
    throw new Error(`同步包版本过高（${pack.version}），请升级插件`);
  }
  return pack;
}

function rewriteMediaNamesInContent(content, nameMap) {
  let text = String(content || '');
  for (const [from, to] of nameMap.entries()) {
    if (!from || from === to) continue;
    const encFrom = encodeURIComponent(from);
    const encTo = encodeURIComponent(to);
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escEnc = encFrom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(`((?:\\.\\./|\\.\\/|\\/)?api\\/share\\/media\\/)${esc}(?=["'\\s)>]|$)`, 'g'),
      `$1${to}`
    );
    text = text.replace(
      new RegExp(`((?:\\.\\./|\\.\\/|\\/)?api\\/share\\/media\\/)${escEnc}(?=["'\\s)>]|$)`, 'g'),
      `$1${encTo}`
    );
  }
  return text;
}

function importSyncPack(body) {
  const opts = body && typeof body === 'object' ? body : {};
  const raw = opts.contentBase64 != null ? opts.contentBase64 : opts.content;
  const isBase64 = opts.contentBase64 != null && !Buffer.isBuffer(raw);
  const pack = decodeSyncPackBuffer(raw, isBase64);
  const stationIdMap = new Map();
  stationIdMap.set('local', 'local');
  const createdStations = [];
  const errors = [];
  (Array.isArray(pack.stations) ? pack.stations : []).forEach((s) => {
    const originId = String((s && s.originId) || '');
    try {
      const created = createStation({
        name: (s && s.name) || '导入文档站',
        url: s && s.url,
        status: s && s.status
      });
      createdStations.push(created);
      if (originId) stationIdMap.set(originId, created.id);
    } catch (e) {
      if (originId) stationIdMap.set(originId, 'local');
      errors.push({ type: 'station', name: s && s.name, error: String(e.message || e).slice(0, 160) });
    }
  });

  const nameMap = new Map();
  const importedMedia = [];
  (Array.isArray(pack.media) ? pack.media : []).forEach((m) => {
    if (!m || !m.contentBase64) return;
    try {
      const saved = saveMedia({
        mime: m.mime,
        filename: m.name,
        contentBase64: m.contentBase64
      });
      importedMedia.push(saved);
      if (m.name) nameMap.set(String(m.name), saved.name);
    } catch (e) {
      errors.push({ type: 'media', name: m && m.name, error: String(e.message || e).slice(0, 160) });
    }
  });

  const importedDocs = [];
  (Array.isArray(pack.docs) ? pack.docs : []).forEach((d) => {
    if (!d) return;
    const stationId = stationIdMap.get(String(d.stationId || 'local')) || 'local';
    let content = rewriteMediaNamesInContent(d.content || '', nameMap);
    try {
      const doc = createDoc({
        title: d.title,
        format: d.format,
        fileExt: d.fileExt,
        slug: d.slug,
        content,
        stationId,
        source: 'sync',
        expireAt: d.expireAt
      });
      importedDocs.push({ id: doc.id, title: doc.title, slug: doc.slug });
    } catch (e) {
      errors.push({ type: 'doc', title: d && d.title, error: String(e.message || e).slice(0, 160) });
    }
  });

  return {
    stations: createdStations.length,
    media: importedMedia.length,
    docs: importedDocs.length,
    items: importedDocs,
    errors: errors.length ? errors : undefined
  };
}

module.exports = {
  FORMATS: Array.from(FORMATS),
  MAX_DOCS,
  MAX_STATIONS,
  MAX_CONTENT_CHARS,
  MAX_MEDIA_BYTES,
  MAX_SYNC_PACK_BYTES,
  ROOT,
  CONTENT_DIR,
  MEDIA_DIR,
  loadIndex,
  listStations,
  listDocs,
  getDoc,
  getDocBySlug,
  isExpired,
  createStation,
  updateStation,
  deleteStation,
  createDoc,
  updateDoc,
  deleteDoc,
  listDocVersions,
  getDocVersion,
  restoreDocVersion,
  compareDocVersions,
  importDoc,
  detectImport,
  renderDocHtml,
  downloadPayload,
  normalizeFormat,
  normalizeFileType,
  fileTypeFromFilename,
  resolveFileType,
  publicMeta,
  saveMedia,
  getMedia,
  exportSyncPack,
  exportSyncPackAsync,
  exportSyncPackStream,
  importSyncPack,
  collectReferencedMediaNames
};
