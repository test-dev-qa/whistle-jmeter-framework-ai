# 单元测试

本目录所有 `*.test.js` 均纳入 Git，随代码一并提交到远端。

## 运行方式

```bash
npm test              # node test/run.js
npm run test:report   # 运行并写入 test-results/unit-test-latest.txt
npm run ci            # CI 门禁（同 npm test）
```

跨平台脚本（均在 `scripts/` 并已入库）：

| 脚本 | 说明 |
|------|------|
| `scripts/run-unit-tests.sh` | Linux/macOS |
| `scripts/run-unit-tests.cmd` | Windows CMD |
| `scripts/run-unit-tests.ps1` | PowerShell |
| `scripts/run-unit-tests-report.js` | 带报告输出 |
| `scripts/ci.js` | Gitee Pipeline 调用 |

## 结构

- `harness.js` — 轻量断言与 `test()` 注册
- `run.js` — 扫描本目录全部 `*.test.js` 并执行
- `smoke.js` — 入口别名，等同 `run.js`

测试数据写入临时目录 `JMETER_EXPORTER_DATA_DIR`（见 `run.js`），不污染项目 `data/`。

## 用例文件（按模块）

| 文件 | 覆盖 |
|------|------|
| assertions.test.js | 响应断言 / JMX 断言 |
| captureConfig.test.js | 捕获与落盘配置 |
| csvGenerator.test.js | CSV 导出 |
| dataStore.test.js | 抓包存储 |
| dbConnections.test.js | 数据库连接 CRUD |
| dbOps.test.js | 后置 SQL / 库列表 |
| extractVars.test.js | 变量提取 |
| fsutil.test.js | 原子写 / 路径 |
| index.test.js | 插件入口 |
| jmxExport.test.js / jmxGenerator.test.js | JMX 生成 |
| jsonPath.test.js | JSONPath |
| k6Generator.test.js | k6 脚本导出 |
| markdown.test.js | Markdown / 分享页 |
| memoryBridge.test.js | MemoryBridge 桥 |
| multipart.test.js |  multipart 解析 |
| mysqlStore.test.js | MySQL 落盘 |
| pdfReport.test.js | 压测 PDF |
| pgStore.test.js | PostgreSQL SQL 预览 |
| pluginRules.test.js | Whistle 规则 |
| pluginStatus.test.js | 插件状态 |
| postOpStore.test.js | 后置操作存储 |
| resStatsServer.test.js | 流量捕获服务 |
| shareDocs.test.js | 分享文档 / 版本 |
| stressBaseline.test.js | 压测基线 |
| stressNotify.test.js | Webhook 通知 |
| stressPostOps.test.js | 压测后置 |
| stressReportStore.test.js | 压测报告 |
| stressTest.test.js | 内置压测 |
| stressThresholds.test.js | 阈值 / 对比 |
| tokenCorrelate.test.js | 参数关联 |
| protocolDecoders.test.js | JSON-RPC 消息解码与协议解码器注册 |
| websocketFrameAdapter.test.js | WebSocket 帧事件适配、方向与关闭事件 |
| utils.test.js | 工具函数 |

## CI

Gitee Go 模板：`.gitee/pipelines/unit-test.yml`（`npm run ci`）。

最新一次完整报告：`test-results/unit-test-latest.txt`（随测试更新一并提交）。

## Playwright UI 用例

浏览器用例单独存放在 `test/playwright/`，不会被轻量单元测试运行器自动收集。

- `stress-report-execution-detail.test.js`：测试报告执行记录筛选、请求名称点击和实际请求/响应详情抽屉。
- 运行方法及用例清单见 `test/playwright/README.md`。
