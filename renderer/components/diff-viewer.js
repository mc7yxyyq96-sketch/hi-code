import { escapeHtml } from "../utils/format.js";

export function diffStatusText(status) {
  return {
    pending: "已应用 · 可回滚",
    accepted: "已归档",
    rejected: "已回滚",
    undone: "已撤销",
  }[status] || status;
}

export function renderUnifiedDiff(diff) {
  const rows = [
    { kind: "meta", text: `--- ${diff.path}${diff.before === null ? " (new file)" : ""}` },
    { kind: "meta", text: `+++ ${diff.path}` },
  ];
  const before = splitLines(diff.before ?? "");
  const after = splitLines(diff.after ?? "");
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    const oldLine = before[i];
    const newLine = after[i];
    if (oldLine === newLine && oldLine !== undefined) {
      rows.push({ kind: "ctx", text: ` ${oldLine}` });
    } else {
      if (oldLine !== undefined) rows.push({ kind: "del", text: `-${oldLine}` });
      if (newLine !== undefined) rows.push({ kind: "add", text: `+${newLine}` });
    }
    if (rows.length > 800) {
      rows.push({ kind: "meta", text: "... diff truncated in preview ..." });
      break;
    }
  }
  return rows.map((row) => `<span class="diff-code-line ${row.kind}">${escapeHtml(row.text) || " "}</span>`).join("");
}

function splitLines(text) {
  const lines = String(text).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
