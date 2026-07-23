/**
 * OpenCode-style agent profiles: Build / Plan / Ask (clean-room Wave2).
 * Each mode carries a permission matrix over mutating tools.
 */

export type AgentMode = "build" | "plan" | "ask";

export const AGENT_MODES: AgentMode[] = ["build", "plan", "ask"];

export interface AgentModeProfile {
  id: AgentMode;
  label: string;
  summary: string;
  /** Mutating tools that are auto-allowed without a prompt. */
  autoAllowTools: string[];
  /** Mutating tools that are hard-denied (plan/ask). */
  denyTools: string[];
  systemGuidance: string;
}

const MUTATING_FILE_TOOLS = ["write_file", "edit_file", "apply_patch"];
const MUTATING_SHELL_TOOLS = ["bash", "execute_shell", "git_commit", "git_push", "git_pull", "git_clone"];

export const AGENT_MODE_PROFILES: Record<AgentMode, AgentModeProfile> = {
  build: {
    id: "build",
    label: "Build",
    summary: "实现改动：自动允许文件编辑，命令仍需确认（除非 YOLO）。",
    autoAllowTools: [...MUTATING_FILE_TOOLS],
    denyTools: [],
    systemGuidance:
      "Agent mode: BUILD. Implement the user's goal with concrete file edits and verification. Prefer small, reviewable diffs.",
  },
  plan: {
    id: "plan",
    label: "Plan",
    summary: "只读规划：禁止写文件/执行命令，可读写与 todo。",
    autoAllowTools: [],
    denyTools: [...MUTATING_FILE_TOOLS, ...MUTATING_SHELL_TOOLS],
    systemGuidance:
      "Agent mode: PLAN. Do not modify files or run mutating shell/git commands. Investigate with read/search tools, then produce a concrete plan and todos.",
  },
  ask: {
    id: "ask",
    label: "Ask",
    summary: "问答模式：只读解释，不改仓库。",
    autoAllowTools: [],
    denyTools: [...MUTATING_FILE_TOOLS, ...MUTATING_SHELL_TOOLS],
    systemGuidance:
      "Agent mode: ASK. Answer questions about the codebase. Do not edit files or run mutating commands; use read-only tools only.",
  },
};

export function isAgentMode(value: string): value is AgentMode {
  return AGENT_MODES.includes(value as AgentMode);
}

export function agentModeLabel(mode: AgentMode): string {
  return AGENT_MODE_PROFILES[mode]?.label || mode;
}

export function resolveToolDecision(
  agentMode: AgentMode,
  tool: string,
): "auto-allow" | "deny" | "prompt" {
  const profile = AGENT_MODE_PROFILES[agentMode] || AGENT_MODE_PROFILES.build;
  if (profile.denyTools.includes(tool)) return "deny";
  if (profile.autoAllowTools.includes(tool)) return "auto-allow";
  return "prompt";
}
