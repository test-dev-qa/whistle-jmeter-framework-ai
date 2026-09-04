# 项目总览

Updated: 2026-09-02

## 是什么

`whistle.jmeter-exporter` 是 Whistle 代理插件：抓 HTTP/HTTPS 流量 → 可视化 → 导出 JMeter/CSV，并扩展压测、分享文档、MemoryBridge 协作。

## 五大模块

| 模块 | 入口 | 说明 |
|------|------|------|
| 流量捕获 | `resStatsServer.js` | SQLite/MySQL/JSON，最多 1 万条 |
| JMeter 导出 | UI 导出区 + `lib/jmxGenerator.js` | 关联、提取器、断言、JDBC |
| 内置压测 | UI 压力测试 | Node HTTP，报告 + Webhook |
| 分享文档 | UI 分享文档 + `docs/` | `.wjesync` 同步、记忆锚点 |
| Agent | `AGENTS.md` + MemoryBridge | handover 五行卡 |

## 常用命令

```bash
npm test                      # 单元测试
npm run deploy                # pack + 安装到 Whistle
npm run check:memory-bridge   # MemoryBridge 连通
python -m membridge handoff   # 查看工作台
```

## 相关文档

- [MemoryBridge 交接约定](memory/handover-convention.md)
- 仓库根 `README.md`、`CHANGELOG.md`
