export function $(id, root = document) {
  return root.getElementById ? root.getElementById(id) : root.querySelector(`#${CSS.escape(id)}`);
}

export function clear(root) {
  if (root) root.innerHTML = "";
  return root;
}

export function button(label, className = "") {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  if (className) el.className = className;
  return el;
}

export function safeText(value) {
  return value == null ? "" : String(value);
}
