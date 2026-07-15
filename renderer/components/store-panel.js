export const STORE_VIRTUAL_ROW_HEIGHT = 94;
export const STORE_VIRTUAL_OVERSCAN = 4;

export function storeVirtualRange({ total, scrollTop = 0, viewportHeight = 560, rowHeight = STORE_VIRTUAL_ROW_HEIGHT, overscan = STORE_VIRTUAL_OVERSCAN } = {}) {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  const height = Math.max(1, Number(rowHeight) || STORE_VIRTUAL_ROW_HEIGHT);
  const top = Math.max(0, Number(scrollTop) || 0);
  const visible = Math.max(1, Math.ceil(Math.max(1, Number(viewportHeight) || 560) / height));
  const start = Math.max(0, Math.floor(top / height) - overscan);
  const end = Math.min(count, start + visible + overscan * 2);
  return {
    start,
    end,
    offsetTop: start * height,
    totalHeight: count * height,
  };
}

export const STORE_KIND_LABELS = {
  all: "全部",
  plugin: "插件",
  skill: "技能",
  mcp: "MCP",
  agent: "智能体",
};

export const STORE_CATEGORY_LABELS = {
  all: "全部分类",
  code: "代码",
  git: "Git",
  browser: "浏览器",
  review: "审查",
  automation: "自动化",
  security: "安全",
  data: "数据",
  design: "设计",
  docs: "文档",
  local: "本地",
  other: "其他",
};

export const STORE_ACTION_LABELS = {
  write: "写入",
  download: "下载",
  update: "更新",
};

export function storeIcon(kind) {
  if (kind === "skill") return "i-spark";
  if (kind === "mcp") return "i-network";
  if (kind === "agent") return "i-users";
  return "i-plug";
}

export function storeQueryOptions(query) {
  return { query: String(query || "").trim() };
}

const PRESERVED_ENGLISH_TERMS = new Set([
  "AI", "API", "AVEVA", "BIM", "CAD", "CI", "CLI", "Code", "Codex", "Connect", "Computer", "DRC", "ERC", "FAT", "Figma",
  "FreeCAD", "Gerber", "Git", "GitHub", "Hi", "IFC", "KiCad", "KPI", "MCP", "OpenCode", "PCB", "PLC", "PR", "SAT",
  "SolidWorks", "STEP", "STL", "UI", "Use", "Windows", "macOS",
]);

function normalizeSummaryText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+和\s+/g, " and ")
    .replace(/\s+—\s+/g, " — ")
    .trim();
}

function cleanChineseSentence(value) {
  return String(value || "")
    .replace(/\s*,\s*/g, "，")
    .replace(/\s*;\s*/g, "；")
    .replace(/\s*:\s*/g, "：")
    .replace(/\s+—\s+/g, "，")
    .replace(/\s+and\s+/gi, "和")
    .replace(/\s+for\s+/gi, "用于")
    .replace(/\s+with\s+/gi, "包含")
    .replace(/\s+/g, " ")
    .replace(/ ([，。；：])/g, "$1")
    .replace(/([，。；：]) /g, "$1")
    .trim()
    .replace(/[.。]?$/, "。");
}

function hasUntranslatedEnglish(value) {
  const words = String(value || "").match(/[A-Za-z][A-Za-z-]{2,}/g) || [];
  return words.some((word) => !PRESERVED_ENGLISH_TERMS.has(word.replace(/^[a-z]/, (c) => c.toUpperCase())));
}

function knownStoreTranslation(text) {
  const normalized = normalizeSummaryText(text).toLowerCase();
  const known = [
    [/figma workflows.*design implementation.*code connect templates.*design system rule generation/i, "用于 Figma 设计落地流程，支持 Code Connect 模板和设计系统规则生成。"],
    [/control desktop apps on macos from codex through computer use/i, "通过 Computer Use 让 Codex 控制 macOS 桌面应用。"],
    [/analy[sz]e product usage.*investigate metric movements.*prepare kpi reports/i, "分析产品使用情况、排查指标变化、准备 KPI 报告，并生成高质量分析交付物。"],
    [/inspect repositories.*triage pull requests.*issues.*debug ci.*publish changes/i, "检查代码仓库、处理 PR 和 issue、调试 CI，并协助发布变更。"],
    [/inspect models.*datasets.*spaces.*research/i, "检索模型、数据集、Spaces 和研究资料，用于模型选型、数据调研和研究分析。"],
    [/create.*branded.*presentations?/i, "创建符合品牌规范的演示文稿，并支持从简报、提纲或设计链接生成内容。"],
    [/resize.*social media/i, "将设计稿调整为不同社交媒体规格，方便导出多平台素材。"],
    [/translate.*design/i, "翻译设计稿中的文本，并尽量保持原始版式。"],
    [/a runnable ai organization pack.*roster.*review gates.*execution roles.*modular presets/i, "一个可运行的 AI 组织协作包，包含成员编排、审查门禁、执行角色和模块化预设。"],
    [/opencode plugin.*multi-agent/i, "用于 OpenCode 的多智能体协作插件，帮助组织任务编排、审查和执行流程。"],
  ];
  const match = known.find(([pattern]) => pattern.test(normalized));
  return match ? match[1] : "";
}

