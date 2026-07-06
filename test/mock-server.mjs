// Minimal mock of an OpenAI-compatible streaming endpoint, used to prove
// the agent loop, streaming, tool-calls and diff preview work end-to-end.
import http from "node:http";

let turn = 0;

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    turn++;
    const id = "chatcmpl-mock";
    const base = { id, object: "chat.completion.chunk", model: "mock" };

    if (turn === 1) {
      // First turn: stream a bit of text, then a tool call to write a file.
      sse(res, { ...base, choices: [{ index: 0, delta: { content: "Creating the file now.\n" } }] });
      sse(res, {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "write_file", arguments: "" },
                },
              ],
            },
          },
        ],
      });
      const args = JSON.stringify({ path: "hello.txt", content: "hello from vibe\nline two\n" });
      // stream the JSON arguments in two chunks to test accumulation
      sse(res, {
        ...base,
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 20) } }] } }],
      });
      sse(res, {
        ...base,
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(20) } }] } }],
      });
      sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      sse(res, { ...base, usage: { prompt_tokens: 100, completion_tokens: 20 } });
    } else {
      // Second turn: final answer, no tool calls.
      for (const t of ["Done — ", "I created ", "hello.txt ", "for you."]) {
        sse(res, { ...base, choices: [{ index: 0, delta: { content: t } }] });
      }
      sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      sse(res, { ...base, usage: { prompt_tokens: 130, completion_tokens: 8 } });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

server.listen(7799, () => console.log("mock OpenAI server on http://127.0.0.1:7799/v1"));
