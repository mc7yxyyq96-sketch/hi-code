# OpenAI Responses Adapter

Status: Implemented in HC-PROV-211

## Purpose

Hi Code can use the OpenAI Responses wire protocol through the shared Model Provider Adapter v2 boundary. The adapter is a real production transport: it performs HTTPS requests, decodes server-sent events, participates in the existing Runtime tool loop, and emits the same provider-neutral events used by Electron, CLI, TUI, replay, and Job Center projections.

The existing OpenAI-compatible Chat Completions transport remains the compatibility default. Hi Code never guesses a protocol from a hostname or model name.

## Configuration

Select Responses explicitly on one model profile:

```json
{
  "defaultProfile": "openai",
  "profiles": {
    "openai": {
      "name": "openai",
      "baseURL": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "model": "gpt-4.1",
      "contextWindow": 128000,
      "temperature": 0.2,
      "protocol": "responses"
    }
  }
}
```

Supported values are:

- `chat_completions`: existing compatibility transport and default when omitted.
- `responses`: OpenAI Responses request and event contracts.

The setting can be entered in the existing Advanced JSON editor. Quick-form saves and connection tests preserve an existing explicit protocol. Unknown values are rejected before the config is written.

## Request Mapping

The adapter maps Hi Code model messages into Responses input items:

| Hi Code input | Responses input |
| --- | --- |
| system or user text | message with `input_text` |
| assistant text | message with `output_text` |
| user image data URL | `input_image` |
| assistant tool call | `function_call` with its original `call_id` |
| tool result | `function_call_output` with the same `call_id` |
| function tool schema | flat Responses function tool |

Every request sets `store: false`. Provider-hosted background execution, hosted files, remote tools, and computer use are outside this adapter boundary.

## Streaming And Tool Correlation

The SSE decoder accepts text deltas, function-call item creation, argument deltas, final arguments, completed output items, usage, completion, incomplete responses, and failures.

`item_id` identifies the streamed output item. `call_id` identifies the logical function call and is preserved when Runtime sends the tool result on the next model request. The adapter rejects an argument delta for an item that was not announced and emits each completed tool call exactly once.

Runtime continues to own actual tool execution and permission requests. Provider tool construction is recorded as hidden provider events; it does not bypass the existing tool registry, workspace checks, or approval policy.

## Terminal States And Usage

- `response.completed` produces one successful provider terminal event.
- caller cancellation produces interruption and never a false completion.
- `response.incomplete` fails with a normalized context-length or provider category.
- `response.failed` and stream errors produce a redacted normalized failure.
- a stream that closes without a terminal event is rejected.

Input, output, total, cached-input, and reasoning token counts are normalized without changing their meaning and flow into Runtime Protocol usage events.

## Security Boundary

- Remote endpoints must use HTTPS. Plain HTTP is accepted only for loopback development fixtures.
- URLs containing embedded credentials, query parameters, or fragments are rejected.
- API keys are used only in the Authorization request header.
- Provider descriptors, events, errors, Runtime Protocol records, and task evidence do not contain credentials.
- Error codes are bounded to a safe character set before persistence.
- Retry is limited to rate limits, upstream server failures, and transient network failures.

## Compatibility And Rollback

Existing profiles have no `protocol` field and continue to call `/chat/completions`. HC-PROV-211 does not rewrite config, sessions, jobs, project data, or runtime stores. To roll one profile back, remove its protocol field or set it to `chat_completions`.

The Electron connection test follows the same explicit selection and calls `/responses` only for a Responses profile.

## Verification

```bash
npm run build
npm run test:openai-responses
npm run test:model-providers
npm run test:runtime-protocol
npm run test:services
npm run test:renderer
npm run verify
```

The focused suite uses a real loopback HTTP/SSE server and covers image input, prior tool context, a two-request Runtime tool loop, usage, cancellation, incomplete and failed terminal states, event ordering, endpoint security, credential redaction, and unchanged Chat Completions routing.

## References

- [OpenAI Responses API reference](https://platform.openai.com/docs/api-reference/responses)
- [OpenAI Responses streaming events](https://platform.openai.com/docs/api-reference/responses-streaming)
