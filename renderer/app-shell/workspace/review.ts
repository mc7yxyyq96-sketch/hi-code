import type { WorkspaceDiff } from "./contracts.ts";

export type DiffCommentSide = "before" | "after";

export interface DiffReviewComment {
  diffId: string;
  path: string;
  line: number;
  side: DiffCommentSide;
  body: string;
}

const MAX_COMMENT_BYTES = 8_000;
const MAX_REVISION_REQUEST_BYTES = 24_000;
const encoder = new TextEncoder();

export function normalizeDiffComment(value: DiffReviewComment): DiffReviewComment {
  const diffId = boundedIdentifier(value?.diffId, "diff id", 256);
  const filePath = boundedIdentifier(value?.path, "path", 4096);
  const line = Number(value?.line);
  if (!Number.isSafeInteger(line) || line < 1 || line > 1_000_000) throw new Error("Diff comment line must be a positive integer");
  if (value?.side !== "before" && value?.side !== "after") throw new Error("Diff comment side must be before or after");
  const body = String(value?.body || "").trim();
  if (!body) throw new Error("Diff comment body is required");
  if (encoder.encode(body).length > MAX_COMMENT_BYTES) throw new Error("Diff comment is too large");
  return { diffId, path: filePath, line, side: value.side, body };
}

export function buildRevisionRequest({ comment: input, diff }: { comment: DiffReviewComment; diff: WorkspaceDiff }) {
  const comment = normalizeDiffComment(input);
  if (!diff || String(diff.id) !== comment.diffId) throw new Error("Diff comment does not match the selected diff");
  if (String(diff.path) !== comment.path) throw new Error("Diff comment path does not match the selected diff");
  const source = comment.side === "before" ? diff.before : diff.after;
  const context = lineContext(source, comment.line);
  const payload = JSON.stringify({
    type: "hicode.diff_review",
    diffId: comment.diffId,
    path: comment.path,
    line: comment.line,
    side: comment.side,
    comment: comment.body,
    context,
  }, null, 2);
  const instruction = [
    "请处理下面这条结构化代码审查意见。先读取当前磁盘文件并核对上下文，再做最小必要修改；不要仅回复说明。",
    "修改后运行与改动相关的检查，并总结实际变更和测试结果。",
    payload,
  ].join("\n\n");
  if (encoder.encode(instruction).length > MAX_REVISION_REQUEST_BYTES) throw new Error("Revision request is too large");
  return {
    runtimeText: instruction,
    displayText: `审查 ${comment.path}:${comment.line} · ${comment.body}`,
    comment,
  };
}

function lineContext(content: string | null, line: number) {
  const rows = String(content || "").split(/\r?\n/);
  const center = Math.max(0, Math.min(rows.length - 1, line - 1));
  const start = Math.max(0, center - 3);
  const end = Math.min(rows.length, center + 4);
  return rows.slice(start, end).map((text, index) => ({ line: start + index + 1, text: text.slice(0, 2_000) }));
}

function boundedIdentifier(value: unknown, label: string, max: number) {
  const text = String(value || "").trim();
  if (!text || text.length > max || text.includes("\0")) throw new Error(`Diff comment ${label} is invalid`);
  return text;
}
