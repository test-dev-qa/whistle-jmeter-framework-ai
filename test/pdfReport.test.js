'use strict';

const { test, assert, assertEqual } = require('./harness');
const { buildStressReportPdf, toWinAnsi, findSystemCjkFont } = require('../lib/pdfReport');
const { needsCidFont, toUtf16HexPdfString } = require('../lib/ttfCidFont');

test('pdfReport / toWinAnsi replaces CJK', () => {
  assertEqual(toWinAnsi('abc测试'), 'abc??');
});

test('pdfReport / utf16 hex helper', () => {
  assertEqual(toUtf16HexPdfString('A中'), '<00414e2d>');
  assert(needsCidFont('中文'));
  assert(!needsCidFont('ASCII only'));
});

test('pdfReport / buildStressReportPdf returns PDF bytes', () => {
  const buf = buildStressReportPdf({
    id: 'pdf-1',
    status: 'finished',
    startedAt: Date.now() - 1000,
    endedAt: Date.now(),
    summary: {
      total: 100,
      rps: 10,
      failRate: 1,
      avgLatencyMs: 20,
      p90LatencyMs: 30,
      p95LatencyMs: 40,
      dbTotal: 5,
      avgDbLatencyMs: 8,
      p90DbLatencyMs: 12
    },
    alerts: {
      enabled: true,
      passed: false,
      failedCount: 1,
      items: [{ label: 'failRate', actual: 1, threshold: 0.5, op: 'lte', unit: '%', passed: false }]
    },
    apis: [
      { method: 'GET', path: '/a', total: 50, rps: 5, avgLatencyMs: 10, p90LatencyMs: 15, failRate: 0 }
    ]
  });
  assert(Buffer.isBuffer(buf));
  assert(buf.length > 200);
  const head = buf.slice(0, 8).toString('utf8');
  assertEqual(head.indexOf('%PDF'), 0);
  const text = buf.toString('latin1');
  assert(text.indexOf('%%EOF') >= 0);
  assert(text.indexOf('Stress Test Report') >= 0 || text.indexOf('0041') >= 0);
});

test('pdfReport / CJK embeds CID font when system TTF available', () => {
  const font = findSystemCjkFont();
  const buf = buildStressReportPdf({
    id: 'pdf-cjk',
    status: 'finished',
    startedAt: Date.now(),
    endedAt: Date.now(),
    summary: { total: 1, rps: 1, failRate: 0, avgLatencyMs: 1, p90LatencyMs: 1, p95LatencyMs: 1 },
    apis: [{ method: 'GET', path: '/用户/登录', total: 1, rps: 1, avgLatencyMs: 1, p90LatencyMs: 1, failRate: 0 }]
  });
  assert(Buffer.isBuffer(buf));
  assert(buf.slice(0, 5).toString('utf8') === '%PDF-');
  const latin = buf.toString('latin1');
  assert(latin.indexOf('%%EOF') >= 0);
  if (font) {
    assert(latin.indexOf('CIDFontType2') >= 0);
    assert(latin.indexOf('FontFile2') >= 0);
    assert(latin.indexOf('Identity-H') >= 0);
  } else {
    assert(latin.indexOf('Helvetica') >= 0);
  }
});
