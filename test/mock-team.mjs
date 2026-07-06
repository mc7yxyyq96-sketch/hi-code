// Role-aware mock OpenAI endpoint to prove the multi-agent team pipeline.
// It inspects the system prompt to decide which teammate is calling, and
// responds appropriately (architect plans, coder writes a file, reviewer approves).
import http from "node:http";

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}
function streamText(res, base, text) {
  for (const chunk of text.match(/.{1,12}/gs) ?? [text]) {
    sse(res, { ...base, choices: [{ index: 0, delta: { content: chunk } }] });
  }
  sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const sys = payload.messages?.find((m) => m.role === "system")?.content ?? "";
    const hasToolResult = payload.messages?.some((m) => m.role === "tool");

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const base = { id: "mock", object: "chat.completion.chunk", model: "mock" };

    if (/ARCHITECT/.test(sys)) {
      streamText(res, base, "Plan:\n1. Create greeting.txt with a hello message.\n2. Verify it exists.");
    } else if (/REVIEWER/.test(sys)) {
      streamText(res, base, "APPROVED\nThe file was created correctly and matches the goal.");
    } else if (/CODER/.test(sys)) {
      if (!hasToolResult) {
        // First coder turn: call write_file.
        sse(res, {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_w",
                    type: "function",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({ path: "greeting.txt", content: "Hello from the AI team!\n" }),
                    },
                  },
                ],
              },
            },
          ],
        });
        sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else {
        streamText(res, base, "Done. Changed: greeting.txt — added a hello message.");
      }
    } else {
      streamText(res, base, "ok");
    }
    sse(res, { ...base, usage: { prompt_tokens: 50, completion_tokens: 10 } });
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

server.listen(7800, () => console.log("mock team server on http://127.0.0.1:7800/v1"));
