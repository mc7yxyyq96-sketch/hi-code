# Anthropic Messages And Ollama Native Adapters

Status: Implemented in HC-PROV-212

## Selection

The transport is explicit in each model profile. Existing profiles with no selector remain on Chat Completions.

```json
{
  "profiles": {
    "anthropic": {
      "name": "anthropic",
      "baseURL": "https://api.anthropic.com/v1",
      "model": "claude-sonnet-5",
      "contextWindow": 1000000,
      "temperature": 0.2,
      "protocol": "anthropic_messages"
    },
    "ollama": {
      "name": "ollama",
      "baseURL": "http://127.0.0.1:11434",
      "model": "qwen3",
      "contextWindow": 32768,
      "temperature": 0.2,
      "protocol": "ollama_chat"
    }
  },
  "defaultProfile": "anthropic"
}
```

The desktop Model API form stores the Anthropic credential in operating-system
secure storage and persists only a `secretRef`. CLI users can supply it without
editing JSON:

```bash
export HICODE_PROFILE_ANTHROPIC_API_KEY='...'
hicode
```

Loopback Ollama requires no key. Hi Code supplies its internal no-key sentinel
at runtime and does not persist or transmit it as authorization.

The desktop settings page has native Anthropic and Ollama presets. Advanced JSON remains available for gateways and custom model IDs. Saving another existing profile does not silently change its protocol.

## Anthropic Messages

The adapter calls `/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, and JSON content type. System instructions use the top-level `system` field. User images become Anthropic base64 or HTTPS URL source blocks. Assistant calls and local results preserve the same `tool_use.id` through the Runtime tool loop.

Named SSE events are normalized as follows:

| Anthropic event | Hi Code event |
| --- | --- |
| `content_block_delta` / `text_delta` | `text.delta` |
| `content_block_start` / `tool_use` | `tool.call.started` |
| `input_json_delta` | `tool.call.delta` |
| `content_block_stop` | validated `tool.call.completed` |
| `message_start` + `message_delta` usage | `usage.updated` |
| `message_stop` | provider completion |
| stream `error` | normalized provider failure |

Modern Anthropic models may reject non-default sampling parameters. The adapter therefore does not send profile `temperature`; the stored field remains intact for other protocols. `max_tokens` is always present because Messages requires it.

## Ollama Native Chat

The adapter calls `/api/chat`. A base URL ending in `/api` or `/api/chat` is normalized without duplication. Loopback HTTP is allowed; a remote endpoint must use HTTPS. A placeholder local key is never sent as an authorization header.

OpenAI-style image data URLs are reduced to their base64 payload for Ollama `images`. Assistant function calls keep the native function shape. Because the documented Ollama response does not provide a stable tool-call ID, Hi Code creates a deterministic run-local ID. When a tool result is sent back, that ID is resolved against the prior assistant call and converted to Ollama `tool_name`.

Ollama streams newline-delimited JSON. The adapter requires a terminal record with `done: true`, maps `prompt_eval_count` and `eval_count` to normalized usage, and rejects an error record or a stream that closes without a terminal record.

## Reasoning Boundary

`reasoning.summary` is a typed Provider Adapter capability and is currently `unsupported` for both adapters. This is deliberate:

- Anthropic `thinking_delta` can be raw thinking or an explicitly requested provider summary, but Hi Code does not yet have a versioned summary event and persistence policy.
- Ollama `message.thinking` is a raw reasoning trace, not a summary.
- Ollama requests send `think: false`.
- Any unexpected thinking field is discarded and never added to assistant text, provider events, Runtime Protocol, sessions, jobs, logs, or evidence.

A future summary implementation must add a separately reviewed typed event. It must never expose hidden chain-of-thought by changing a label.

## Security And Failure Semantics

- Remote provider endpoints require HTTPS. Only loopback hosts may use HTTP.
- Base URLs cannot contain credentials, query parameters, or fragments.
- Remote Anthropic image URLs require credential-free HTTPS.
- JSON responses are limited to 8 MiB; streamed responses are limited to 32 MiB with a 2 MiB frame buffer.
- Authentication material is absent from descriptors and is redacted by normalized error handling.
- Caller cancellation returns `interrupted`; it never emits a false completion.
- Tool deltas without an announced tool block, duplicate terminal states, and missing stream terminals fail closed.

## Verification

Run:

```bash
npm run build
npm run test:anthropic-ollama
npm run test:model-providers
npm run test:openai-responses
npm run test:services
npm run test:renderer
npm run test:security
```

`test/anthropic-ollama-provider-tests.mjs` uses real loopback HTTP, Anthropic SSE, and Ollama NDJSON fixtures. It completes a two-request Runtime tool loop for each provider and covers images, usage, interruption, malformed sequences, error redaction, endpoint security, and legacy routing.

## Current Limits

- No provider-hosted file/PDF lifecycle.
- No structured-output negotiation.
- No persisted or displayed reasoning summaries.
- No Ollama model discovery or automatic pull.
- No external Claude Code or Codex process execution; those are Agent Provider responsibilities.

Official wire references:

- <https://platform.claude.com/docs/en/api/messages>
- <https://platform.claude.com/docs/en/build-with-claude/streaming>
- <https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview>
- <https://docs.ollama.com/api/chat>
- <https://docs.ollama.com/api/streaming>
- <https://docs.ollama.com/capabilities/tool-calling>
