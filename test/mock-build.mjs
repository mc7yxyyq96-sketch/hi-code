// Mock endpoint for the /build (manager + parallel) flow. Handles both the
// manager's non-streaming JSON decomposition and the streaming agents.
import http from "node:http";

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}
function streamText(res, base, text) {
  for (const c of text.match(/.{1,16}/gs) ?? [text])
    sse(res, { ...base, choices: [{ index: 0, delta: { content: c } }] });
  sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
}

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body || "{}");
      const sys = p.messages?.find((m) => m.role === "system")?.content ?? "";
      const lastUser = [...(p.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
      const hasToolResult = p.messages?.some((m) => m.role === "tool");
      const base = { id: "mock", object: "chat.completion.chunk", model: p.model ?? "mock" };

      // --- Manager decomposition (non-streaming JSON) ---
      if (/PROJECT MANAGER/.test(sys) || p.stream !== true) {
        const tasks = [
          { id: "t1", role: "coder", task: "create file a.txt with content A", deps: [] },
          { id: "t2", role: "coder", task: "create file b.txt with content B", deps: [] },
          { id: "t3", role: "reviewer", task: "review that a.txt and b.txt exist", deps: ["t1", "t2"] },
        ];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "mock",
            object: "chat.completion",
            model: p.model,
            choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(tasks) }, finish_reason: "stop" }],
          }),
        );
        return;
      }

      // --- Streaming agents ---
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });

      if (/REVIEWER/.test(sys)) {
        streamText(res, base, "APPROVED\nBoth files exist as required.");
      } else if (/CODER/.test(sys)) {
        const fname = (lastUser.match(/([a-z0-9_.-]+\.txt)/i) ?? [])[1];
        if (fname && !hasToolResult) {
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
                      function: { name: "write_file", arguments: JSON.stringify({ path: fname, content: `content of ${fname}\n` }) },
                    },
                  ],
                },
              },
            ],
          });
          sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
        } else {
          streamText(res, base, `Done — created ${fname ?? "the file"}.`);
        }
      } else {
        streamText(res, base, "ok");
      }
      sse(res, { ...base, usage: { prompt_tokens: 40, completion_tokens: 8 } });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  })
  .listen(7802, () => console.log("mock build server on http://127.0.0.1:7802/v1"));
