'use strict';

/**
 * Minimal TrueType subset + PDF CIDFontType2 helpers (no npm deps).
 * Prefer a single .ttf (e.g. SimHei); .ttc is not supported.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function readU16(buf, off) {
  return buf.readUInt16BE(off);
}

function readI16(buf, off) {
  return buf.readInt16BE(off);
}

function readU32(buf, off) {
  return buf.readUInt32BE(off);
}

function align4(n) {
  return (n + 3) & ~3;
}

function parseTableDirectory(buf) {
  if (buf.length < 12) throw new Error('invalid ttf');
  const sfnt = buf.toString('ascii', 0, 4);
  if (sfnt === 'ttcf') throw new Error('ttc not supported');
  const numTables = readU16(buf, 4);
  const tables = Object.create(null);
  for (let i = 0; i < numTables; i += 1) {
    const o = 12 + i * 16;
    const tag = buf.toString('ascii', o, o + 4);
    const offset = readU32(buf, o + 8);
    const length = readU32(buf, o + 12);
    if (offset + length > buf.length) throw new Error('bad table ' + tag);
    tables[tag] = { offset, length, data: buf.subarray(offset, offset + length) };
  }
  return tables;
}

function parseCmap(cmapBuf) {
  const numTables = readU16(cmapBuf, 2);
  let best = null;
  for (let i = 0; i < numTables; i += 1) {
    const o = 4 + i * 8;
    const platformID = readU16(cmapBuf, o);
    const encodingID = readU16(cmapBuf, o + 2);
    const offset = readU32(cmapBuf, o + 4);
    const format = readU16(cmapBuf, offset);
    const score =
      platformID === 3 && encodingID === 10 ? 40 :
      platformID === 0 && encodingID === 4 ? 35 :
      platformID === 3 && encodingID === 1 ? 30 :
      platformID === 0 && encodingID === 3 ? 25 :
      format === 12 ? 20 : format === 4 ? 10 : 0;
    if (score > (best ? best.score : -1)) best = { offset, format, score };
  }
  if (!best) throw new Error('no cmap');
  const map = new Map();
  if (best.format === 4) {
    const segCount = readU16(cmapBuf, best.offset + 6) / 2;
    const endOff = best.offset + 14;
    const startOff = endOff + 2 + segCount * 2;
    const idDeltaOff = startOff + segCount * 2;
    const idRangeOff = idDeltaOff + segCount * 2;
    for (let i = 0; i < segCount; i += 1) {
      const end = readU16(cmapBuf, endOff + i * 2);
      const start = readU16(cmapBuf, startOff + i * 2);
      const idDelta = readI16(cmapBuf, idDeltaOff + i * 2);
      const idRangeOffset = readU16(cmapBuf, idRangeOff + i * 2);
      for (let c = start; c <= end; c += 1) {
        let gid = 0;
        if (idRangeOffset === 0) {
          gid = (c + idDelta) & 0xffff;
        } else {
          const glyphIndexOffset = idRangeOff + i * 2 + idRangeOffset + (c - start) * 2;
          const glyphId = readU16(cmapBuf, glyphIndexOffset);
          gid = glyphId === 0 ? 0 : (glyphId + idDelta) & 0xffff;
        }
        if (gid) map.set(c, gid);
      }
    }
  } else if (best.format === 12) {
    const nGroups = readU32(cmapBuf, best.offset + 12);
    for (let i = 0; i < nGroups; i += 1) {
      const o = best.offset + 16 + i * 12;
      const start = readU32(cmapBuf, o);
      const end = readU32(cmapBuf, o + 4);
      let gid = readU32(cmapBuf, o + 8);
      for (let c = start; c <= end; c += 1) {
        if (gid) map.set(c, gid);
        gid += 1;
      }
    }
  } else {
    throw new Error('unsupported cmap format ' + best.format);
  }
  return map;
}

function parseLoca(locaBuf, maxpBuf, headBuf) {
  const numGlyphs = readU16(maxpBuf, 4);
  const indexToLocFormat = readI16(headBuf, 50);
  const offsets = [];
  if (indexToLocFormat === 0) {
    for (let i = 0; i <= numGlyphs; i += 1) offsets.push(readU16(locaBuf, i * 2) * 2);
  } else {
    for (let i = 0; i <= numGlyphs; i += 1) offsets.push(readU32(locaBuf, i * 4));
  }
  return { numGlyphs, offsets };
}

function parseHmtx(hmtxBuf, hheaBuf, numGlyphs) {
  const numberOfHMetrics = readU16(hheaBuf, 34);
  const advances = new Array(numGlyphs);
  const lsbs = new Array(numGlyphs);
  let lastAdv = 0;
  for (let i = 0; i < numberOfHMetrics; i += 1) {
    lastAdv = readU16(hmtxBuf, i * 4);
    advances[i] = lastAdv;
    lsbs[i] = readI16(hmtxBuf, i * 4 + 2);
  }
  for (let i = numberOfHMetrics; i < numGlyphs; i += 1) {
    advances[i] = lastAdv;
    lsbs[i] = readI16(hmtxBuf, numberOfHMetrics * 4 + (i - numberOfHMetrics) * 2);
  }
  return { advances, lsbs };
}

function collectCompositeDeps(glyfBuf, offsets, gid, needed) {
  if (needed.has(gid)) return;
  needed.add(gid);
  const start = offsets[gid];
  const end = offsets[gid + 1];
  if (end <= start || start + 10 > glyfBuf.length) return;
  const numberOfContours = readI16(glyfBuf, start);
  if (numberOfContours >= 0) return;
  let pos = start + 10;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (pos + 4 > end) break;
    const flags = readU16(glyfBuf, pos);
    const compGid = readU16(glyfBuf, pos + 2);
    collectCompositeDeps(glyfBuf, offsets, compGid, needed);
    pos += 4;
    if (flags & 1) pos += 4;
    else pos += 2;
    if (flags & 8) pos += 2;
    else if (flags & 64) pos += 4;
    else if (flags & 128) pos += 8;
    if (!(flags & 32)) break;
  }
}

function buildCmapFormat4(pairs) {
  // pairs: [{code, gid}] sorted by code, BMP only
  const bmp = pairs.filter((p) => p.code <= 0xffff).sort((a, b) => a.code - b.code);
  if (!bmp.length) bmp.push({ code: 0, gid: 0 });
  const segments = [];
  let segStart = bmp[0].code;
  let prev = bmp[0].code;
  let startIdx = 0;
  for (let i = 1; i <= bmp.length; i += 1) {
    const cur = i < bmp.length ? bmp[i].code : null;
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    segments.push({ start: segStart, end: prev, startIdx });
    if (cur == null) break;
    segStart = cur;
    prev = cur;
    startIdx = i;
  }
  segments.push({ start: 0xffff, end: 0xffff, startIdx: -1 });

  const segCount = segments.length;
  const startCode = Buffer.alloc(segCount * 2);
  const endCode = Buffer.alloc(segCount * 2);
  const idDelta = Buffer.alloc(segCount * 2);
  const idRangeOffset = Buffer.alloc(segCount * 2);
  const glyphIdArray = [];

  for (let i = 0; i < segCount; i += 1) {
    const seg = segments[i];
    endCode.writeUInt16BE(seg.end, i * 2);
    startCode.writeUInt16BE(seg.start, i * 2);
    if (seg.startIdx < 0) {
      idDelta.writeInt16BE(1, i * 2);
      idRangeOffset.writeUInt16BE(0, i * 2);
      continue;
    }
    // Use glyphIdArray + idRangeOffset for reliability
    const rangeOffset = 2 * (segCount - i) + glyphIdArray.length * 2;
    idDelta.writeInt16BE(0, i * 2);
    idRangeOffset.writeUInt16BE(rangeOffset, i * 2);
    for (let c = seg.start; c <= seg.end; c += 1) {
      const p = bmp[seg.startIdx + (c - seg.start)];
      glyphIdArray.push(p ? p.gid : 0);
    }
  }

  const glyphIds = Buffer.alloc(glyphIdArray.length * 2);
  for (let i = 0; i < glyphIdArray.length; i += 1) glyphIds.writeUInt16BE(glyphIdArray[i], i * 2);

  const searchRange = 2 * Math.pow(2, Math.floor(Math.log2(segCount)));
  const entrySelector = Math.log2(searchRange / 2);
  const rangeShift = 2 * segCount - searchRange;
  const length = 16 + segCount * 8 + 2 + glyphIds.length;
  const out = Buffer.alloc(length);
  let o = 0;
  out.writeUInt16BE(4, o); o += 2;
  out.writeUInt16BE(length, o); o += 2;
  out.writeUInt16BE(0, o); o += 2;
  out.writeUInt16BE(segCount * 2, o); o += 2;
  out.writeUInt16BE(searchRange, o); o += 2;
  out.writeUInt16BE(entrySelector, o); o += 2;
  out.writeUInt16BE(rangeShift, o); o += 2;
  endCode.copy(out, o); o += endCode.length;
  out.writeUInt16BE(0, o); o += 2; // reservedPad
  startCode.copy(out, o); o += startCode.length;
  idDelta.copy(out, o); o += idDelta.length;
  idRangeOffset.copy(out, o); o += idRangeOffset.length;
  glyphIds.copy(out, o);
  return out;
}

function checksum(buf) {
  let sum = 0;
  const n = align4(buf.length);
  for (let i = 0; i < n; i += 4) {
    const b0 = i < buf.length ? buf[i] : 0;
    const b1 = i + 1 < buf.length ? buf[i + 1] : 0;
    const b2 = i + 2 < buf.length ? buf[i + 2] : 0;
    const b3 = i + 3 < buf.length ? buf[i + 3] : 0;
    sum = (sum + ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)) >>> 0;
  }
  return sum;
}

function buildTtf(tables) {
  const tags = Object.keys(tables).sort();
  const numTables = tags.length;
  const headerSize = 12 + numTables * 16;
  let offset = headerSize;
  const records = [];
  const bodies = [];
  for (const tag of tags) {
    const data = tables[tag];
    const paddedLen = align4(data.length);
    const padded = Buffer.alloc(paddedLen);
    data.copy(padded);
    records.push({ tag, checkSum: checksum(padded), offset, length: data.length });
    bodies.push(padded);
    offset += paddedLen;
  }
  const searchRange = Math.pow(2, Math.floor(Math.log2(numTables))) * 16;
  const entrySelector = Math.log2(searchRange / 16);
  const rangeShift = numTables * 16 - searchRange;
  const out = Buffer.alloc(offset);
  out.writeUInt32BE(0x00010000, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(rangeShift, 10);
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    const o = 12 + i * 16;
    out.write(r.tag, o, 4, 'ascii');
    out.writeUInt32BE(r.checkSum, o + 4);
    out.writeUInt32BE(r.offset, o + 8);
    out.writeUInt32BE(r.length, o + 12);
  }
  let bodyOff = headerSize;
  for (const body of bodies) {
    body.copy(out, bodyOff);
    bodyOff += body.length;
  }
  // adjust head checkSumAdjustment
  const head = tables.head;
  if (head && head.length >= 12) {
    const headRec = records.find((r) => r.tag === 'head');
    if (headRec) {
      out.writeUInt32BE(0, headRec.offset + 8);
      const sum = checksum(out);
      out.writeUInt32BE((0xb1b0afba - sum) >>> 0, headRec.offset + 8);
    }
  }
  return out;
}

function subsetTtf(fontBuf, codepoints) {
  const tables = parseTableDirectory(fontBuf);
  const required = ['cmap', 'head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf'];
  for (const tag of required) {
    if (!tables[tag]) throw new Error('missing table ' + tag);
  }
  const cmap = parseCmap(tables.cmap.data);
  const { numGlyphs, offsets } = parseLoca(tables.loca.data, tables.maxp.data, tables.head.data);
  const { advances, lsbs } = parseHmtx(tables.hmtx.data, tables.hhea.data, numGlyphs);
  const glyfBuf = tables.glyf.data;

  const needed = new Set([0]);
  const unicodeToOldGid = new Map();
  for (const cp of codepoints) {
    const gid = cmap.get(cp) || 0;
    if (gid) {
      unicodeToOldGid.set(cp, gid);
      collectCompositeDeps(glyfBuf, offsets, gid, needed);
    }
  }

  const oldGids = Array.from(needed).sort((a, b) => a - b);
  const oldToNew = new Map();
  oldGids.forEach((gid, idx) => oldToNew.set(gid, idx));

  const newGlyphData = [];
  const newLoca = [0];
  let glyfLen = 0;
  for (const oldGid of oldGids) {
    const start = offsets[oldGid];
    const end = offsets[oldGid + 1];
    let slice = Buffer.alloc(0);
    if (end > start) {
      slice = Buffer.from(glyfBuf.subarray(start, end));
      const numberOfContours = readI16(slice, 0);
      if (numberOfContours < 0) {
        let pos = 10;
        // rewrite composite glyph ids
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (pos + 4 > slice.length) break;
          const flags = readU16(slice, pos);
          const compOld = readU16(slice, pos + 2);
          const compNew = oldToNew.get(compOld) || 0;
          slice.writeUInt16BE(compNew, pos + 2);
          pos += 4;
          if (flags & 1) pos += 4;
          else pos += 2;
          if (flags & 8) pos += 2;
          else if (flags & 64) pos += 4;
          else if (flags & 128) pos += 8;
          if (!(flags & 32)) break;
        }
      }
    }
    // pad glyph to even
    if (slice.length & 1) slice = Buffer.concat([slice, Buffer.from([0])]);
    newGlyphData.push(slice);
    glyfLen += slice.length;
    newLoca.push(glyfLen);
  }

  const newGlyf = Buffer.concat(newGlyphData.length ? newGlyphData : [Buffer.alloc(0)]);
  const newLocaBuf = Buffer.alloc((newLoca.length) * 4);
  for (let i = 0; i < newLoca.length; i += 1) newLocaBuf.writeUInt32BE(newLoca[i], i * 4);

  const newMaxp = Buffer.from(tables.maxp.data);
  newMaxp.writeUInt16BE(oldGids.length, 4);

  const newHead = Buffer.from(tables.head.data);
  newHead.writeInt16BE(1, 50); // long loca
  newHead.writeUInt32BE(0, 8); // checkSumAdjustment cleared

  const newHhea = Buffer.from(tables.hhea.data);
  newHhea.writeUInt16BE(oldGids.length, 34);

  const newHmtx = Buffer.alloc(oldGids.length * 4);
  for (let i = 0; i < oldGids.length; i += 1) {
    const og = oldGids[i];
    newHmtx.writeUInt16BE(advances[og] || 0, i * 4);
    newHmtx.writeInt16BE(lsbs[og] || 0, i * 4 + 2);
  }

  const cmapPairs = [{ code: 0, gid: 0 }];
  for (const [cp, oldGid] of unicodeToOldGid) {
    if (cp > 0xffff) continue;
    cmapPairs.push({ code: cp, gid: oldToNew.get(oldGid) });
  }
  const cmapSub = buildCmapFormat4(cmapPairs);
  const cmapTable = Buffer.alloc(4 + 8 + cmapSub.length);
  cmapTable.writeUInt16BE(0, 0);
  cmapTable.writeUInt16BE(1, 2);
  cmapTable.writeUInt16BE(3, 4);
  cmapTable.writeUInt16BE(1, 6);
  cmapTable.writeUInt32BE(12, 8);
  cmapSub.copy(cmapTable, 12);

  const outTables = {
    cmap: cmapTable,
    head: newHead,
    hhea: newHhea,
    maxp: newMaxp,
    hmtx: newHmtx,
    loca: newLocaBuf,
    glyf: newGlyf
  };
  if (tables['OS/2']) outTables['OS/2'] = Buffer.from(tables['OS/2'].data);
  if (tables.name) outTables.name = Buffer.from(tables.name.data);
  if (tables.post) {
    const post = Buffer.alloc(32);
    tables.post.data.copy(post, 0, 0, Math.min(32, tables.post.data.length));
    post.writeUInt32BE(0x00030000, 0); // format 3
    outTables.post = post;
  }

  const subsetBuf = buildTtf(outTables);
  const unitsPerEm = readU16(newHead, 18) || 1000;
  const unicodeToNewGid = new Map();
  const gidToUnicode = new Map();
  for (const [cp, oldGid] of unicodeToOldGid) {
    const ng = oldToNew.get(oldGid);
    unicodeToNewGid.set(cp, ng);
    if (!gidToUnicode.has(ng)) gidToUnicode.set(ng, cp);
  }
  // ensure ASCII printable used in reports map when present in font
  for (let cp = 0x20; cp <= 0x7e; cp += 1) {
    if (unicodeToNewGid.has(cp)) continue;
    const og = cmap.get(cp);
    if (og && oldToNew.has(og)) {
      const ng = oldToNew.get(og);
      unicodeToNewGid.set(cp, ng);
      if (!gidToUnicode.has(ng)) gidToUnicode.set(ng, cp);
    }
  }
  const gidWidths = new Map();
  for (const [oldGid, newGid] of oldToNew.entries()) {
    const adv = advances[oldGid] || unitsPerEm;
    gidWidths.set(newGid, Math.round((adv * 1000) / unitsPerEm));
  }
  return {
    fontBuf: subsetBuf,
    unicodeToGid: unicodeToNewGid,
    gidToUnicode,
    gidWidths,
    unitsPerEm
  };
}

function candidateFontPaths() {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const home = os.homedir();
  return [
    path.join(windir, 'Fonts', 'simhei.ttf'),
    path.join(windir, 'Fonts', 'simkai.ttf'),
    path.join(windir, 'Fonts', 'simfang.ttf'),
    path.join(windir, 'Fonts', 'msyh.ttf'),
    path.join(home, '.fonts', 'NotoSansSC-Regular.ttf'),
    path.join(home, '.local', 'share', 'fonts', 'NotoSansSC-Regular.ttf'),
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/System/Library/Fonts/PingFang.ttc'
  ];
}

function findSystemCjkFont() {
  for (const p of candidateFontPaths()) {
    try {
      if (!p || !fs.existsSync(p)) continue;
      if (/\.ttc$/i.test(p)) continue; // skip collections
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 10000) return p;
    } catch (_) {
      // ignore
    }
  }
  return '';
}

function collectCodepoints(text) {
  const set = new Set([0x20]);
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    const cp = s.codePointAt(i);
    set.add(cp);
    if (cp > 0xffff) i += 1;
  }
  return set;
}

function needsCidFont(text) {
  return /[^\x20-\x7E\n\r\t]/.test(String(text || ''));
}

/** Identity-H text: 16-bit CIDs (== glyph ids when CIDToGIDMap is Identity). */
function toCidHexPdfString(str, unicodeToGid) {
  const s = String(str == null ? '' : str);
  let hex = '';
  for (let i = 0; i < s.length; i += 1) {
    const cp = s.codePointAt(i);
    if (cp > 0xffff) i += 1;
    let gid = 0;
    if (unicodeToGid && unicodeToGid.has(cp)) gid = unicodeToGid.get(cp);
    else if (cp === 0x20 && unicodeToGid && unicodeToGid.has(0x20)) gid = unicodeToGid.get(0x20);
    else if (cp >= 0x20 && cp <= 0x7e && unicodeToGid && unicodeToGid.has(cp)) gid = unicodeToGid.get(cp);
    // missing glyph → .notdef (0)
    hex += (gid & 0xffff).toString(16).padStart(4, '0');
  }
  return `<${hex}>`;
}

