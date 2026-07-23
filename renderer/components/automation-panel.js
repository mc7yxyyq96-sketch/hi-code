/**
 * Automation / schedules page (clean-room Wave1).
 */

function formatWhen(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function scheduleLabel(schedule = {}) {
  if (schedule.kind === "once") return `一次 · ${formatWhen(schedule.at)}`;
  if (schedule.kind === "cron") return `Cron · ${schedule.expression || "* * * * *"}`;
  return `间隔 · ${schedule.every || "1h"}`;
}

export function mountAutomationPanel({
  root,
  listAutomations,
  createAutomation,
  updateAutomation,
  removeAutomation,
  setEnabled,
  markRun,
  runPrompt,
  getWorkspace,
  onToast,
}) {
  if (!root) return { refresh() {}, stop() {} };

  root.innerHTML = `
    <div class="auto-shell">
      <div class="auto-head">
        <div>
          <h2>自动化</h2>
          <p>定时或间隔向当前工作区发送 Agent 任务（Hermes/Yan 风格调度）。</p>
        </div>
        <div class="auto-head-actions">
          <button type="button" data-role="refresh" class="ghost">刷新</button>
        </div>
      </div>
      <form class="auto-form" data-role="form">
        <div class="auto-form-grid">
          <label>名称<input name="title" required maxlength="80" placeholder="例如：每日依赖巡检" /></label>
          <label>节奏
            <select name="every">
              <option value="5m">每 5 分钟</option>
              <option value="15m">每 15 分钟</option>
              <option value="1h" selected>每小时</option>
              <option value="6h">每 6 小时</option>
              <option value="1d">每天</option>
              <option value="once">仅一次（1 分钟后）</option>
            </select>
          </label>
        </div>
        <label class="auto-prompt-label">任务提示词
          <textarea name="prompt" rows="3" required placeholder="描述要自动执行的任务…"></textarea>
        </label>
        <div class="auto-form-actions">
          <button type="submit" class="primary">创建自动化</button>
          <span class="auto-hint" data-role="hint"></span>
        </div>
      </form>
      <div class="auto-summary" data-role="summary"></div>
      <div class="auto-list" data-role="list"></div>
    </div>
  `;

  const listEl = root.querySelector('[data-role="list"]');
  const summaryEl = root.querySelector('[data-role="summary"]');
  const hintEl = root.querySelector('[data-role="hint"]');
  const form = root.querySelector('[data-role="form"]');
  let items = [];

  function toast(kind, message) {
    if (typeof onToast === "function") onToast(kind, message);
  }

  function renderSummary() {
    const enabled = items.filter((item) => item.enabled).length;
    summaryEl.innerHTML = `
      <div class="cap-stat"><b>${items.length}</b><span>全部</span></div>
      <div class="cap-stat"><b>${enabled}</b><span>已启用</span></div>
      <div class="cap-stat"><b>${items.length - enabled}</b><span>已暂停</span></div>
    `;
  }

  function renderList() {
    listEl.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "cap-empty";
      empty.textContent = "还没有自动化任务。创建一个定时提示词即可开始。";
      listEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = `auto-item${item.enabled ? "" : " disabled"}`;
      row.innerHTML = `
        <div class="auto-main">
          <div class="auto-name"></div>
          <div class="auto-desc"></div>
          <div class="auto-meta"></div>
        </div>
        <div class="auto-actions"></div>
      `;
      row.querySelector(".auto-name").textContent = item.title;
      row.querySelector(".auto-desc").textContent = item.prompt;
      row.querySelector(".auto-meta").textContent = [
        scheduleLabel(item.schedule),
        item.enabled ? "启用中" : "已暂停",
        `下次 ${formatWhen(item.nextRunAt)}`,
        `已跑 ${item.runCount || 0} 次`,
        item.workspace ? `工作区 ${item.workspace}` : "",
      ].filter(Boolean).join(" · ");

      const actions = row.querySelector(".auto-actions");
      const runBtn = document.createElement("button");
      runBtn.className = "cap-badge";
      runBtn.textContent = "立即运行";
      runBtn.onclick = async () => {
        const marked = await markRun({ id: item.id });
        if (!marked?.ok) return toast("error", marked?.error || "标记失败");
        if (typeof runPrompt === "function") await runPrompt(item.prompt);
        toast("ok", `已触发：${item.title}`);
        await refresh();
      };
      actions.appendChild(runBtn);

      const toggle = document.createElement("button");
      toggle.className = "cap-badge";
      toggle.textContent = item.enabled ? "暂停" : "启用";
      toggle.onclick = async () => {
        const result = await setEnabled({ id: item.id, enabled: !item.enabled });
        if (!result?.ok) return toast("error", result?.error || "更新失败");
        await refresh();
      };
      actions.appendChild(toggle);

      const del = document.createElement("button");
      del.className = "cap-badge danger";
      del.textContent = "删除";
      del.onclick = async () => {
        if (!confirm(`删除自动化「${item.title}」？`)) return;
        const result = await removeAutomation(item.id);
        if (!result?.ok) return toast("error", result?.error || "删除失败");
        await refresh();
      };
      actions.appendChild(del);

      listEl.appendChild(row);
    }
  }

  async function refresh() {
    const result = await listAutomations();
    items = Array.isArray(result?.items) ? result.items : [];
    renderSummary();
    renderList();
    return items;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    const prompt = String(data.get("prompt") || "").trim();
    const every = String(data.get("every") || "1h");
    const schedule = every === "once"
      ? { kind: "once", at: Date.now() + 60_000 }
      : { kind: "interval", every };
    hintEl.textContent = "保存中…";
    const workspace = typeof getWorkspace === "function" ? (await getWorkspace()) || "" : "";
    const result = await createAutomation({ title, prompt, schedule, workspace, enabled: true });
    if (!result?.ok) {
      hintEl.textContent = result?.error || "创建失败";
      toast("error", result?.error || "创建失败");
      return;
    }
    form.reset();
    hintEl.textContent = "已创建";
    toast("ok", "自动化已创建");
    await refresh();
  });

  root.querySelector('[data-role="refresh"]').onclick = () => refresh();

  return { refresh, stop() {} };
}

export function automationScheduleLabel(schedule) {
  return scheduleLabel(schedule);
}
