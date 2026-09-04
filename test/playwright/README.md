# 测试报告请求详情 UI 用例

## 覆盖范围

| 用例 ID | 场景 | 预期结果 |
|---|---|---|
| UI-STRESS-REPORT-001 | 打开含成功、失败记录的测试报告 | “全部”列表显示 2 条执行记录 |
| UI-STRESS-REPORT-002 | 点击“通过”筛选 | 仅显示“成功请求” |
| UI-STRESS-REPORT-003 | 点击“失败”筛选 | 仅显示“失败请求” |
| UI-STRESS-REPORT-004 | 点击失败请求名称 | 打开右侧详情抽屉 |
| UI-STRESS-REPORT-005 | 检查详情内容 | 显示 HTTP 500、44ms、断言错误、实际请求与实际响应 |
| UI-STRESS-REPORT-006 | 检查执行记录时间 | 列表显示精确到毫秒的实际请求发起时间，详情同步显示请求时间 |
| UI-STRESS-REPORT-007 | 检查执行记录顺序 | 按请求发起时间倒序展示，最新请求置顶 |
| UI-STRESS-REPORT-008 | 按接口名称搜索 | 支持按请求名称、路径或 URL 模糊匹配 |
| UI-STRESS-REPORT-009 | 按请求时间区间搜索 | 支持毫秒级开始、结束时间闭区间筛选，并可一键清除 |
| UI-STRESS-REPORT-010 | 检查列表布局顺序 | 接口请求聚合列表位于请求执行记录上方 |
| UI-STRESS-REPORT-011 | 请求执行记录分页 | 默认每页 50 条，支持切换页码及每页 20/50/100/200 条 |
| UI-STRESS-REPORT-012 | 分页与筛选联动 | 修改状态、名称或时间筛选后自动回到第一页 |
| UI-REQUEST-DETAIL-001 | 拖动请求详情卡片分隔条 | 向下拖动增加请求表高度、压缩详情卡片，且保持最小高度并保存设置 |

测试通过 Playwright 拦截报告 API 并注入固定数据，不会新增、删除或修改真实压测报告。

## 前置条件

1. Node.js 20 或更高版本。
2. 本机 Whistle 和插件已启动，默认插件地址为：

```text
http://127.0.0.1:8899/whistle.jmeter-exporter/
```

3. 项目中可解析 `playwright`。未安装时可执行：

```powershell
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

上述命令不会把 Playwright 写入 `package.json` 或 `package-lock.json`。

## 执行命令

```powershell
node .\test\playwright\stress-report-execution-detail.test.js
node .\test\playwright\request-detail-resizer.test.js
```

指定其他插件地址：

```powershell
$env:TARGET_URL = "http://127.0.0.1:8899/whistle.jmeter-exporter/"
node .\test\playwright\stress-report-execution-detail.test.js
```

使用可视浏览器：

```powershell
$env:PW_HEADLESS = "false"
node .\test\playwright\stress-report-execution-detail.test.js
```

指定截图输出目录：

```powershell
$env:PW_ARTIFACT_DIR = ".\test-results\playwright"
node .\test\playwright\stress-report-execution-detail.test.js
```

成功时输出类似：

```json
{"ok":true,"executionRows":54,"failedRows":1,"listScreenshotPath":".../stress-report-execution-list.png","detailScreenshotPath":".../stress-report-execution-detail.png"}
```
