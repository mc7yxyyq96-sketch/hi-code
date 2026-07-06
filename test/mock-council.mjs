// Mock endpoint that answers differently per model name, and recognizes the
// synthesizer call — to prove the /council ensemble fusion path.
import http from "node:http";

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body || "{}");
      const sys = p.messages?.find((m) => m.role === "system")?.content ?? "";
      const model = p.model ?? "unknown";

      let answer;
      if (/SYNTHESIZER/.test(sys)) {
        answer = "Synthesis: 2 + 2 = 4. Both members agree; no correction needed.";
      } else if (model === "fast-model") {
        answer = "4";
      } else if (model === "smart-model") {
        answer = "2 + 2 equals 4, a basic arithmetic sum.";
      } else {
        answer = `(${model}) 4`;
      }

      // Council uses the non-streaming /complete path → respond as a normal JSON body.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "mock",
          object: "chat.completion",
          model,
          choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 8 },
        }),
      );
    });
  })
  .listen(7801, () => console.log("mock council server on http://127.0.0.1:7801/v1"));
