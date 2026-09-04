'use strict';

/**
 * Minimal PDF 1.4 generator for stress reports (text + table, no external deps).
 * ASCII → Helvetica; CJK/other → embedded system TTF subset (CIDFontType2 / Identity-H).
 */

const fs = require('fs');
const {
  findSystemCjkFont,
  subsetTtf,
  collectCodepoints,
  needsCidFont,
  toCidHexPdfString,
  buildToUnicodeCmapFromGids,
  buildWidthArrayByGid
} = require('./ttfCidFont');

function escapePdfText(str) {
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function toWinAnsi(str) {
  // Prefer ASCII-safe output for built-in Helvetica; keep CJK as '?' when no CID font.
  return String(str == null ? '' : str)
    .replace(/[^\x20-\x7E\n]/g, '?');
}

function wrapLines(text, maxChars) {
  const raw = String(text || '');
  const lines = [];
  raw.split(/\r?\n/).forEach((line) => {
    let s = line;
    if (!s) {
      lines.push('');
      return;
    }
    while (s.length > maxChars) {
      lines.push(s.slice(0, maxChars));
      s = s.slice(maxChars);
    }
    lines.push(s);
  });
  return lines;
}

function buildReportLines(report) {
  const summary = (report && report.summary) || {};
  const apis = Array.isArray(report && report.apis) ? report.apis : [];
  const alerts = report && report.alerts;
  const lines = [];

  lines.push('压测报告 / Stress Test Report');
  lines.push(`ID: ${report && report.id || '-'}`);
  lines.push(`状态 / Status: ${report && report.status || '-'}`);
  lines.push(`开始 / Started: ${report && report.startedAt ? new Date(report.startedAt).toISOString() : '-'}`);
  lines.push(`结束 / Ended: ${report && report.endedAt ? new Date(report.endedAt).toISOString() : '-'}`);
  lines.push('');
  lines.push('汇总 / Summary');
  lines.push(`Total: ${summary.total || 0}   RPS: ${summary.rps || 0}   FailRate: ${summary.failRate || 0}%`);
  lines.push(`Avg RT: ${summary.avgLatencyMs || 0} ms   P90: ${summary.p90LatencyMs || 0} ms   P95: ${summary.p95LatencyMs || 0} ms`);
  if (summary.dbTotal) {
    lines.push(`DB ops: ${summary.dbTotal}   Avg DB: ${summary.avgDbLatencyMs || 0} ms   P90 DB: ${summary.p90DbLatencyMs || 0} ms`);
  }
  if (alerts && alerts.enabled) {
    lines.push('');
    lines.push(`阈值 / Threshold: ${alerts.passed ? 'PASS' : 'FAIL'} (${alerts.failedCount || 0} failed)`);
    (alerts.items || []).filter((x) => !x.passed).forEach((x) => {
      const apiPrefix = x.apiName ? `${x.apiName} - ` : '';
      lines.push(`- ${apiPrefix}${x.label}: actual=${x.actual}${x.unit} threshold=${x.op}${x.threshold}${x.unit}`);
    });
  }
  lines.push('');
  lines.push('接口明细 / API Details');
  lines.push('Method Path | Total | RPS | Avg | P90 | Fail%');
  apis.slice(0, 80).forEach((api) => {
    const title = `${api.method || 'GET'} ${(api.path || api.url || api.name || '').slice(0, 48)}`;
    lines.push(
      `${title} | ${api.total || 0} | ${api.rps || 0} | ${api.avgLatencyMs || 0} | ${api.p90LatencyMs || 0} | ${api.failRate || 0}`
    );
  });
  if (apis.length > 80) lines.push(`... and ${apis.length - 80} more APIs`);
  lines.push('');
  lines.push('说明：趋势图请看 HTML/UI；本 PDF 为可携带文本摘要。');
  return lines;
}

function tryBuildCidFont(fullText) {
  if (!needsCidFont(fullText)) return null;
  const fontPath = findSystemCjkFont();
  if (!fontPath) return null;
  try {
    const raw = fs.readFileSync(fontPath);
    const cps = collectCodepoints(fullText);
    const subset = subsetTtf(raw, cps);
    return {
      fontPath,
      fontBuf: subset.fontBuf,
      unicodeToGid: subset.unicodeToGid,
      gidToUnicode: subset.gidToUnicode,
      gidWidths: subset.gidWidths
    };
  } catch (_) {
    return null;
  }
}

function buildStressReportPdf(report) {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  const maxChars = 90;
  const lines = buildReportLines(report);
  const joined = lines.join('\n');
  const cid = tryBuildCidFont(joined);

  const contentLines = [];
  lines.forEach((line) => {
    const src = cid ? String(line) : toWinAnsi(line);
    wrapLines(src, maxChars).forEach((w) => contentLines.push(w));
  });

  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length;
  };

  let fontResourceRef;
  if (cid) {
    const fontFileId = addObj(
      `<< /Length ${cid.fontBuf.length} /Length1 ${cid.fontBuf.length} >>\nstream\n`
    );
    // placeholder; rewrite with binary after — store separately
    const fontFileIndex = fontFileId - 1;
    objects[fontFileIndex] = { __fontStream: true, data: cid.fontBuf };

    const descriptorId = addObj(
      `<< /Type /FontDescriptor /FontName /WJECidFont /Flags 4 ` +
      `/FontBBox [-1000 -400 2000 1000] /Ascent 800 /Descent -200 /CapHeight 700 ` +
      `/ItalicAngle 0 /StemV 80 /FontFile2 ${fontFileId} 0 R >>`
    );
    const wArr = buildWidthArrayByGid(cid.gidWidths);
    const cidFontId = addObj(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /WJECidFont ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${descriptorId} 0 R /DW 1000 /W ${wArr} /CIDToGIDMap /Identity >>`
    );
    const toUnicode = buildToUnicodeCmapFromGids(cid.gidToUnicode);
    const toUnicodeId = addObj(
      `<< /Length ${Buffer.byteLength(toUnicode, 'utf8')} >>\nstream\n${toUnicode}\nendstream`
    );
    fontResourceRef = addObj(
      `<< /Type /Font /Subtype /Type0 /BaseFont /WJECidFont /Encoding /Identity-H ` +
      `/DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`
    );
  } else {
    fontResourceRef = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  }

  const lineHeight = 12;
  const usable = pageHeight - margin * 2;
  const linesPerPage = Math.max(20, Math.floor(usable / lineHeight));
  const pages = [];
  for (let i = 0; i < contentLines.length; i += linesPerPage) {
    pages.push(contentLines.slice(i, i + linesPerPage));
  }
  if (!pages.length) pages.push(['(empty report)']);

  const pageIds = [];
  const contentIds = [];
  pages.forEach((pageLines) => {
    let y = pageHeight - margin;
    const ops = ['BT', `/F1 10 Tf`, `14 TL`, `${margin} ${y} Td`];
    pageLines.forEach((line, idx) => {
      if (idx > 0) ops.push('T*');
      if (cid) {
        ops.push(`${toCidHexPdfString(line, cid.unicodeToGid)} Tj`);
      } else {
        ops.push(`(${escapePdfText(line)}) Tj`);
      }
    });
    ops.push('ET');
    const stream = ops.join('\n');
    const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    const pageId = addObj(null);
    pageIds.push(pageId);
  });

  const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
  const pagesId = addObj(`<< /Type /Pages /Kids [ ${kids} ] /Count ${pageIds.length} >>`);
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  pageIds.forEach((pageId, idx) => {
    objects[pageId - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Contents ${contentIds[idx]} 0 R /Resources << /Font << /F1 ${fontResourceRef} 0 R >> >> >>`;
  });

  // Assemble with binary font streams
  const parts = [Buffer.from('%PDF-1.4\n', 'utf8')];
  const offsets = [0];
  let size = parts[0].length;
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(size);
    const obj = objects[i];
    let chunk;
    if (obj && obj.__fontStream) {
      const head = Buffer.from(
        `${i + 1} 0 obj\n<< /Length ${obj.data.length} /Length1 ${obj.data.length} >>\nstream\n`,
        'utf8'
      );
      const tail = Buffer.from('\nendstream\nendobj\n', 'utf8');
      chunk = Buffer.concat([head, obj.data, tail]);
    } else {
      chunk = Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, 'utf8');
    }
    parts.push(chunk);
    size += chunk.length;
  }
  const xrefPos = size;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  xref += `startxref\n${xrefPos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'utf8'));
  return Buffer.concat(parts);
}

module.exports = {
  buildStressReportPdf,
  escapePdfText,
  toWinAnsi,
  findSystemCjkFont
};
