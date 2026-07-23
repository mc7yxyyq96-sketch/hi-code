# PARITY Wave1 UI — Skills / MCP / Automation

## Shipped

- **Skills market page**: search filter, store entry, clearer copy (`C-01`)
- **MCP manage page**: search filter, store entry, configure MCP JSON (`C-02`)
- **Automation page**: persistent schedules in `~/.hicode/automations.json`, create/enable/pause/delete/run-now (`C-03`)
- **Composer pills**: workspace + thinking/reasoning cycle alongside model pill
- **Nav**: pinned 自动化 entry + home card

## Tests

- `node test/automation-service-tests.mjs`
- `node test/renderer-architecture-tests.mjs` (159+)
- `node test/parity-tool-union-tests.mjs`

## Notes

- Clean-room implementation; no Yan asar/assets copied.
- Scheduler persistence + due detection are in place; background ticker can land with Wave3 Gateway timers.
