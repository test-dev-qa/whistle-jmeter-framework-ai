# MemoryBridge 交接约定（本项目）

Updated: 2026-09-02

## 目的

长任务 / 跨会话时，用 MemoryBridge 的 `kind=handover` 交接卡做**状态声明**，避免只靠聊天压缩丢上下文。

本机 MCP：`memory-bridge`（`python -m membridge mcp`，库 `~/.membridge/memory.db`，设备 `zgq-PC`）。

## 五行正文（原文冻结）

```text
goal: <本轮要达成什么>
done: <已完成的可验证结果>
failed: <试过什么；因为什么失败；除非什么改变否则别重试>
next: <下一棒具体动作>
refs: <路径 / issue / 命令 / 文档锚点>
```

写入示例：

```bash
membridge add "goal: ...
done: ...
failed: ...
next: ...
refs: ..." --kind handover --tags whistle
```

或在 Cursor 里调用 MCP `memory_add`，`kind=handover`。

## Agent 习惯（软约束）

1. **开工**：先看工作台（`membridge handoff` / MCP search `as_context`），再动手。
2. **收工 / 切设备 / 上下文将满**：写一张新 handover（新卡自动取代旧卡）。
3. **踩坑沉淀**：另存 `--kind procedure`，不要塞进 handover 当百科。
4. **长期知识**：重要结论 ingest 到 `docs/raw` → 编译 `docs/wiki`（karpathy-llm-wiki）；MemoryBridge 不替代 wiki。

## 与本仓库分工

| 层 | 位置 | 职责 |
|----|------|------|
| 分享文档 | `docs/files` + sync pack | 可读产物跨节点搬运 |
| LLM Wiki | `docs/raw` + `docs/wiki` | 可引用、可 lint 的知识 |
| MemoryBridge | `~/.membridge/memory.db` | 跨会话热记忆 + handover 工作台 |

## 分享文档 → 记忆锚点

- UI「记忆锚点」或 `POST /api/share/docs/:id/memory-anchor`
- 导出同步包勾选「导出时写记忆锚点」→ `GET /api/share/sync/export?memoryAnchors=1`

均只写标题/slug/路径/摘要指针，**不改写**分享正文。

## 云盘通道（本机）

已配置 OneDrive：`C:\Users\zgq\OneDrive\membridge`（通道 ID `mb-20cf24c6`）。其他设备对同一文件夹执行 `membridge init` 即可认领。
