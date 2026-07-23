import chalk from "chalk";
import { type AgentMode, resolveToolDecision } from "./agent-modes.js";

export type PermissionMode = "default" | "acceptEdits" | "yolo";

/** Prompt the user for a line of input. Supplied by the active frontend. */
export type AskFn = (question: string) => Promise<string>;

export interface PermissionState {
  mode: PermissionMode;
  /** OpenCode-style agent profile (build/plan/ask). */
  agentMode: AgentMode;
  /** Tools the user chose "always allow" for during this session. */
  allowlist: Set<string>;
}

export function newPermissionState(
  mode: PermissionMode = "default",
  agentMode: AgentMode = "build",
): PermissionState {
  return { mode, agentMode, allowlist: new Set() };
}

export interface PermissionRequest {
  tool: string;
  /** Human-readable one-liner, e.g. `bash: rm -rf build`. */
  action: string;
  /** Whether this action mutates the filesystem / runs commands. */
  mutating: boolean;
}

export type Decision = "allow" | "always" | "deny";

/**
 * Decide whether an action may proceed. Read-only tools never prompt.
 * Honors agentMode matrix, yolo / acceptEdits modes and the session allowlist.
 */
export async function requestPermission(
  state: PermissionState,
  req: PermissionRequest,
  ask: AskFn,
): Promise<Decision> {
  if (!req.mutating) return "allow";

  const agentDecision = resolveToolDecision(state.agentMode || "build", req.tool);
  if (agentDecision === "deny") {
    console.log();
    console.log(chalk.red(`  ✕ blocked by ${state.agentMode} mode: ${req.action}`));
    return "deny";
  }
  if (agentDecision === "auto-allow") return "allow";

  if (state.mode === "yolo") return "allow";
  if (
    state.mode === "acceptEdits" &&
    (req.tool === "write_file" || req.tool === "edit_file" || req.tool === "apply_patch")
  ) {
    return "allow";
  }
  if (state.allowlist.has(req.tool)) return "allow";

  console.log();
  console.log(chalk.yellow("  ⚠ permission required"));
  console.log(chalk.gray("  " + req.action));
  const answer = (await ask(chalk.bold("  [y] allow  [a] always allow this tool  [n] deny › ")))
    .trim()
    .toLowerCase();

  if (answer === "a" || answer === "always") {
    state.allowlist.add(req.tool);
    return "always";
  }
  if (answer === "y" || answer === "yes" || answer === "") return "allow";
  return "deny";
}
