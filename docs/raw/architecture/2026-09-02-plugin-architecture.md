# Plugin architecture snapshot

- Source: repository README.md, lib/, ui/ (2026-09-02)
- Collected: 2026-09-02
- Published: 2026-09-02

## Entry points

- `index.js` exports `uiServer` (`ui/app.js`) and `resStatsServer` (`resStatsServer.js`).
- Whistle iframe loads plugin HTML; capture traffic via `resStatsServer`.

## Storage

- Default: SQLite `data/records.sqlite`, max **10000** records.
- Optional MySQL table `wje_records`.
- Fallback JSON `data/records.json`.
- Post-ops in `data/postOps.sqlite` (+ MySQL sync when capture uses MySQL).

## UI modules (1.0.95)

| File | Responsibility |
|------|----------------|
| `index.html` | Core record list, detail, export |
| `share-ui.js` | Share docs + `.wjesync` |
| `stress-ui.js` | Built-in HTTP stress test + reports |
| `general-settings-ui.js` | Project/env/notify/datasource tabs |
| `rules-correlate-ui.js` | Whistle rules + correlate preview |

## Version

- Package `whistle.jmeter-exporter` **1.0.95**
- Node **>= 22.5.0**
