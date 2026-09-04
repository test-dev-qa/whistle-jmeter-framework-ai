const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { getHeader, isMultipart, looksBinary, decodeCapturedBody, safeRecordId } = require('./utils');

const MAX_MULTIPART_BYTES = 500 * 1024 * 1024;
const MAX_FILES = 12;
const UPLOAD_ROOT = path.join(DATA_DIR, 'uploads');

function toBuffer(body) {
  if (body == null || body === '') return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'latin1');
  return Buffer.from(String(body), 'latin1');
}

function parseBoundary(contentType) {
  const match = String(contentType || '').match(/boundary\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2]).trim() : '';
}

function parseDisposition(value) {
  const raw = String(value || '');
  const name = /(?:^|;)\s*name=(?:"([^"]*)"|([^;\s]+))/i.exec(raw);
  const filename = /(?:^|;)\s*filename=(?:"([^"]*)"|([^;\s]+))/i.exec(raw);
  const filenameStar = /filename\*=(?:UTF-8'')?([^;\s]+)/i.exec(raw);
  let star = '';
  if (filenameStar) {
    try {
      star = decodeURIComponent(filenameStar[1].replace(/['"]/g, ''));
    } catch (e) {
      star = filenameStar[1];
    }
  }
  return {
    name: name ? (name[1] || name[2] || '') : '',
    filename: (filename ? (filename[1] || filename[2] || '') : star) || ''
  };
}

function safeFileName(name, index) {
  const base = path.basename(String(name || `file_${index}`)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return base || `file_${index}`;
}

function parseParts(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = buf.indexOf(delim);
  if (pos === -1) return parts;
  pos += delim.length;
  while (pos < buf.length && parts.length < MAX_FILES + 20) {
    if (buf[pos] === 0x2d && pos + 1 < buf.length && buf[pos + 1] === 0x2d) break;
    if (buf[pos] === 0x0d) pos += 1;
    if (pos < buf.length && buf[pos] === 0x0a) pos += 1;
    const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerText = buf.subarray(pos, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const next = buf.indexOf(Buffer.from(`\r\n--${boundary}`), bodyStart);
    if (next === -1) break;
    parts.push({
      headerText,
      body: buf.subarray(bodyStart, next)
    });
    pos = next + 2 + delim.length;
  }
  return parts;
}

function saveMultipart(recordId, headers, body) {
  const contentType = getHeader(headers, 'content-type');
  const boundary = parseBoundary(contentType);
  if (!boundary) return null;
  const buf = toBuffer(body);
  if (!buf.length) return null;
  const sliced = buf.length > MAX_MULTIPART_BYTES ? buf.subarray(0, MAX_MULTIPART_BYTES) : buf;
  const parsed = parseParts(sliced, boundary);
  if (!parsed.length) return null;

  const dir = path.join(UPLOAD_ROOT, safeRecordId(recordId));
  fs.mkdirSync(dir, { recursive: true });

  const fields = [];
  const files = [];
  parsed.forEach((part, index) => {
    const headerMap = {};
    part.headerText.split('\r\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) headerMap[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });
    const disp = parseDisposition(headerMap['content-disposition']);
    if (!disp.name) return;
    if (disp.filename) {
      if (files.length >= MAX_FILES) return;
      const filename = safeFileName(disp.filename, files.length);
      const filePath = path.join(dir, `${files.length}_${filename}`);
      fs.writeFileSync(filePath, part.body);
      files.push({
        name: disp.name,
        filename,
        mimeType: headerMap['content-type'] || 'application/octet-stream',
        path: filePath,
        size: part.body.length
      });
    } else {
      fields.push({
        name: disp.name,
        value: looksBinary(part.body) ? '' : part.body.toString('utf8')
      });
    }
  });

  if (!fields.length && !files.length) return null;
  return { fields, files };
}

function captureRequestPayload(recordId, headers, body) {
  if (isMultipart(headers)) {
    try {
      const multipart = saveMultipart(recordId, headers, body);
      if (multipart) {
        return { text: '', binary: false, multipart };
      }
    } catch (e) {
      // fall through
    }
    return { text: '', binary: true, multipart: null };
  }
  const decoded = decodeCapturedBody(body);
  return { text: decoded.text, binary: decoded.binary, multipart: null };
}

function removeRecordUploads(recordId) {
  const dir = path.join(UPLOAD_ROOT, safeRecordId(recordId));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

function toPosix(p) {
  return String(p || '').split(path.sep).join('/');
}

function uploadRootPosix() {
  return toPosix(path.resolve(UPLOAD_ROOT));
}

function toUploadVarPath(filePath) {
  if (!filePath) return '';
  const abs = path.resolve(filePath);
  const root = path.resolve(UPLOAD_ROOT);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return toPosix(abs);
  }
  return `\${uploadDir}/${toPosix(rel)}`;
}

function removeAllUploads() {
  try {
    fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

module.exports = {
  MAX_MULTIPART_BYTES,
  UPLOAD_ROOT,
  captureRequestPayload,
  saveMultipart,
  removeRecordUploads,
  removeAllUploads,
  parseBoundary,
  toBuffer,
  toUploadVarPath,
  uploadRootPosix
};
