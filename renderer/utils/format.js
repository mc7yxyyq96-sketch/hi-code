export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function shortPath(path) {
  const match = path && String(path).match(/^\/Users\/[^/]+/);
  return match ? String(path).replace(match[0], "~") : (path || "");
}

export function statusText(status) {
  return {
    running: "running",
    waiting: "waiting",
    done: "done",
    error: "error",
    denied: "denied",
    interrupted: "interrupted",
  }[status] || status;
}

export function statusClass(status) {
  return {
    running: "is-running",
    waiting: "is-waiting",
    done: "is-done",
    error: "is-error",
    denied: "is-denied",
    interrupted: "is-interrupted",
  }[status] || "";
}
