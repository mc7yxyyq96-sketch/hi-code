export function createToastController({ root = document.body, timeoutMs = 4200, maxVisible = 3 } = {}) {
  let stack = null;
  const active = new Map();

  const ensureStack = () => {
    if (stack) return stack;
    stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    root.appendChild(stack);
    return stack;
  };

  const show = (message, kind = "error") => {
    const text = String(message || "操作失败，请稍后重试。");
    const key = `${kind}:${text}`;
    const existing = active.get(key);
    if (existing?.item?.isConnected) {
      existing.count += 1;
      existing.item.textContent = existing.count > 1 ? `${text}（${existing.count} 次）` : text;
      clearTimeout(existing.timer);
      existing.timer = setTimeout(existing.close, timeoutMs);
      ensureStack().appendChild(existing.item);
      return existing.item;
    }
    const item = document.createElement("div");
    item.className = `toast toast-${kind}`;
    item.textContent = text;
    const target = ensureStack();
    target.appendChild(item);
    const close = () => {
      active.delete(key);
      item.remove();
    };
    const record = { item, count: 1, close, timer: null };
    active.set(key, record);
    while (target.children.length > maxVisible) {
      target.firstElementChild?.click();
    }
    item.onclick = close;
    record.timer = setTimeout(close, timeoutMs);
    return item;
  };

  return {
    show,
    error: (message) => show(message, "error"),
    ok: (message) => show(message, "ok"),
    info: (message) => show(message, "info"),
  };
}
