export function summarizeRunText(value) {
  const text = String(value || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) || "";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function normalizeRuntimeQueue(state) {
  return {
    running: state?.running || null,
    queued: Array.isArray(state?.queued) ? state.queued : [],
  };
}
