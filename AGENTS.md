# Agent notes

## MemoryBridge handover

开工先看工作台（MemoryBridge MCP / `membridge handoff`）；收工、切设备或上下文将满时写 `kind=handover` 五行卡：`goal:/done:/failed:/next:/refs:`。
约定详见 [docs/wiki/memory/handover-convention.md](docs/wiki/memory/handover-convention.md)。

把下面这一段，粘贴进你 AI 助手的常驻指令文件即可：
（Claude Code → CLAUDE.md；Codex / 通用 → AGENTS.md；Cursor → 规则文件）

任务告一段落、当前上下文将满、或即将切换设备前，把这一阶段写成一张交接卡：membridge add "goal:…
done:…
failed:…
next:…
refs:…" --kind handover。failed 行用硬句式：试过什么；因为什么失败；除非什么改变否则别重试。新卡自动取代旧卡；新会话开始时先读注入块中的【工作台】，再决定要不要检索旧账。

