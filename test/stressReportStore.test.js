'use strict';

const { test, assert, assertEqual } = require('./harness');
const stressReportStore = require('../lib/stressReportStore');

test('stressReportStore / save get list delete', () => {
  const report = {
    id: 'r-demo-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    startedAt: 1000,
    endedAt: 2000,
    status: 'finished',
    config: { users: 5, durationMin: 1, rampUpMin: 0 },
    recordCount: 2,
    summary: {
      total: 100,
      success: 98,
      failed: 2,
      failRate: 2,
      successRate: 98,
      rps: 12.5,
      avgLatencyMs: 20,
      p50LatencyMs: 15,
      p90LatencyMs: 40,
      p95LatencyMs: 55,
      dbTotal: 4,
      avgDbLatencyMs: 9,
      p90DbLatencyMs: 11
    },
    series: [
      { ts: 1100, rps: 10, avgLatencyMs: 18, failRate: 0, concurrentUsers: 3 },
      { ts: 1200, rps: 14, avgLatencyMs: 22, failRate: 1, concurrentUsers: 5 }
    ],
    apis: [
      {
        method: 'GET',
        name: 'ping',
        url: 'http://127.0.0.1/ping',
        path: '/ping',
        total: 60,
        success: 60,
        failed: 0,
        failRate: 0,
        rps: 7.5,
        avgLatencyMs: 12,
        minLatencyMs: 5,
        maxLatencyMs: 40,
        p90LatencyMs: 20,
        detail: {
          request: { id: 'record-ping', url: 'http://127.0.0.1/ping', headers: { 'X-Test': 'yes' }, body: '' },
          failureSamples: [{ status: 500, latencyMs: 40, error: 'HTTP 500', responseHeaders: { 'content-type': 'text/plain' }, responseBody: 'failed' }]
        }
      }
    ],
    executions: [{
      id: 'r-demo-1-1', at: 1200, method: 'GET', name: 'ping', url: 'http://127.0.0.1/ping', path: '/ping',
      ok: false, status: 500, latencyMs: 40, error: 'HTTP 500', requestHeaders: { 'X-Test': 'yes' }, requestBody: '',
      responseHeaders: { 'content-type': 'text/plain' }, responseBody: 'failed'
    }],
    executionDropped: 9
  };

  const saved = stressReportStore.saveReport(report);
  assertEqual(saved.id, 'r-demo-1');
  assertEqual(saved.summary.total, 100);
  assertEqual(saved.series.length, 2);
  assertEqual(saved.apis.length, 1);
  assertEqual(saved.apis[0].method, 'GET');

  const listed = stressReportStore.listReports();
  assert(listed.some((x) => x.id === 'r-demo-1'));

  const got = stressReportStore.getReport('r-demo-1');
  assertEqual(got.summary.rps, 12.5);
  assertEqual(got.summary.dbTotal, 4);
  assertEqual(got.summary.avgDbLatencyMs, 9);
  assertEqual(got.summary.p90DbLatencyMs, 11);
  assertEqual(got.series[1].concurrentUsers, 5);
  assertEqual(got.apis[0].detail.request.headers['X-Test'], 'yes');
  assertEqual(got.apis[0].detail.failureSamples[0].status, 500);
  assertEqual(got.executions[0].responseBody, 'failed');
  assertEqual(got.executionDropped, 9);

  assertEqual(stressReportStore.deleteReport('r-demo-1'), true);
  assertEqual(stressReportStore.getReport('r-demo-1'), null);
});

test('stressReportStore / prune keeps max reports', () => {
  for (let i = 0; i < stressReportStore.MAX_REPORTS + 3; i += 1) {
    stressReportStore.saveReport({
      id: 'prune-' + i,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      startedAt: i,
      endedAt: i + 1,
      status: 'finished',
      config: { users: 1, durationMin: 1, rampUpMin: 0 },
      recordCount: 1,
      summary: { total: 1, success: 1, failed: 0, failRate: 0, successRate: 100, rps: 1, avgLatencyMs: 1, p50LatencyMs: 1, p90LatencyMs: 1, p95LatencyMs: 1 },
      series: [],
      apis: []
    });
  }
  const listed = stressReportStore.listReports();
  assert(listed.length <= stressReportStore.MAX_REPORTS);
  assertEqual(!!stressReportStore.getReport('prune-0'), false);
});
