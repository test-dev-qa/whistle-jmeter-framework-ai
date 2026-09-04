'use strict';

// UI-REQUEST-DETAIL-001: 验证请求表与请求响应卡片之间的分隔条可上下拖动，
// 两个面板的布局随之调整，并且用户设置会保存到浏览器本地存储。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

// 允许在 CI 或其他本机端口通过环境变量覆盖插件地址。
const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:8899/plugin.jmeter-exporter/';
// 截图仅作为布局人工复核证据，默认写入系统临时目录，不污染仓库。
const artifactDir = process.env.PW_ARTIFACT_DIR || os.tmpdir();
const screenshotPath = path.join(artifactDir, 'request-detail-resizer.png');

async function run() {
  // 确保证据目录存在，并以独立浏览器上下文隔离用户真实数据和本地存储。
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.PW_HEADLESS !== 'false' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10000);
    // 拦截记录接口并注入最小固定数据；一条记录能触发表格真实渲染，
    // 同时不会读取、修改或删除用户捕获的请求。
    await page.route('**/api/records**', route => route.fulfill({ json: {
      code: 0,
      data: [{
        id: 'resizer-fixture',
        method: 'GET',
        url: 'http://api.example.test/resizer',
        name: '拖动高度校验',
        protocol: 'http',
        responseStatus: 200,
        startTime: 1000,
        endTime: 1010,
        requestHeaders: {},
        responseHeaders: {}
      }]
    } }));
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    // 等待固定记录出现，避免在异步加载尚未完成时读取布局尺寸。
    await page.getByText('拖动高度校验').waitFor();

    // 请求表、拖动条和详情卡片是本交互的三个稳定 DOM 锚点。
    const table = page.locator('.table-container');
    const detail = page.locator('#detailPanel');
    const resizer = page.locator('#detailResizer');
    const initialTable = await table.boundingBox();
    const initialDetail = await detail.boundingBox();
    const divider = await resizer.boundingBox();
    // 先验证初始垂直顺序，确保拖动目标位于两个面板之间。
    assert.ok(initialTable && initialDetail && divider, '表格、详情卡片和拖动条应可见');
    assert.ok(initialTable.y + initialTable.height <= divider.y, '拖动条应位于请求表下方');
    assert.ok(divider.y + divider.height <= initialDetail.y, '详情卡片应位于拖动条下方');

    // 从分隔条中心向下拖动 80px，模拟用户扩大请求表区域的鼠标操作。
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2 + 80, { steps: 5 });
    await page.mouse.up();

    const resizedTable = await table.boundingBox();
    const resizedDetail = await detail.boundingBox();
    // 容许少量 CSS 像素误差，断言实际布局变化及详情面板的最小高度保护。
    assert.ok(resizedTable.height >= initialTable.height + 70, '向下拖动应增加请求表高度');
    assert.ok(resizedDetail.height <= initialDetail.height - 70, '向下拖动应压缩请求详情卡片');
    assert.ok(resizedDetail.height >= 180, '详情卡片应保留最小可用高度');
    // 用户下次刷新页面应沿用该偏好，因此断言 localStorage 已写入有效高度。
    assert.equal(await page.evaluate(() => Number(localStorage.getItem('whistle.jmeter-exporter.detail-table-height')) > 0), true, '拖动后的高度应保存');
    // 保存最终布局截图，供运行日志之外的人工视觉检查。
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify({ ok: true, initialTableHeight: initialTable.height, resizedTableHeight: resizedTable.height, screenshotPath }));
  } finally {
    // 无论断言成功或失败都关闭浏览器，防止测试进程遗留句柄。
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
