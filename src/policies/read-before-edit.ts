/**
 * Enforce read-before-edit for mutating file tools (clean-room policy).
 */

export interface ReadBeforeEditState {
  readPaths: Set<string>;
}

export function createReadBeforeEditState(): ReadBeforeEditState {
  return { readPaths: new Set() };
}

export function normalizePolicyPath(filePath: string): string {
  return String(filePath || "").trim().replace(/\\/g, "/").toLowerCase();
}

export function recordFileRead(state: ReadBeforeEditState | undefined, filePath: string): void {
  if (!state) return;
  const key = normalizePolicyPath(filePath);
  if (key) state.readPaths.add(key);
}

export function requireReadBeforeEdit(
  state: ReadBeforeEditState | undefined,
  filePath: string,
): { ok: true } | { ok: false; error: string } {
  if (!state) return { ok: true };
  const key = normalizePolicyPath(filePath);
  if (!key) return { ok: false, error: "Policy: path is required before editing." };
  if (!state.readPaths.has(key)) {
    return {
      ok: false,
      error: `Policy: read_file("${filePath}") required before editing this path.`,
    };
  }
  return { ok: true };
}
