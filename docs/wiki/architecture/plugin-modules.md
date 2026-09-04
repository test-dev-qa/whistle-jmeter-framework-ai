# Plugin module architecture

Updated: 2026-09-02

## Summary

The plugin splits **capture** (`resStatsServer.js`) from **UI/API** (`ui/app.js`). Storage defaults to SQLite with a **10000** record cap; MySQL and JSON are optional fallbacks.

## UI split (1.0.97)

The monolithic `index.html` was reduced by extracting feature scripts:

- **index.html** — shared state, `escapeHtml` / `pluginApiUrl`, export bootstrap (~2300 lines HTML+JS)
- **records-core-ui.js** — traffic table, detail pane, virtual scroll
- **postops-ui.js** — extract / assert / DB post-ops modals
- **share-ui.js** — share docs, sync packs, MemoryBridge anchors
- **stress-ui.js** — stress run, reports, PDF
- **general-settings-ui.js** — settings modal tabs
- **rules-correlate-ui.js** — Whistle rules editor + JMX correlate preview

Each external script is served via `GET /<name>.js` from `ui/app.js`.

## Raw

- [2026-09-02 plugin architecture snapshot](../../raw/architecture/2026-09-02-plugin-architecture.md)
