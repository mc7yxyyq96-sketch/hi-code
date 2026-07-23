export function mountMemoryPanel({
  root,
  listMemory,
  addMemory,
  removeMemory,
  pinMemory,
  rollbackRun,
  getWorkspace,
  onToast,
}) {
  if (!root) return { refresh() {}, stop() {} };

  root.innerHTML = `
    <div class="memory-shell">
      <div class="memory-head">
        <div>
          <h2>工作区记忆</h2>
          <p>跨会话保留项目约定与事实；可一键回滚当前未归档改动。</p>
        </div>
        <div class="memory-head-actions">
          <button type="button" class="ghost" data-role="rollback">回滚未归档改动</button>
          <button type="button" class="ghost" data-role="refresh">刷新</button>
        </div>
      </div>
      <form class="memory-form" data-role="form">
        <textarea name="text" rows="3" required placeholder="写下要记住的约定、决策或事实…"></textarea>
        <div class="memory-form-actions">
          <input name="tags" placeholder="标签（逗号分隔，可选）" />
          <button type="submit" class="primary">保存记忆</button>
        </div>
      </form>
      <div class="memory-summary" data-role="summary"></div>
      <div class="memory-list" data-role="list"></div>
    </div>
  `;

  const listEl = root.querySelector('[data-role="list"]');
  const summaryEl = root.querySelector('[data-role="summary"]');
  const form = root.querySelector('[data-role="form"]');
  let notes = [];

  function toast(kind, message) {
    onToast?.(kind, message);
  }

  function render() {
    const pinned = notes.filter((n) => n.pinned).length;
    summaryEl.innerHTML = `
      <div class="cap-stat"><b>${notes.length}</b><span>记忆</span></div>
      <div class="cap-stat"><b>${pinned}</b><span>置顶</span></div>
    `;
    listEl.innerHTML = "";
    if (!notes.length) {
      listEl.innerHTML = `<div class="cap-empty">还没有工作区记忆。</div>`;
      return;
    }
    const ordered = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
    for (const note of ordered) {
      const row = document.createElement("div");
      row.className = `memory-item${note.pinned ? " pinned" : ""}`;
      row.innerHTML = `
        <div class="memory-main">
          <div class="memory-text"></div>
          <div class="memory-meta"></div>
        </div>
        <div class="memory-actions"></div>
      `;
      row.querySelector(".memory-text").textContent = note.text;
      row.querySelector(".memory-meta").textContent = [
        note.pinned ? "置顶" : "",
        (note.tags || []).join(", "),
        note.createdAt ? new Date(note.createdAt).toLocaleString() : "",
      ].filter(Boolean).join(" · ");
      const actions = row.querySelector(".memory-actions");
      const pinBtn = document.createElement("button");
      pinBtn.className = "cap-badge";
      pinBtn.textContent = note.pinned ? "取消置顶" : "置顶";
      pinBtn.onclick = async () => {
        const cwd = await getWorkspace?.();
        const result = await pinMemory({ cwd, id: note.id, pinned: !note.pinned });
        if (!result?.ok) return toast("error", result?.error || "更新失败");
        await refresh();
      };
      const delBtn = document.createElement("button");
      delBtn.className = "cap-badge danger";
      delBtn.textContent = "删除";
      delBtn.onclick = async () => {
        const cwd = await getWorkspace?.();
        const result = await removeMemory({ cwd, id: note.id });
        if (!result?.ok) return toast("error", result?.error || "删除失败");
        await refresh();
      };
      actions.append(pinBtn, delBtn);
      listEl.appendChild(row);
    }
  }

  async function refresh() {
    const cwd = await getWorkspace?.();
    const result = await listMemory({ cwd });
    notes = Array.isArray(result?.memory?.notes) ? result.memory.notes : [];
    render();
    return notes;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const text = String(data.get("text") || "").trim();
    const tags = String(data.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean);
    const cwd = await getWorkspace?.();
    const result = await addMemory({ cwd, text, tags });
    if (!result?.ok) return toast("error", result?.error || "保存失败");
    form.reset();
    toast("ok", "记忆已保存");
    await refresh();
  });

  root.querySelector('[data-role="refresh"]').onclick = () => refresh();
  root.querySelector('[data-role="rollback"]').onclick = async () => {
    if (!confirm("回滚当前所有未归档改动？此操作会恢复文件内容。")) return;
    const result = await rollbackRun();
    if (!result?.ok) return toast("error", result?.error || "回滚失败");
    toast("ok", `已回滚 ${result.count || 0} 个改动`);
  };

  return { refresh, stop() {} };
}
