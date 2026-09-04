# Changelog

## 1.1.23

- **修复**：补全分享编辑页「入库 Wiki」按钮处理函数 `ingestShareDocToWiki`（此前 onclick 无实现）

## 1.1.22

- **Wiki 入库扩展**：`lib/wikiIngest.js`；`GET /api/wiki/articles`、`POST /api/wiki/ingest`、`POST /api/share/docs/:id/wiki-ingest`；分享编辑页「入库 Wiki」写入 raw/wiki/index/log

## 1.1.21

- **数据库连接密码加密**：`lib/secretVault.js` AES-256-GCM 落盘；JSON/SQLite/MySQL 同步加密；读取时自动解密；明文旧数据首次加载自动迁移

## 1.1.20

- **分享文档版本 diff**：`lib/textDiff.js` + `compareDocVersions`；版本历史弹窗可选两版对比，行级增删高亮

## 1.1.19

- **分享文档编辑区合并**：Markdown / 富文本共用单一编辑容器，导入 md 后不再出现双编辑框
- Markdown 模式新增轻量工具栏（标题、加粗、列表、链接、图片）
- **Webhook 告警报告名**：由报告 ID 改为「项目名称 · 测试报告名称」（时间 · 并发 · 次数 · RPS · 状态）
- **WebSocket / gRPC 协议识别**：`lib/protocolDetect.js` 标记 WS 升级握手与 gRPC content-type；列表 WS/gRPC 徽章；详情协议说明
- **Gitee Pipeline**：`docs/gitee-pipeline-setup.md` 启用指南；`scripts/verify-ci-yml.js` 纳入 `npm run ci`

## 1.1.18

- **写交接卡 404 修复**：`pluginApiUrl` 优先从 script src 解析插件根路径；`detectPluginWebRootFromScripts` 移入 `index.html`
- 读取工作台：`GET /api/memory-bridge/status?handoff=1` 优先，fallback `GET /api/memory-bridge/handoff`
- 写入交接卡：`POST handover` / `POST handoff` 双 URL 重试

## 1.1.14

- 分享文档「版本历史」改为表格弹窗（替代 prompt），一键恢复

## 1.1.13

- **Postman Collection 导出**：`lib/postmanGenerator.js` + `POST /api/export-postman`；UI「导出 Postman」

## 1.1.8

- 通用设置「数据源」支持 **PostgreSQL** 落盘（与记录存储弹窗一致）

## 1.1.7

- **MemoryBridge 交接卡 UI**：分享区「写交接卡」；`GET/POST /api/memory-bridge/handoff|handover`
- `lib/memoryBridge.js` 新增 `buildHandoverText` / `addHandover` / `getHandoffWorkbench`

## 1.1.6

- **测试脚本入库规范**：`test/README.md` 用例索引；README 说明测试随 Git 推送
- 刷新 `test-results/unit-test-latest.txt`（含 k6 / pg / 基线 / 分享版本等用例）
- 通用设置「数据库连接」Tab；DB 连接管理入口合并到通用设置

## 1.1.5

- **分享文档版本历史**：保存内容变更时自动快照（最多 30 条）；API + 编辑页「版本历史」恢复

## 1.1.4

- **PostgreSQL 抓包落盘**：`lib/pgRecordStore.js`；存储设置可选 Postgres 连接
- `captureConfig.postgresConnectionId`；`POST /api/storage/test` 支持 Postgres

## 1.1.3

- **k6 脚本导出**：`lib/k6Generator.js` + `POST /api/export-k6`；UI「导出 k6」按钮
- 支持参数关联、ramping-vus 场景（threads/rampTime/loops）

## 1.1.2

- **压测基线固定**：`lib/stressBaseline.js` + `POST /api/stress/baseline`；报告页「设为基线」；对比自动选中
- 对比结果可下载 JSON；删除基线报告时自动解除
- README 补充 Gitee Go 流水线启用说明

## 1.1.1

- **参数关联预览 UX**：筛选/排序/批量开关、启用统计、无引用高亮、值预览

## 1.1.0

- **PostgreSQL SQL 预览**：`lib/pgStore.js` + `pg` 依赖；`db-ops/execute` 支持 postgres
- Postgres 连接可 `listDatabases`（`pg_database`）

## 1.0.99

- `bootstrap-ui.js`：捕获设置/刷新/导出/init 外置；`index.html` ~2930 行
- Gitee Pipeline 模板 `.gitee/pipelines/unit-test.yml`

## 1.0.98

- **Fix** `index.html` 脚本标签结构（压测 helper 归入 `stress-ui.js`）
- 新增 `npm run ci` 本地 CI 脚本

## 1.0.97

- 核心流量列表/详情 → `ui/records-core-ui.js`；`index.html` ~2300 行

## 1.0.96

- 后置操作 UI（提取/断言/DB）外置 `ui/postops-ui.js`
- Wiki ingest：architecture/plugin-modules.md

## 1.0.95

- 规则编辑 + 参数关联预览 UI 外置 `ui/rules-correlate-ui.js`

## 1.0.94

- 通用设置 UI 外置 `ui/general-settings-ui.js`

## 1.0.93

- 压测/报告 UI 外置为 `ui/stress-ui.js`（`GET /stress-ui.js`），`index.html` 再减 ~1200 行
- `README.en.md` 英文概要补全

## 1.0.92

- 分享文档 JS 外置为 `ui/share-ui.js`（`GET /share-ui.js`），`index.html` 减重 ~800 行

## 1.0.91

- 同步包 **流式 gzip 导出**（`exportSyncPackStream`）：逐篇写 JSON、逐媒体 base64，避免整包 `JSON.stringify` 峰值
- HTTP 导出直接 pipe stream，不再缓冲完整 body

## 1.0.90

- README 补全压测、分享文档、MemoryBridge、规则编辑说明
- 分享区 MemoryBridge 状态徽章（绿/橙）
- Wiki：`docs/wiki/project-overview.md`

## 1.0.89

- MemoryBridge CLI 自动回退 `python -m membridge`
- 同步包导出 fetch + 进度提示
- `npm run check:memory-bridge` 自检脚本

## 1.0.88

- 同步导出 gzip 异步化
- 前端同步导入改二进制上传
- MySQL 持久化失败内存回滚

## 1.0.87

- P1: `truncateUtf8`、SQLite 失败回滚
- P2: 原子 `saveMedia`、异步导出/锚点
- P3: 二进制 `.wjesync`、DOCX ZIP 加固、tag 硬化

## 1.0.80–1.0.86

- 压测 Webhook 格式、PDF 中文、`.wjesync` 同步、MemoryBridge 锚点、karpathy-llm-wiki、同步导入错误收集等