/** @deprecated alias kept for tests */
function toUtf16HexPdfString(str) {
  const s = String(str == null ? '' : str);
  let hex = '';
  for (let i = 0; i < s.length; i += 1) {
    const cp = s.codePointAt(i);
    if (cp > 0xffff) {
      const c = cp - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      hex += hi.toString(16).padStart(4, '0') + lo.toString(16).padStart(4, '0');
      i += 1;
    } else {
      hex += cp.toString(16).padStart(4, '0');
    }
  }
  return `<${hex}>`;
}

/** Map CID/GID → Unicode for copy/paste and accessibility. */
function buildToUnicodeCmapFromGids(gidToUnicode) {
  const lines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange'
  ];
  const entries = Array.from(gidToUnicode.entries())
    .filter(([gid, cp]) => gid > 0 && cp > 0 && cp <= 0xffff)
    .sort((a, b) => a[0] - b[0]);
  const chunk = 100;
  for (let i = 0; i < entries.length; i += chunk) {
    const part = entries.slice(i, i + chunk);
    lines.push(`${part.length} beginbfchar`);
    for (const [gid, cp] of part) {
      lines.push(`<${gid.toString(16).padStart(4, '0')}> <${cp.toString(16).padStart(4, '0')}>`);
    }
    lines.push('endbfchar');
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  return lines.join('\n');
}

function buildWidthArrayByGid(gidWidths) {
  // gidWidths: Map<gid, width>
  const entries = Array.from(gidWidths.entries()).filter(([g]) => g > 0).sort((a, b) => a[0] - b[0]);
  if (!entries.length) return '[ ]';
  const parts = [];
  for (const [gid, w] of entries) {
    parts.push(`${gid} [${w}]`);
  }
  return `[ ${parts.join(' ')} ]`;
}

module.exports = {
  findSystemCjkFont,
  subsetTtf,
  collectCodepoints,
  needsCidFont,
  toCidHexPdfString,
  toUtf16HexPdfString,
  buildToUnicodeCmapFromGids,
  buildWidthArrayByGid,
  candidateFontPaths
};
