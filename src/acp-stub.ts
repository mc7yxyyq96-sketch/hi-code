/**
 * ACP (Agent Client Protocol) stub — reserved interface for editor embeds (Wave2).
 * Not a full ACP server yet; exposes a stable shape for future wiring.
 */

export interface AcpInitializeParams {
  clientName?: string;
  clientVersion?: string;
  workspaceRoot?: string;
}

export interface AcpPromptParams {
  prompt: string;
  sessionId?: string;
  agentMode?: "build" | "plan" | "ask";
}

export interface AcpServer {
  initialize(params?: AcpInitializeParams): Promise<{ protocolVersion: string; serverName: string }>;
  prompt(params: AcpPromptParams): Promise<{ sessionId: string; status: "accepted" | "unsupported" }>;
  cancel(sessionId: string): Promise<{ ok: boolean }>;
}

/** Factory for the reserved ACP surface. Real streaming lands in a later wave. */
export function createAcpStub(): AcpServer {
  const sessions = new Set<string>();
  return {
    async initialize(params = {}) {
      return {
        protocolVersion: "0.1-stub",
        serverName: `hi-code-acp${params.clientName ? `/${params.clientName}` : ""}`,
      };
    },
    async prompt(params) {
      const sessionId = params.sessionId || `acp-${Date.now()}`;
      sessions.add(sessionId);
      return { sessionId, status: "unsupported" };
    },
    async cancel(sessionId) {
      sessions.delete(sessionId);
      return { ok: true };
    },
  };
}
