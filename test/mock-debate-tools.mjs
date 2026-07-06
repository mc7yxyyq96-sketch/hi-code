// Mock for tool-equipped /debate. Debaters stream (agent loop); one of them
// calls a read-only tool (grep) to ground its argument before answering.
// The moderator/synthesizer uses the non-streaming path.
import http from "node:http";

function sse(res, base, obj) {
  res.write(`data: ${JSON.stringify({ ...base, ...obj })}\n\n`);
}
function streamText(res, base, text) {
  for (const c of text.match(/.{1,16}/gs) ?? [text]) sse(res, base, { choices: [{ index: 0, delta: { content: c } }] });
  sse(res, base, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
}

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body || "{}");
      const sys = p.messages?.find((m) => m.role === "system")?.content ?? "";
      const hasToolResult = p.messages?.some((m) => m.role === "tool");
      const model = p.model ?? "mock";
      const base = { id: "mock", object: "chat.completion.chunk", model };

      // Moderator verdict (non-streaming).
      if (p.stream !== true || /moderator of a model debate/i.test(sys)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "mock",
            object: "chat.completion",
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Verdict: runDebate IS implemented in src/agents/council.ts — confirmed by grep." },
                finish_reason: "stop",
              },
            ],
          }),
        );
        return;
      }

      // Streaming debater turn.
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });

      if (model === "smart-model" && !hasToolResult) {
        // Ground the argument: grep the real codebase first.
        sse(res, base, {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_g",
                    type: "function",
                    function: { name: "grep", arguments: JSON.stringify({ pattern: "runDebate", path: "src" }) },
                  },
                ],
              },
            },
          ],
        });
        sse(res, base, { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else if (model === "smart-model") {
        streamText(res, base, "I grepped src/ and found runDebate defined in council.ts — so yes, it exists.");
      } else {
        streamText(res, base, "I think it might not exist, but I haven't checked the code.");
      }
      sse(res, base, { usage: { prompt_tokens: 30, completion_tokens: 8 } });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  })
  .listen(7804, () => console.log("mock tool-debate server on http://127.0.0.1:7804/v1"));
