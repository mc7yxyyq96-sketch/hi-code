import chalk from "chalk";
import { createHash } from "node:crypto";

export type PermissionMode = "default" | "acceptEdits" | "yolo";

/** Prompt the user for a line of input. Supplied by the active frontend. */
export type AskFn = (question: string) => Promise<string>;

export interface PermissionState {
  mode: PermissionMode;
  /** Tools the user chose "always allow" for during this session. */
  allowlist: Set<string>;
  /** Exact mutating actions approved for the active frontend session. */
  approvedFingerprints: Set<string>;
  /** Concurrent identical prompts share one user decision. */
  pendingFingerprints: Map<string, Promise<Decision>>;
}

export function newPermissionState(mode: PermissionMode = "default"): PermissionState {
  return {
    mode,
    allowlist: new Set(),
    approvedFingerprints: new Set(),
    pendingFingerprints: new Map(),
  };
}

export interface PermissionRequest {
  tool: string;
  /** Human-readable one-liner, e.g. `bash: rm -rf build`. */
  action: string;
  /** Whether this action mutates the filesystem / runs commands. */
  mutating: boolean;
  /** Approval lifetime. Only the current process session is supported today. */
  scope?: "session";
}

export type Decision = "allow" | "always" | "deny";

export function permissionFingerprint(req: PermissionRequest): string {
  const normalized = JSON.stringify({
    tool: req.tool.trim().toLowerCase(),
    action: req.action.trim().replace(/\s+/g, " "),
    mutating: req.mutating,
    scope: req.scope || "session",
  });
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Decide whether an action may proceed. Read-only tools never prompt.
 * Honors yolo / acceptEdits modes and the session allowlist.
 */
export async function requestPermission(
  state: PermissionState,
  req: PermissionRequest,
  ask: AskFn,
): Promise<Decision> {
  if (!req.mutating) return "allow";
  if (state.mode === "yolo") return "allow";
  if (state.mode === "acceptEdits" && (req.tool === "write_file" || req.tool === "edit_file")) return "allow";
  if (state.allowlist.has(req.tool)) return "allow";

  const fingerprint = permissionFingerprint(req);
  if (state.approvedFingerprints.has(fingerprint)) return "allow";
  const pending = state.pendingFingerprints.get(fingerprint);
  if (pending) return pending;

  const decide = async (): Promise<Decision> => {
    console.log();
    console.log(chalk.yellow("  ⚠ permission required"));
    console.log(chalk.gray("  " + req.action));
    const answer = (await ask(chalk.bold("  [y] allow  [a] always allow this tool  [n] deny › ")))
      .trim()
      .toLowerCase();

    if (answer === "a" || answer === "always") {
      state.allowlist.add(req.tool);
      state.approvedFingerprints.add(fingerprint);
      return "always";
    }
    if (answer === "y" || answer === "yes" || answer === "") {
      state.approvedFingerprints.add(fingerprint);
      return "allow";
    }
    return "deny";
  };

  const decision = decide();
  state.pendingFingerprints.set(fingerprint, decision);
  try {
    return await decision;
  } finally {
    state.pendingFingerprints.delete(fingerprint);
  }
}
