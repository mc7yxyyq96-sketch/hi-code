// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0) for testing.
// Exposes one tool: echo(text) -> "echo: <text>".
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mock-mcp", version: "1.0" } } });
  } else if (msg.method === "notifications/initialized") {
    // no reply
  } else if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo back the provided text",
            inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          },
          {
            name: "env",
            description: "Return selected environment variable visibility for safety tests",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
      },
    });
  } else if (msg.method === "tools/call") {
    const name = msg.params?.name;
    if (name === "env") {
      const visible = {
        explicit: process.env.MCP_TEST_TOKEN || "",
        openai: Boolean(process.env.OPENAI_API_KEY),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        github: Boolean(process.env.GITHUB_TOKEN),
      };
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(visible) }] } });
    } else {
      const text = msg.params?.arguments?.text ?? "";
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `echo: ${text}` }] } });
    }
  } else if (typeof msg.id === "number") {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
});
