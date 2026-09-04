'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:8899/whistle.jmeter-exporter/';
const artifactDir = process.env.PW_ARTIFACT_DIR || os.tmpdir();
const listScreenshotPath = path.join(artifactDir, 'stress-report-execution-list.png');
const detailScreenshotPath = path.join(artifactDir, 'stress-report-execution-detail.png');

function buildReportFixture() {
  const now = Date.now();
  const summary = {
    id: 'ui-stress-report-1',
    createdAt: new Date(now).toISOString(),
    startedAt: now - 2000,
    endedAt: now,
    status: 'finished',
    config: { users: 2, durationMin: 1, rampUpMin: 0 },
    recordCount: 1,
    summary: {
      total: 2,
      success: 1,
      failed: 1,
      failRate: 50,
      successRate: 50,
      rps: 1,
      avgLatencyMs: 31,
      p50LatencyMs: 18,
      p90LatencyMs: 44,
      p95LatencyMs: 44,
      dbTotal: 0,
      avgDbLatencyMs: 0
    }
  };
  return {
    summary,
    report: {
      ...summary,
      alerts: { enabled: false },
      series: [{ ts: now - 1000, rps: 1, avgLatencyMs: 31, failRate: 50, concurrentUsers: 2 }],
      apis: [{
        method: 'POST',
        name: '参数化查询',
        url: 'http://api.example.com/analysis',
        path: '/analysis',
        total: 2,
        success: 1,
        failed: 1,
        failRate: 50,
        rps: 1,
        avgLatencyMs: 31,
        minLatencyMs: 18,
        maxLatencyMs: 44,
        p90LatencyMs: 44,
        detail: { request: {}, failureSamples: [] }
      }],
      executions: [
        {
          id: 'execution-pass',
          at: now - 900,
          method: 'POST',
          name: '成功请求',
          url: 'http://api.example.com/analysis',
          path: '/analysis',
          ok: true,
          status: 200,
          latencyMs: 18,
          requestHeaders: { 'content-type': 'application/json' },
          requestBody: '{"id":1}',
          responseHeaders: { 'content-type': 'application/json' },
          responseBody: '{"success":true}'
        },
        {
          id: 'execution-fail',
          at: now - 500,
          method: 'POST',
          name: '失败请求',
          url: 'http://api.example.com/analysis',
          path: '/analysis',
          ok: false,
          status: 500,
          latencyMs: 44,
          error: '断言失败',
          requestHeaders: { 'content-type': 'application/json' },
          requestBody: '{"id":2}',
          responseHeaders: { 'content-type': 'application/json' },
          responseBody: '{"success":false,"message":"参数异常"}'
        }
      ].concat(Array.from({ length: 52 }, (_, index) => ({
        id: `execution-extra-${index + 1}`,
        at: now - 1000 - index,
        method: 'GET',
        name: `分页请求-${index + 1}`,
        url: 'http://api.example.com/analysis',
        path: '/analysis',
        ok: true,
        status: 200,
        latencyMs: 10 + index,
        requestHeaders: {},
        requestBody: '',
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: '{"success":true}'
      }))),
      executionDropped: 0
    }
  };
}

