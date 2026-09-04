'use strict';

const { test, assert, assertEqual } = require('./harness');
const thresholds = require('../lib/stressThresholds');

test('stressThresholds / normalize clamps', () => {
  const cfg = thresholds.normalize({
    enabled: true,
    maxFailRate: 200,
    maxAvgLatencyMs: -1,
    minRps: -5
  });
  assertEqual(cfg.maxFailRate, 100);
  assertEqual(cfg.maxAvgLatencyMs, 0);
  assertEqual(cfg.minRps, 0);
});

test('stressThresholds / evaluate fail and pass', () => {
  thresholds.save({
    enabled: true,
    maxFailRate: 1,
    maxAvgLatencyMs: 50,
    maxP90LatencyMs: 80,
    maxP95LatencyMs: 100,
    minRps: 10
  });
  const bad = thresholds.evaluate({
    summary: { failRate: 2, avgLatencyMs: 60, p90LatencyMs: 90, p95LatencyMs: 120, rps: 5 },
    apis: [{ name: '订单查询' }, { method: 'POST', path: '/orders' }]
  });
  assertEqual(bad.passed, false);
  assert(bad.failedCount >= 3);
  assertEqual(bad.items[0].apiName, '订单查询、POST /orders');

  const good = thresholds.evaluate({
    summary: { failRate: 0, avgLatencyMs: 20, p90LatencyMs: 30, p95LatencyMs: 40, rps: 20 }
  });
  assertEqual(good.passed, true);
  assertEqual(good.failedCount, 0);
});

test('stressThresholds / compareReports deltas', () => {
  const baseline = {
    id: 'a',
    summary: { total: 100, rps: 10, avgLatencyMs: 20, failRate: 0, successRate: 100, p50LatencyMs: 10, p90LatencyMs: 30, p95LatencyMs: 40 },
    apis: [{ method: 'GET', path: '/a', name: 'a', total: 100, rps: 10, avgLatencyMs: 20, p90LatencyMs: 30, failRate: 0 }]
  };
  const current = {
    id: 'b',
    summary: { total: 120, rps: 12, avgLatencyMs: 25, failRate: 1, successRate: 99, p50LatencyMs: 12, p90LatencyMs: 35, p95LatencyMs: 45 },
    apis: [
      { method: 'GET', path: '/a', name: 'a', total: 110, rps: 11, avgLatencyMs: 22, p90LatencyMs: 32, failRate: 0 },
      { method: 'POST', path: '/b', name: 'b', total: 10, rps: 1, avgLatencyMs: 40, p90LatencyMs: 50, failRate: 5 }
    ]
  };
  const cmp = thresholds.compareReports(baseline, current);
  assertEqual(cmp.summary.total.delta, 20);
  assertEqual(cmp.summary.rps.delta, 2);
  assert(cmp.apis.some((x) => x.status === 'added' && x.path === '/b'));
  assert(cmp.apis.some((x) => x.status === 'both' && x.path === '/a'));
  assertEqual(cmp.counts.both, 1);
  assertEqual(cmp.counts.added, 1);
  assertEqual(cmp.counts.removed, 0);
  assertEqual(cmp.apis[0].status, 'both');
});

test('stressThresholds / evaluate db latency rule', () => {
  thresholds.save({
    enabled: true,
    maxFailRate: 100,
    maxAvgLatencyMs: 99999,
    maxP90LatencyMs: 99999,
    maxP95LatencyMs: 99999,
    minRps: 0,
    maxAvgDbLatencyMs: 50
  });
  const bad = thresholds.evaluate({
    summary: {
      failRate: 0,
      avgLatencyMs: 1,
      p90LatencyMs: 1,
      p95LatencyMs: 1,
      rps: 1,
      dbTotal: 2,
      avgDbLatencyMs: 80
    }
  });
  assertEqual(bad.passed, false);
  assert(bad.items.some((x) => x.key === 'avgDbLatencyMs' && !x.passed));

  const skipped = thresholds.evaluate({
    summary: {
      failRate: 0,
      avgLatencyMs: 1,
      p90LatencyMs: 1,
      p95LatencyMs: 1,
      rps: 1,
      dbTotal: 0,
      avgDbLatencyMs: 999
    }
  });
  assertEqual(skipped.passed, true);
  assert(!skipped.items.some((x) => x.key === 'avgDbLatencyMs'));
});

test('stressThresholds / compareReports includes series', () => {
  const baseline = {
    id: 'a',
    summary: { total: 100, rps: 10, avgLatencyMs: 20, failRate: 0, successRate: 100, p50LatencyMs: 10, p90LatencyMs: 30, p95LatencyMs: 40, avgDbLatencyMs: 5, dbTotal: 2 },
    apis: [{ method: 'GET', path: '/a', name: 'a', total: 100, rps: 10, avgLatencyMs: 20, p90LatencyMs: 30, failRate: 0 }],
    series: [{ ts: 1, rps: 1, avgLatencyMs: 10, failRate: 0, concurrentUsers: 1 }]
  };
  const current = {
    id: 'b',
    summary: { total: 120, rps: 12, avgLatencyMs: 25, failRate: 1, successRate: 99, p50LatencyMs: 12, p90LatencyMs: 35, p95LatencyMs: 45, avgDbLatencyMs: 8, dbTotal: 3 },
    apis: [{ method: 'GET', path: '/a', name: 'a', total: 110, rps: 11, avgLatencyMs: 22, p90LatencyMs: 32, failRate: 0 }],
    series: [{ ts: 2, rps: 2, avgLatencyMs: 20, failRate: 1, concurrentUsers: 2 }]
  };
  const cmp = thresholds.compareReports(baseline, current);
  assertEqual(cmp.series.baseline.length, 1);
  assertEqual(cmp.series.current.length, 1);
  assertEqual(cmp.summary.avgDbLatencyMs.delta, 3);
});

test('stressThresholds / normalize notify toggles', () => {
  const cfg = thresholds.normalize({
    webhookOnFail: false,
    webhookOnPass: true,
    maxAvgDbLatencyMs: 120
  });
  assertEqual(cfg.webhookOnFail, false);
  assertEqual(cfg.webhookOnPass, true);
  assertEqual(cfg.maxAvgDbLatencyMs, 120);
  assertEqual(cfg.webhookUrl, undefined);
});
