function renderTreeNode(node, depth = 0) {
  if (!node) return "";
  if (node.type === "file") {
    return `<div class="codemap-file" style="padding-left:${12 + depth * 14}px" data-path="${escapeAttr(node.path || "")}">${escapeHtml(node.name)}</div>`;
  }
  const kids = (node.children || []).map((child) => renderTreeNode(child, depth + (node.name === "." ? 0 : 1))).join("");
  if (node.name === ".") return kids;
  return `
    <details class="codemap-dir" open>
      <summary style="padding-left:${12 + depth * 14}px">${escapeHtml(node.name)}/</summary>
      ${kids}
    </details>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

export function mountCodemapPanel({ root, scan, onOpenFile }) {
  if (!root) return { refresh() {}, stop() {} };

  root.innerHTML = `
    <div class="codemap-shell">
      <div class="codemap-head">
        <div>
          <h2>Code Map</h2>
          <p>项目目录树与符号索引，帮助 Agent 快速定位代码结构。</p>
        </div>
        <button type="button" class="ghost" data-role="refresh">刷新</button>
      </div>
      <div class="codemap-summary" data-role="summary"></div>
      <div class="codemap-grid">
        <section class="codemap-pane">
          <div class="codemap-pane-title">目录</div>
          <div class="codemap-tree" data-role="tree"></div>
        </section>
        <section class="codemap-pane">
          <div class="codemap-pane-title">符号</div>
          <div class="codemap-symbols" data-role="symbols"></div>
        </section>
      </div>
    </div>
  `;

  const summaryEl = root.querySelector('[data-role="summary"]');
  const treeEl = root.querySelector('[data-role="tree"]');
  const symbolsEl = root.querySelector('[data-role="symbols"]');

  async function refresh() {
    summaryEl.textContent = "扫描中…";
    treeEl.innerHTML = "";
    symbolsEl.innerHTML = "";
    const result = await scan();
    if (!result?.ok) {
      summaryEl.textContent = result?.error || "扫描失败";
      return result;
    }
    const s = result.summary || {};
    summaryEl.innerHTML = `
      <div class="cap-stat"><b>${s.fileCount || 0}</b><span>文件</span></div>
      <div class="cap-stat"><b>${s.dirCount || 0}</b><span>目录</span></div>
      <div class="cap-stat"><b>${s.symbolCount || 0}</b><span>符号</span></div>
      <div class="cap-stat"><b>${(s.topExtensions || []).map((x) => x.ext).slice(0, 3).join(" ") || "—"}</b><span>主要类型</span></div>
    `;
    treeEl.innerHTML = renderTreeNode(result.tree) || `<div class="cap-empty">工作区为空</div>`;
    symbolsEl.innerHTML = (result.symbols || []).length
      ? result.symbols.map((sym) => `
          <button type="button" class="codemap-symbol" data-path="${escapeAttr(sym.path)}" data-line="${sym.line}">
            <span class="codemap-symbol-name">${escapeHtml(sym.name)}</span>
            <span class="codemap-symbol-meta">${escapeHtml(sym.kind)} · ${escapeHtml(sym.path)}:${sym.line}</span>
          </button>
        `).join("")
      : `<div class="cap-empty">未发现符号</div>`;

    treeEl.querySelectorAll(".codemap-file").forEach((el) => {
      el.onclick = () => onOpenFile?.(el.dataset.path, 1);
    });
    symbolsEl.querySelectorAll(".codemap-symbol").forEach((el) => {
      el.onclick = () => onOpenFile?.(el.dataset.path, Number(el.dataset.line) || 1);
    });
    return result;
  }

  root.querySelector('[data-role="refresh"]').onclick = () => refresh();
  return { refresh, stop() {} };
}
