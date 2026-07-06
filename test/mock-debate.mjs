// Mock endpoint for /debate. All calls go through the non-streaming path.
import http from "node:http";

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body || "{}");
      const sys = p.messages?.find((m) => m.role === "system")?.content ?? "";
      const model = p.model ?? "mock";

      let answer;
      if (/moderator of a model debate/i.test(sys)) {
        answer = "Verdict: the list should be reversed in O(n) with two pointers; both models converged on this.";
      } else if (/debating other models/i.test(sys)) {
        // Round 2+: each model revises, converging.
        answer =
          model === "fast-model"
            ? "On reflection, two-pointer reversal in O(n) is correct — I agree with the other model."
            : "Maintaining: two-pointer reversal, O(n) time, O(1) space.";
      } else {
        // Round 1: initial, slightly different answers.
        answer =
          model === "fast-model"
            ? "Use recursion to reverse it."
            : "Reverse in place with two pointers, O(n) time and O(1) space.";
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "mock",
          object: "chat.completion",
          model,
          choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
        }),
      );
    });
  })
  .listen(7803, () => console.log("mock debate server on http://127.0.0.1:7803/v1"));
