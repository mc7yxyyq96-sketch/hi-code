const REASONING_LABELS = {
  low: "低",
  medium: "中",
  high: "高",
  ultra: "超高",
};

function formatCompactTokens(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function monthLabels(heatmap) {
  const labels = [];
  let lastMonth = "";
  for (let week = 0; week < Math.ceil(heatmap.length / 7); week++) {
    const idx = week * 7;
    const date = heatmap[idx]?.date || "";
    const month = date ? `${Number(date.slice(5, 7))}月` : "";
    if (month && month !== lastMonth) {
      labels.push({ week, label: month });
      lastMonth = month;
    }
  }
  return labels;
}

function computeLevel(value, max) {
  if (value <= 0) return 0;
  const ratio = value / Math.max(max, 1);
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function animateMetricValue(node, targetText) {
  if (!node) return;
  const text = String(targetText || "—");
  if (text === "—" || /[KMB]|天|h|m|s|%/.test(text)) {
    node.textContent = text;
    return;
  }
  const match = text.match(/^([\d,]+)(.*)$/);
  if (!match) {
    node.textContent = text;
    return;
  }
  const suffix = match[2] || "";
  const target = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(target) || target <= 0) {
    node.textContent = text;
    return;
  }
  const start = performance.now();
  const duration = 520;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    const value = Math.round(target * eased);
    node.textContent = `${value.toLocaleString()}${suffix}`;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let heatmapTooltipEl = null;

function mountHeatmapTooltip(root) {
  if (!heatmapTooltipEl) {
    heatmapTooltipEl = el("div", "usage-heatmap-tooltip hidden");
    document.body.appendChild(heatmapTooltipEl);
  }
  root.addEventListener("mouseleave", () => heatmapTooltipEl.classList.add("hidden"));
  return heatmapTooltipEl;
}

function showHeatmapTooltip(tip, cell, label) {
  if (!tip || !cell) return;
  tip.textContent = label;
  tip.classList.remove("hidden");
  const rect = cell.getBoundingClientRect();
  tip.style.left = `${rect.left + rect.width / 2}px`;
  tip.style.top = `${rect.top - 8}px`;
}

export function renderUsagePanel(root, stats, { profile } = {}) {
  if (!root) return;
  root.innerHTML = "";
  if (!stats?.ok) {
    root.appendChild(el("div", "settings-hint", stats?.error || "暂时无法读取用量数据。"));
    return;
  }

  const info = profile || {
    displayName: "Hi Code 用户",
    handle: "本地账号",
    emailLine: "数据保存在 ~/.hicode/usage",
    initials: "HC",
    badge: "本地版",
    avatarHue: 210,
  };

  const profileRow = el("div", "usage-profile");
  const avatar = el("div", "usage-avatar");
  avatar.textContent = info.initials || "HC";
  avatar.style.setProperty("--usage-avatar-hue", String(info.avatarHue || 210));
  const identity = el("div", "usage-identity");
  const nameRow = el("div", "usage-name-row");
  nameRow.append(el("div", "usage-name", info.displayName || "Hi Code 用户"));
  if (info.badge) nameRow.append(el("span", "usage-badge", info.badge));
  identity.append(
    nameRow,
    el("div", "usage-handle muted", info.handle || ""),
    el("div", "usage-email muted", info.emailLine || ""),
  );
  profileRow.append(avatar, identity);
  root.appendChild(profileRow);

  const metrics = el("div", "usage-metrics");
  const metricDefs = [
    ["lifetimeTokens", "累计 Token"],
    ["peakDayTokens", "单日峰值"],
    ["longestTask", "最长任务"],
    ["currentStreak", "当前连续"],
    ["longestStreak", "最长连续"],
  ];
  for (const [key, label] of metricDefs) {
    const card = el("div", "usage-metric");
    const valueNode = el("div", "usage-metric-value", "0");
    card.append(valueNode, el("div", "usage-metric-label", label));
    metrics.appendChild(card);
    animateMetricValue(valueNode, stats.formatted?.[key] || "—");
  }
  root.appendChild(metrics);

  const heatmapWrap = el("div", "usage-heatmap-wrap");
  const heatmapHead = el("div", "usage-heatmap-head");
  heatmapHead.append(el("div", "settings-group-title usage-section-title", "Token 活动"), el("span", "muted", "近 12 个月"));
  const modeTabs = el("div", "usage-mode-tabs");
  [
    ["daily", "每日"],
    ["weekly", "每周"],
    ["cumulative", "累计"],
  ].forEach(([mode, label], index) => {
    const btn = el("button", `usage-mode-tab${index === 0 ? " active" : ""}`, label);
    btn.type = "button";
    btn.dataset.usageMode = mode;
    modeTabs.appendChild(btn);
  });
  heatmapHead.appendChild(modeTabs);
  heatmapWrap.appendChild(heatmapHead);

  const heatmapBoard = el("div", "usage-heatmap-board");
  const weekdays = el("div", "usage-weekdays");
  ["日", "一", "二", "三", "四", "五", "六"].forEach((label, index) => {
    const span = el("span", "usage-weekday", label);
    if (index % 2 === 0) span.classList.add("faint");
    weekdays.appendChild(span);
  });
  heatmapBoard.appendChild(weekdays);

  const weekCount = stats.heatmapWeeks || Math.ceil((stats.heatmap || []).length / 7);
  const heatmapMain = el("div", "usage-heatmap-main");
  const heatmapScroll = el("div", "usage-heatmap-scroll");
  heatmapScroll.style.setProperty("--usage-weeks", String(weekCount));
  const months = el("div", "usage-months");
  months.style.setProperty("--usage-weeks", String(weekCount));
  for (const { week, label } of monthLabels(stats.heatmap || [])) {
    const span = el("span", "usage-month-label", label);
    span.style.gridColumnStart = String(week + 1);
    months.appendChild(span);
  }
  heatmapScroll.appendChild(months);

  const grid = el("div", "usage-heatmap-grid");
  grid.style.setProperty("--usage-weeks", String(weekCount));
  let cumulative = 0;
  for (const cell of stats.heatmap || []) {
    const square = el("div", `usage-cell level-${cell.level || 0}`);
    square.dataset.date = cell.date || "";
    square.dataset.tokens = String(cell.tokens || 0);
    cumulative += cell.tokens || 0;
    square.dataset.cumulative = String(cumulative);
    grid.appendChild(square);
  }
  heatmapScroll.appendChild(grid);
  heatmapMain.appendChild(heatmapScroll);
  heatmapBoard.appendChild(heatmapMain);
  heatmapWrap.appendChild(heatmapBoard);

  const legend = el("div", "usage-legend muted");
  legend.append(document.createTextNode("少 "));
  for (let level = 0; level <= 4; level++) legend.appendChild(el("span", `usage-cell level-${level}`));
  legend.append(document.createTextNode(" 多"));
  heatmapWrap.appendChild(legend);
  root.appendChild(heatmapWrap);

  const tooltip = mountHeatmapTooltip(root);
  const applyHeatmapMode = (mode) => {
    const cells = [...grid.querySelectorAll(".usage-cell")];
    const dailyValues = cells.map((square) => Number(square.dataset.tokens || 0));
    const weekTotals = [];
    for (let week = 0; week < weekCount; week++) {
      let sum = 0;
      for (let day = 0; day < 7; day++) sum += dailyValues[week * 7 + day] || 0;
      weekTotals.push(sum);
    }
    let running = 0;
    let maxValue = 1;
    const computed = cells.map((square, index) => {
      const daily = dailyValues[index] || 0;
      running += daily;
      const week = Math.floor(index / 7);
      let value = daily;
      if (mode === "weekly") value = weekTotals[week] || 0;
      if (mode === "cumulative") value = running;
      maxValue = Math.max(maxValue, value);
      return { square, daily, value, running };
    });
    for (const item of computed) {
      const level = computeLevel(item.value, maxValue);
      item.square.className = `usage-cell level-${level}`;
      const date = item.square.dataset.date || "";
      const label = mode === "cumulative"
        ? `${date} · 累计 ${item.running.toLocaleString()} tokens`
        : mode === "weekly"
          ? `${date} 所在周 · ${item.value.toLocaleString()} tokens`
          : `${date} · ${item.daily.toLocaleString()} tokens`;
      item.square.dataset.tooltip = label;
      item.square.onmouseenter = () => showHeatmapTooltip(tooltip, item.square, label);
      item.square.onmousemove = () => showHeatmapTooltip(tooltip, item.square, label);
      item.square.onmouseleave = () => tooltip.classList.add("hidden");
    }
  };

  modeTabs.querySelectorAll(".usage-mode-tab").forEach((btn) => {
    btn.onclick = () => {
      modeTabs.querySelectorAll(".usage-mode-tab").forEach((item) => item.classList.remove("active"));
      btn.classList.add("active");
      applyHeatmapMode(btn.dataset.usageMode || "daily");
    };
  });
  applyHeatmapMode("daily");

  const columns = el("div", "usage-columns");
  const insights = el("div", "usage-column");
  insights.appendChild(el("div", "settings-group-title usage-section-title", "活动概览"));
  const insightList = el("div", "usage-list");
  const topReason = stats.reasoningBreakdown?.[0];
  const insightRows = [
    ["累计输入 Token", stats.lifetimePromptTokens?.toLocaleString?.() || "0"],
    ["累计输出 Token", stats.lifetimeCompletionTokens?.toLocaleString?.() || "0"],
    ["总会话数", String(stats.totalSessions || 0)],
    ["总轮次", String(stats.totalTurns || 0)],
    ["常用推理等级", topReason ? `${REASONING_LABELS[topReason.level] || topReason.level} · ${topReason.pct}%` : stats.currentReasoningLabel || "—"],
  ];
  for (const [label, value] of insightRows) {
    const row = el("div", "usage-list-row");
    row.append(el("span", "", label), el("strong", "", value));
    insightList.appendChild(row);
  }
  insights.appendChild(insightList);
  columns.appendChild(insights);

  const tools = el("div", "usage-column");
  tools.appendChild(el("div", "settings-group-title usage-section-title", "常用工具"));
  const toolList = el("div", "usage-list");
  if (!(stats.topTools || []).length) {
    toolList.appendChild(el("div", "settings-hint", "暂无工具使用记录。"));
  } else {
    for (const item of stats.topTools.slice(0, 5)) {
      const row = el("div", "usage-list-row");
      row.append(el("span", "mono", item.tool), el("strong", "", `${item.count.toLocaleString()} 次`));
      toolList.appendChild(row);
    }
  }
  tools.appendChild(toolList);

  if ((stats.topModels || []).length) {
    tools.appendChild(el("div", "settings-group-title usage-section-title", "常用模型"));
    const modelList = el("div", "usage-list");
    for (const item of stats.topModels.slice(0, 5)) {
      const row = el("div", "usage-list-row");
      row.append(el("span", "mono", item.model), el("strong", "", formatCompactTokens(item.tokens)));
      modelList.appendChild(row);
    }
    tools.appendChild(modelList);
  }
  columns.appendChild(tools);
  root.appendChild(columns);

  requestAnimationFrame(() => root.classList.add("is-mounted"));
}