async function run() {
  const fixture = buildReportFixture();
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.PW_HEADLESS !== 'false' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10000);

    await page.route('**/api/stress/status', route => route.fulfill({
      json: { code: 0, data: { status: 'idle', lastReportId: fixture.summary.id } }
    }));
    await page.route(`**/api/stress/reports/${fixture.summary.id}`, route => route.fulfill({
      json: { code: 0, data: fixture.report }
    }));
    await page.route('**/api/stress/reports', route => route.fulfill({
      json: {
        code: 0,
        data: { items: [fixture.summary], mysqlSync: { ok: true }, baseline: {} }
      }
    }));

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(reportId => openStressReportModal(reportId), fixture.summary.id);

    const rows = page.locator('#reportExecutionBody .report-execution-row');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 50, '默认第一页应展示 50 条执行记录');
    assert.match(await rows.nth(0).innerText(), /失败请求/, '较新的失败请求应排在第一条');
    assert.match(await rows.nth(1).innerText(), /成功请求/, '较早的成功请求应排在第二条');
    assert.equal(await page.evaluate(() => {
      const aggregate = document.querySelector('.report-table-wrap');
      const executions = document.querySelector('.report-execution-wrap');
      return Boolean(aggregate.compareDocumentPosition(executions) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true, '接口请求聚合列表应位于请求执行记录之前');

    const nameFilter = page.getByLabel('接口名称搜索');
    await nameFilter.fill('成功请求');
    assert.equal(await rows.count(), 1, '接口名称搜索应支持模糊匹配');
    assert.match(await rows.first().innerText(), /成功请求/);
    await nameFilter.fill('example.com/analysis');
    assert.equal(await rows.count(), 50, '接口名称搜索应同时匹配 URL，并保持分页展示');
    assert.match(await page.locator('#reportExecutionNote').innerText(), /已保留 54 条/);
    await nameFilter.fill('');

    const localDateTime = timestamp => {
      const date = new Date(timestamp);
      const pad = (value, size = 2) => String(value).padStart(size, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
    };
    await page.getByLabel('请求开始时间').fill(localDateTime(fixture.report.executions[0].at + 1));
    assert.equal(await rows.count(), 1, '开始时间应排除更早的请求');
    assert.match(await rows.first().innerText(), /失败请求/);
    await page.getByLabel('请求结束时间').fill(localDateTime(fixture.report.executions[1].at - 1));
    assert.equal(await rows.count(), 0, '开始和结束时间应组合为闭区间');
    await page.locator('.report-execution-wrap').getByRole('button', { name: '清除' }).click();
    assert.equal(await rows.count(), 50, '清除应重置接口名称和时间区间并返回第一页');

    const pageInfo = page.locator('#reportExecutionPageInfo');
    assert.match(await pageInfo.innerText(), /第 1 \/ 2 页 · 共 54 条/, '默认每页应展示 50 条');
    await page.getByRole('button', { name: '下一页' }).click();
    assert.equal(await rows.count(), 4, '第二页应展示剩余 4 条记录');
    assert.match(await pageInfo.innerText(), /第 2 \/ 2 页/);
    await page.getByLabel('每页记录数').selectOption('20');
    assert.equal(await rows.count(), 20, '切换每页记录数后应回到第一页并展示 20 条');
    assert.match(await pageInfo.innerText(), /第 1 \/ 3 页 · 共 54 条/);
    await page.getByLabel('每页记录数').selectOption('50');

    await page.locator('button[data-report-execution-filter="pass"]').click();
    assert.equal(await rows.count(), 50, '通过筛选应分页展示成功记录');
    assert.match(await pageInfo.innerText(), /第 1 \/ 2 页 · 共 53 条/, '状态筛选后应回到第一页');
    assert.match(await rows.first().innerText(), /成功请求/);

    await page.locator('button[data-report-execution-filter="fail"]').click();
    assert.equal(await rows.count(), 1, '失败筛选应只展示一条记录');
    assert.match(await rows.first().innerText(), /失败请求/);
    assert.match(await rows.locator('.report-execution-time').innerText(), /^\d{2}:\d{2}:\d{2}\.\d{3}$/, '应展示实际请求发起时间');
    await page.screenshot({ path: listScreenshotPath, fullPage: true });

    await page.getByRole('button', { name: /失败请求/ }).click();
    await page.locator('#stressApiDetailModal:not([hidden])').waitFor();
    const detailText = await page.locator('#stressApiDetailBody').innerText();
    for (const expected of ['HTTP 500', '44 ms', '请求时间', '实际请求', '实际响应', '断言失败', '参数异常']) {
      assert.ok(detailText.includes(expected), `详情中应包含：${expected}`);
    }

    await page.screenshot({ path: detailScreenshotPath, fullPage: true });
    console.log(JSON.stringify({ ok: true, executionRows: fixture.report.executions.length, failedRows: 1, listScreenshotPath, detailScreenshotPath }));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
