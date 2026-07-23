# PARITY Follow-up (post Wave4)

## Shipped in 0.7.0-parity.2

- **Durable AssistantTurn narratives**: `appendSessionNarrative` / `session:save-narrative`; history rebuild prefers `narratives[]`
- **Gateway WebSocket**: authenticated `WS /v1/ws`
- **Telegram long-poll**: starts after channel configure with bot token
- **Packaging**: `services/gateway/**` included in electron-builder files

## Tests

- `node test/session-narrative-tests.mjs`
- `node test/gateway-tests.mjs`
- renderer architecture 164+
