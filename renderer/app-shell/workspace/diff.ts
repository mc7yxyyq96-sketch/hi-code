import type { WorkspaceDiff } from "./contracts.ts";

export interface UnifiedDiffLine {
  kind: "meta" | "ctx" | "del" | "add";
  text: string;
  line?: number;
  side?: "before" | "after";
}

function splitLines(value: string | null) {
  const lines = String(value ?? "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function buildUnifiedDiffLines(diff: WorkspaceDiff): UnifiedDiffLine[] {
  const rows: UnifiedDiffLine[] = [
    { kind: "meta", text: `--- ${diff.path}${diff.before === null ? " (new file)" : ""}` },
    { kind: "meta", text: `+++ ${diff.path}` },
  ];
  const before = splitLines(diff.before);
  const after = splitLines(diff.after);
  const max = Math.max(before.length, after.length);
  const maxContentRows = 800;
  let contentRows = 0;
  for (let index = 0; index < max; index += 1) {
    const oldLine = before[index];
    const newLine = after[index];
    const nextRows: UnifiedDiffLine[] = [];
    if (oldLine === newLine && oldLine !== undefined) nextRows.push({ kind: "ctx", text: ` ${oldLine}`, line: index + 1, side: "after" });
    else {
      if (oldLine !== undefined) nextRows.push({ kind: "del", text: `-${oldLine}`, line: index + 1, side: "before" });
      if (newLine !== undefined) nextRows.push({ kind: "add", text: `+${newLine}`, line: index + 1, side: "after" });
    }
    if (contentRows + nextRows.length > maxContentRows) {
      rows.push({ kind: "meta", text: "... diff truncated in preview ..." });
      break;
    }
    rows.push(...nextRows);
    contentRows += nextRows.length;
  }
  return rows;
}
