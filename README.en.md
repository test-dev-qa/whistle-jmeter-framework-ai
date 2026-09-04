# whistle.jmeter-exporter

Whistle proxy plugin: capture HTTP/HTTPS traffic, inspect requests in a web UI, and export **JMeter `.jmx`** or **CSV** for load-test drafts.

## Features

| Area | Capabilities |
|------|----------------|
| Capture | Live traffic; static asset filter; SQLite / MySQL / JSON storage (10k cap) |
| Export | JMX / CSV; token/ID correlation; extractors, assertions, JDBC post-processors |
| Stress test | Built-in HTTP load test; reports, PDF, threshold webhooks (Feishu/lark/json) |
| Share docs | Markdown/HTML docs; `.wjesync` sync packs; MemoryBridge anchors |
| Agent | MemoryBridge handover cards; `npm run check:memory-bridge` |

## Requirements

- **Node.js >= 22.5.0** (uses built-in `node:sqlite`)
- [Whistle](https://wproxy.org/whistle/) proxy

## Quick start

```bash
npm install
npm run deploy   # pack + install into Whistle
```

Open Whistle plugin page → **Ctrl+F5** refresh.

## Docs

- [README.md](README.md) (Chinese, full detail)
- [CHANGELOG.md](CHANGELOG.md)
- [docs/wiki/project-overview.md](docs/wiki/project-overview.md)

## License

ISC
