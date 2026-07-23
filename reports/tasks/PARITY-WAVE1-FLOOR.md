# PARITY Wave1 Floor — Browser / Code Map / Memory / Compact

## Shipped

- **D-02 Browser**: BrowserView panel + URL chrome, bounds sync, toolbar toggle
- **D-03 Code Map**: workspace tree + symbol index page
- **D-04 Memory**: per-workspace notes under `~/.hicode/memory/` + rollback pending diffs
- **B-07 Compact**: in-message compact/compacted narrative + `/compact` visible path; interrupt footer already present

## Tests

- `node test/codemap-memory-tests.mjs`
- `node test/assistant-turn-tests.mjs`
- `node test/renderer-architecture-tests.mjs` (161+)

## Wave1 status

Yan floor primary surfaces for terminal/skills/mcp/automation/browser/codemap/memory/tool-union are in place. Residual polish can continue in Wave2 alongside Build/Plan modes.
