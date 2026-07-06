import chalk from "chalk";

export type PermissionMode = "default" | "acceptEdits" | "yolo";

/** Prompt the user for a line of input. Supplied by the active frontend. */
export type AskFn = (question: string) => Promise<string>;

export interface PermissionState {
  mode: PermissionMode;
  /** Tools the user chose "always allow" for during this session. */
  allowlist: Set<string>;
}

export function newPermissionState(mode: PermissionMode = "default"): PermissionState {
  return { mode, allowlist: new Set() };
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
