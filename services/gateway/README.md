# Hi Code Gateway (Wave3)

Clean-room OpenClaw/Hermes-inspired local gateway.

## Run

```bash
node services/gateway/server.mjs --port 8787 --token dev-token
# or from desktop: Gateway nav → 启动本地 Gateway
```

## Endpoints

| Path | Auth | Purpose |
|---|---|---|
| `GET /health` | no | liveness |
| `GET /v1/status` | Bearer | full status |
| `GET /v1/control` | Bearer | control UI payload |
| `GET/POST /v1/sessions` | Bearer | session list/create |
| `GET /v1/channels` | Bearer | telegram/discord/desktop adapters |
| `POST /v1/channels/configure` | Bearer | enable bot tokens (memory only) |
| `POST /v1/channels/inbound` | Bearer | route inbound IM/desktop messages |
| `GET/POST /v1/webhooks` | Bearer | webhook registry |
| `GET /v1/relay/health` | Bearer | NewAPI/Model Gateway posture (no client master keys) |

## Desktop

Electron IPC: `gateway:start|stop|status|connect-remote`  
UI: sidebar **Gateway**

## Realtime

- `WS /v1/ws?token=…` — authenticated desktop/remote stream (`hello`, `ping/pong`, `inbound`, `channel.inbound`)
- Telegram long-poll: configure bot token via `POST /v1/channels/configure` then auto-starts poller

## Status

- Local process + session router + channel stubs: **shipped**
- Authenticated WebSocket: **shipped**
- Telegram long-poll: **shipped** (requires real bot token)
- Discord live bot: next increment