function dictionaryStoreTranslation(text) {
  let zh = normalizeSummaryText(text);
  const phraseMap = [
    [/\bFigma workflows\b/gi, "Figma 工作流"],
    [/\bdesign implementation\b/gi, "设计落地"],
    [/\bCode Connect templates\b/gi, "Code Connect 模板"],
    [/\bdesign system rule generation\b/gi, "设计系统规则生成"],
    [/\bdesktop apps?\b/gi, "桌面应用"],
    [/\bfrom Codex through Computer Use\b/gi, "通过 Computer Use 由 Codex 执行"],
    [/\bproduct usage\b/gi, "产品使用情况"],
    [/\bmetric movements\b/gi, "指标变化"],
    [/\bKPI reports\b/gi, "KPI 报告"],
    [/\bpull requests?\b/gi, "PR"],
    [/\bissues\b/gi, "issue"],
    [/\bdebug CI\b/gi, "调试 CI"],
    [/\bpublish changes\b/gi, "发布变更"],
    [/\bresearch papers?\b/gi, "研究论文"],
    [/\bdatasets\b/gi, "数据集"],
    [/\bSpaces\b/g, "Spaces"],
    [/\bA runnable AI organization pack\b/i, "一个可运行的 AI 组织协作包"],
    [/\bAI organization pack\b/gi, "AI 组织协作包"],
    [/\bwith roster, review gates, execution roles, and modular presets\b/gi, "包含成员编排、审查门禁、执行角色和模块化预设"],
    [/\bthemed as\b/gi, "主题为"],
    [/\bPlugin for exporting\b/gi, "用于导出"],
    [/\bA plugin for\b/gi, "用于"],
    [/\bPlugin for\b/gi, "用于"],
    [/\bmacro to export\b/gi, "用于导出的宏"],
    [/\bOpenCode plugin\b/gi, "OpenCode 插件"],
    [/\bmulti-agent orchestration system\b/gi, "多智能体编排系统"],
    [/\bsource code documents\b/gi, "源代码文档"],
    [/\breview gates\b/gi, "审查门禁"],
    [/\bexecution roles\b/gi, "执行角色"],
    [/\bmodular presets\b/gi, "模块化预设"],
    [/\bcapability marketplace\b/gi, "能力市场"],
    [/\bworkflow system\b/gi, "工作流系统"],
    [/\btask orchestration\b/gi, "任务编排"],
    [/\bsource code\b/gi, "源代码"],
    [/\bworkflows?\b/gi, "工作流"],
    [/\btemplates?\b/gi, "模板"],
    [/\brule generation\b/gi, "规则生成"],
    [/\bimplementation\b/gi, "落地"],
    [/\banaly[sz]e\b/gi, "分析"],
    [/\binvestigate\b/gi, "排查"],
    [/\bprepare\b/gi, "准备"],
    [/\bbuild\b/gi, "生成"],
    [/\binspect\b/gi, "检查"],
    [/\btriage\b/gi, "处理"],
    [/\bcontrol\b/gi, "控制"],
    [/\bexporting\b/gi, "导出"],
    [/\bexport\b/gi, "导出"],
    [/\bdocuments?\b/gi, "文档"],
    [/\bsystems?\b/gi, "系统"],
    [/\bautomation\b/gi, "自动化"],
    [/\bdata\b/gi, "数据"],
    [/\bmodels?\b/gi, "模型"],
    [/\bprojects?\b/gi, "项目"],
    [/\bplugins?\b/gi, "插件"],
    [/\bskills?\b/gi, "技能"],
    [/\bagents?\b/gi, "智能体"],
    [/\brunnable\b/gi, "可运行的"],
    [/\borganization\b/gi, "组织"],
    [/\bpack\b/gi, "包"],
    [/\broster\b/gi, "成员名单"],
    [/\breview\b/gi, "审查"],
    [/\bgates\b/gi, "门禁"],
    [/\bexecution\b/gi, "执行"],
    [/\broles\b/gi, "角色"],
    [/\bpresets\b/gi, "预设"],
  ];
  for (const [pattern, replacement] of phraseMap) zh = zh.replace(pattern, replacement);
  zh = cleanChineseSentence(zh);
  return hasUntranslatedEnglish(zh) ? "" : zh;
}

function genericStoreTranslation(item, text) {
  const kind = STORE_KIND_LABELS[item.kind] || "扩展";
  const category = STORE_CATEGORY_LABELS[item.category] || "";
  const source = normalizeSummaryText(text);
  const focus = [];
  if (/figma|design|template|presentation/i.test(source)) focus.push("设计落地和模板生成");
  if (/github|repository|pull request|issue|ci|git/i.test(source)) focus.push("代码仓库、PR 和 CI 工作流");
  if (/data|metric|kpi|report|dashboard/i.test(source)) focus.push("数据分析、指标诊断和报告生成");
  if (/model|dataset|research|space/i.test(source)) focus.push("模型、数据集和研究资料检索");
  if (/desktop|macos|computer use|browser/i.test(source)) focus.push("本机应用或浏览器自动化");
  if (/agent|review|orchestration|workflow/i.test(source)) focus.push("智能体协作、审查和任务编排");
  const scope = focus.length ? focus.join("、") : `${category || "项目"}相关工作`;
  return `这个${kind}用于${scope}，帮助在 Hi Code 中完成对应工作流。`;
}

export function storeChineseSummary(item = {}) {
  const text = String(item.translatedSummary || item.summary || item.description || "").trim();
  if (!text) return "暂无简介。";
  const hasChinese = /[\u4e00-\u9fff]/.test(text);
  const hasEnglishWords = /[A-Za-z]{3,}/.test(text);
  if (hasChinese && !hasEnglishWords) return text;
  const translated = knownStoreTranslation(text) || dictionaryStoreTranslation(text) || genericStoreTranslation(item, text);
  return `中文说明：${cleanChineseSentence(translated)}`;
}

export function storeInstallActionState(item = {}) {
  if (!item.installed) return { installed: false, enabled: false, primary: "安装", secondary: "", destructive: "" };
  if (item.enabled === false) return { installed: true, enabled: false, primary: "启用", secondary: "已禁用", destructive: "卸载" };
  return { installed: true, enabled: true, primary: "禁用", secondary: "已安装", destructive: "卸载" };
}
