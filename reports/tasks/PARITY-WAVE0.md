# PARITY-WAVE0 — Chat-first shell + inline run narrative

Status: Implemented (initial)

Branch: `cursor/parity-superset`

Date: 2026-07-23

## Delivered

- `planning/parity-backlog.json` — full superset backlog across Waves 0–4
- `renderer/app/assistant-turn.js` — AssistantTurn model + Runtime event projection
- `renderer/components/chat-process.js` — in-message thinking / tool / change-summary rendering
- `renderer/parity-theme.css` — original dark chat-first theme
- `renderer/index.html` — Skills/MCP primary nav; industrial/store/arena demoted to advanced
- `renderer/app/bootstrap.js` — live turns painted from output + tool events; theme/panels/advanced toggles
- `test/assistant-turn-tests.mjs` — projection pipeline coverage

## Acceptance notes

- Default chrome is chat-first (no permanent timeline/diff columns)
- Process side panels available via「过程旁栏」
- Advanced industrial/store surfaces available via「高级」
- Clean-room: no Yan Agent source/assets copied

## Follow-ups (Wave1+)

- Persist AssistantTurn trees into session store for full history rebuild
- Composer pills (workspace/model/thinking)
- Tool union, terminal/browser/code-map, Skills/MCP pages depth, Gateway
