import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpServerConfig } from "./config.js";
import type { ToolSchema } from "./llm.js";
import {
  createExecutionLaunchPlan,
  detectExecutionCapabilities,
  evaluateExecutionPolicy,
  terminateExecutionProcessTree,
  type ExecutionPolicyAudit,
} from "./execution-policy.js";

const PROTOCOL_VERSION = "2024-11-05";
const MAX_MCP_STREAM_BYTES = 1024 * 1024;

interface McpTool {
  name: string; // namespaced: mcp__<server>__<tool>
  rawName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  client: McpClient;
}

/** A single stdio MCP server connection, speaking newline-delimited JSON-RPC 2.0. */
class McpClient {
  readonly name: string;
  private proc?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buf = "";
  private stderrBuf = "";
  private policyAudit?: ExecutionPolicyAudit;
  private policyWarnings: string[] = [];
  tools: McpTool[] = [];

  constructor(name: string, private cfg: McpServerConfig) {
    this.name = name;
  }

  async connect(timeoutMs = 15000): Promise<void> {
    const cwd = process.cwd();
    const capabilities = detectExecutionCapabilities();
    const decision = evaluateExecutionPolicy({
      id: `mcp:${safeId(this.name)}`,
      surface: "mcp-server",
      executable: this.cfg.command,
      args: this.cfg.args ?? [],
      cwd,
      allowedRoots: [cwd],
      filesystem: "unrestricted",
      network: "allow",
      environment: { extraEnv: this.cfg.env, allowSensitiveExtraEnv: true },
      limits: { timeoutMs: 0, outputBytes: MAX_MCP_STREAM_BYTES },
      approval: { required: false, granted: true },
      processTree: { required: true },
      interactive: true,
      enforcementMode: "report-only",
    }, capabilities);
    if (!decision.ok) throw new Error(`MCP execution policy denied startup: ${decision.error || decision.code}`);
    const plan = createExecutionLaunchPlan(decision, capabilities);
    this.policyAudit = decision.audit;
    this.policyWarnings = [...decision.warnings];
    this.proc = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      detached: plan.detached,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.on("data", (d: Buffer) => this.onData(d));
    this.proc.stderr.on("data", (d: Buffer) => {
      this.stderrBuf = boundedTail(this.stderrBuf + d.toString(), MAX_MCP_STREAM_BYTES);
    });
    this.proc.on("error", (e) => this.failAll(e));
    this.proc.on("exit", () => this.failAll(new Error(`mcp server '${this.name}' exited`)));

    const withTimeout = <T>(p: Promise<T>) =>
      Promise.race<T>([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
      ]);

    await withTimeout(
      this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "vibe", version: "0.1.0" },
      }),
    );
    this.notify("notifications/initialized");

    const listed: any = await withTimeout(this.request("tools/list", {}));
    this.tools = (listed?.tools ?? []).map((t: any) => ({
      name: `mcp__${this.name}__${t.name}`,
      rawName: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      client: this,
    }));
  }

  async call(rawName: string, args: Record<string, unknown>): Promise<string> {
    const res: any = await this.request("tools/call", { name: rawName, arguments: args });
    const parts = Array.isArray(res?.content) ? res.content : [];
    const text = parts
      .map((c: any) => (c?.type === "text" ? c.text : c?.type ? `[${c.type}]` : ""))
      .join("\n")
      .trim();
    if (res?.isError) return `Error from MCP tool: ${text || "(no detail)"}`;
    return text || "(no output)";
  }

  close(): void {
    const pid = this.proc?.pid;
    if (pid) terminateExecutionProcessTree({ pid });
    this.proc = undefined;
  }

  executionBoundary(): { audit?: ExecutionPolicyAudit; warnings: string[] } {
    return {
      ...(this.policyAudit ? { audit: { ...this.policyAudit, envKeys: [...this.policyAudit.envKeys] } } : {}),
      warnings: [...this.policyWarnings],
    };
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin.write(payload);
    });
  }

  private notify(method: string): void {
    this.proc?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  }

  private onData(d: Buffer): void {
    this.buf += d.toString();
    if (Buffer.byteLength(this.buf) > MAX_MCP_STREAM_BYTES) {
      this.failAll(new Error("MCP server output exceeded the bounded protocol buffer"));
      this.close();
      return;
    }
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error?.message ?? "mcp error"));
        else p.resolve(msg.result);
      }
    }
  }

  private failAll(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }
}

// ---- module-level registry ----
const clients: McpClient[] = [];
const toolIndex = new Map<string, McpTool>();

export interface McpConnectResult {
  server: string;
  ok: boolean;
  toolCount: number;
  error?: string;
  executionPolicy?: { audit?: ExecutionPolicyAudit; warnings: string[] };
}

/** Connect to all configured MCP servers; returns a per-server status report. */
export async function initMcp(servers: Record<string, McpServerConfig>): Promise<McpConnectResult[]> {
  const results: McpConnectResult[] = [];
  for (const [name, cfg] of Object.entries(servers)) {
    const client = new McpClient(name, cfg);
    try {
      await client.connect();
      clients.push(client);
      for (const t of client.tools) toolIndex.set(t.name, t);
      results.push({ server: name, ok: true, toolCount: client.tools.length, executionPolicy: client.executionBoundary() });
    } catch (e) {
      client.close();
      results.push({ server: name, ok: false, toolCount: 0, error: (e as Error).message });
    }
  }
  return results;
}

/** MCP tools as OpenAI tool schemas, to merge into the agent's toolset. */
export function mcpToolSchemas(): ToolSchema[] {
  return [...toolIndex.values()].map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: `[MCP:${t.client.name}] ${t.description}`,
      parameters: t.inputSchema,
    },
  }));
}

export function isMcpTool(name: string): boolean {
  return toolIndex.has(name);
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const t = toolIndex.get(name);
  if (!t) return `Error: unknown MCP tool '${name}'`;
  try {
    return await t.client.call(t.rawName, args);
  } catch (e) {
    return `Error calling MCP tool '${name}': ${(e as Error).message}`;
  }
}

export function mcpStatus(): { server: string; tools: string[] }[] {
  return clients.map((c) => ({ server: c.name, tools: c.tools.map((t) => t.rawName) }));
}

function safeId(value: string): string {
  return String(value || "server").replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 120) || "server";
}

function boundedTail(value: string, limit: number): string {
  const buffer = Buffer.from(value);
  return (buffer.length <= limit ? buffer : buffer.subarray(buffer.length - limit)).toString("utf8");
}

export function shutdownMcp(): void {
  for (const c of clients) c.close();
}
