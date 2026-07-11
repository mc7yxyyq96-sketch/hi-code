import { MAX_TRANSCRIPT_ROWS } from "./contracts.ts";

export type SessionFocusDirection = "next" | "previous" | "first" | "last";

export interface TranscriptWindow {
  start: number;
  end: number;
  hasOlder: boolean;
  hasNewer: boolean;
}

export function computeTranscriptWindow(totalValue: number, anchorValue: number, sizeValue = MAX_TRANSCRIPT_ROWS): TranscriptWindow {
  const total = Math.max(0, Math.floor(Number(totalValue) || 0));
  const size = Math.max(1, Math.min(MAX_TRANSCRIPT_ROWS, Math.floor(Number(sizeValue) || MAX_TRANSCRIPT_ROWS)));
  const minimumEnd = Math.min(total, size);
  const anchor = Math.floor(Number(anchorValue));
  const end = Math.max(minimumEnd, Math.min(total, Number.isFinite(anchor) ? anchor : total));
  const start = Math.max(0, end - size);
  return { start, end, hasOlder: start > 0, hasNewer: end < total };
}

export function moveSessionFocusIndex(currentValue: number, countValue: number, direction: SessionFocusDirection) {
  const count = Math.max(0, Math.floor(Number(countValue) || 0));
  if (!count) return -1;
  const current = Math.max(0, Math.min(count - 1, Math.floor(Number(currentValue) || 0)));
  if (direction === "first") return 0;
  if (direction === "last") return count - 1;
  if (direction === "next") return (current + 1) % count;
  return (current - 1 + count) % count;
}
