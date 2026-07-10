import { getState, setState } from "./state.js";
import { showRoute } from "./router.js";
import { createHiCodeApi } from "../api/hicode-api.js";
import { mountAiTeamPanel } from "../components/ai-team-panel.js";
import { diffStatusText, renderUnifiedDiff } from "../components/diff-viewer.js";
import { mountFileTree } from "../components/file-tree.js";
import { mountJobCenterPanel } from "../components/job-center-panel.js";
import { mountPatchArenaPanel } from "../components/patch-arena-panel.js";
import { mountIndustrialProjectPanel } from "../components/industrial-project-panel.js";
import { mountDomainPackPanel } from "../components/domain-pack-panel.js";
import { mountAgentTeamPanel } from "../components/agent-team-panel.js";
import { mountToolchainPanel } from "../components/toolchain-panel.js";
import { mountQualityGatePanel } from "../components/quality-gate-panel.js";
import { mountReleaseCenterPanel } from "../components/release-center-panel.js";
import { mountSampleProjectPanel } from "../components/sample-project-panel.js";
import { capabilityDescription, capabilityLifecycleState, capabilityMeta, CAPABILITY_META } from "../components/mcp-panel.js";
import { normalizeRuntimeQueue, summarizeRunText } from "../components/runtime-panel.js";
import { modelPickerSection, pickerRow } from "../components/settings-panel.js";
import { renderUsagePanel } from "../components/settings-usage-panel.js";
import { buildUserProfile } from "../utils/profile.js";
import { STORE_ACTION_LABELS, STORE_CATEGORY_LABELS, STORE_KIND_LABELS, STORE_PAGE_SIZE, storeChineseSummary, storeIcon, storeInstallActionState, storeQueryOptions as buildStoreQueryOptions } from "../components/store-panel.js";
import { createToastController } from "../components/toast.js";
import { $ } from "../utils/dom.js";
import { escapeHtml, formatDuration, shortPath } from "../utils/format.js";
import { parseJsonObject, validateQuickProfileFields } from "../utils/validation.js";

/* Hi Code renderer — Codex-like workspace UI. */
const SIDEBAR_COLLAPSED_KEY = "hicode.sidebarCollapsed";

export function bootstrapHiCode() {
if (!window.hicode) {
  const outputHandlers = [], readyHandlers = [], turnDoneHandlers = [], askHandlers = [], toolEventHandlers = [], diffsChangedHandlers = [], runtimeQueueHandlers = [];
  const sessions = [
    { id: "demo-1", firstPrompt: "优化 Hi Code 米白色工作台界面", updatedAt: Date.now() - 1000 * 60 * 12, messageCount: 8 },
    { id: "demo-2", firstPrompt: "检查 MCP 权限与文件沙箱", updatedAt: Date.now() - 1000 * 60 * 58, messageCount: 14 },
    { id: "demo-3", firstPrompt: "给 reviewer 加只读 bash", updatedAt: Date.now() - 1000 * 60 * 180, messageCount: 6 },
  ];
  let demoRuntimeSessionId = `demo-${Date.now()}`;
  let demoUser = null;

  function buildDemoUsageStats() {
    const heatmap = [];
    const today = Date.now();
    let lifetime = 0;
    let peak = 0;
    for (let offset = 370; offset >= 0; offset--) {
      const date = new Date(today - offset * 86_400_000);
      const key = date.toISOString().slice(0, 10);
      const tokens = offset % 11 === 0 ? 0 : Math.floor(1200 + Math.sin(offset / 7) * 800 + (offset % 5) * 400);
      lifetime += tokens;
      peak = Math.max(peak, tokens);
      const ratio = tokens <= 0 ? 0 : tokens / 2800;
      const level = tokens <= 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
      heatmap.push({ date: key, tokens, level });
    }
    return {
      ok: true,
      lifetimeTokens: lifetime,
      lifetimePromptTokens: Math.floor(lifetime * 0.72),
      lifetimeCompletionTokens: Math.floor(lifetime * 0.28),
      peakDayTokens: peak,
      peakDay: heatmap[heatmap.length - 1]?.date || "",
      longestTaskMs: 41 * 60 * 60 * 1000 + 35 * 60 * 1000,
      currentStreak: 12,
      longestStreak: 20,
      totalSessions: sessions.length,
      totalTurns: 48,
      heatmap,
      heatmapWeeks: Math.ceil(heatmap.length / 7),
      reasoningBreakdown: [{ level: "high", count: 42, pct: 88 }],
      currentReasoningLabel: "高 · 当前配置",
      topModels: [{ model: "deepseek-chat", tokens: Math.floor(lifetime * 0.6) }, { model: "kimi-k2", tokens: Math.floor(lifetime * 0.25) }],
      topTools: [{ tool: "bash", count: 61 }, { tool: "read", count: 35 }, { tool: "grep", count: 17 }],
      formatted: {
        lifetimeTokens: lifetime >= 1_000_000 ? `${(lifetime / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : `${Math.floor(lifetime / 1000)}K`,
        peakDayTokens: peak >= 1_000_000 ? `${(peak / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : `${Math.floor(peak / 1000)}K`,
        longestTask: "41h 35m",
        currentStreak: "12 天",
        longestStreak: "20 天",
      },
    };
  }

  const demoStore = [
    { id: "skill-playwright", kind: "skill", category: "browser", name: "Playwright UI 验证", summary: "驱动真实浏览器验证本地 UI。", tags: ["browser", "qa"], installed: false },
    { id: "skill-security-review", kind: "skill", category: "security", name: "代码安全审查", summary: "按威胁模型审查路径、命令、MCP、密钥和权限边界。", tags: ["security", "review"], installed: false },
    { id: "mcp-filesystem", kind: "mcp", category: "local", name: "Filesystem MCP", summary: "把当前项目目录暴露给 MCP 工具。", tags: ["mcp", "filesystem"], installed: false },
    { id: "mcp-github", kind: "mcp", category: "git", name: "GitHub MCP", summary: "连接 GitHub issue、PR、repo 上下文。", tags: ["mcp", "github", "git"], installed: false },
    { id: "agent-reviewer", kind: "agent", category: "code", name: "Reviewer Agent", summary: "只读代码审查员，检查风险和测试缺口。", tags: ["agent", "review"], installed: false },
    { id: "agent-architect", kind: "agent", category: "code", name: "Architect Agent", summary: "负责拆任务、定边界、做方案和验收标准。", tags: ["agent", "architecture"], installed: false },
    { id: "plugin-git-workflow", kind: "plugin", category: "git", name: "Git 工作流套件", summary: "提供 diff、stage、commit、PR 能力。", tags: ["plugin", "git"], installed: false },
    { id: "plugin-data-analytics", kind: "plugin", category: "data", name: "数据分析套件", summary: "面向报表、仪表盘、KPI 分析的数据工作流。", tags: ["plugin", "data"], installed: false },
  ];
  const demoFiles = {
    "/demo/hicode-project": [
      { name: "src", path: "/demo/hicode-project/src", dir: true },
      { name: "renderer", path: "/demo/hicode-project/renderer", dir: true },
      { name: "package.json", path: "/demo/hicode-project/package.json", dir: false },
      { name: "README.md", path: "/demo/hicode-project/README.md", dir: false },
    ],
    "/demo/hicode-project/src": [
      { name: "agent.ts", path: "/demo/hicode-project/src/agent.ts", dir: false },
      { name: "runtime.ts", path: "/demo/hicode-project/src/runtime.ts", dir: false },
      { name: "tools", path: "/demo/hicode-project/src/tools", dir: true },
    ],
    "/demo/hicode-project/renderer": [
      { name: "index.html", path: "/demo/hicode-project/renderer/index.html", dir: false },
      { name: "renderer.js", path: "/demo/hicode-project/renderer/renderer.js", dir: false },
      { name: "style.css", path: "/demo/hicode-project/renderer/style.css", dir: false },
    ],
  };
  const demoEvents = [
    {
      id: "evt-demo-1",
      type: "tool:start",
      tool: "read_file",
      title: "Read src/runtime.ts",
      summary: "src/runtime.ts",
      status: "done",
      createdAt: Date.now() - 1000 * 60 * 3,
    },
    {
      id: "evt-demo-2",
      type: "diff:created",
      tool: "edit_file",
      title: "Changed renderer/renderer.js",
      summary: "renderer/renderer.js",
      status: "done",
      path: "renderer/renderer.js",
      diffId: "diff-demo-1",
      createdAt: Date.now() - 1000 * 80,
    },
  ];
  let demoDiffs = [
    {
      id: "diff-demo-1",
      sessionId: "demo",
      turnId: "demo-turn-1",
      path: "renderer/renderer.js",
      absPath: "/demo/hicode-project/renderer/renderer.js",
      before: "function renderWorkbench() {\n  return \"chat only\";\n}\n",
      after: "function renderWorkbench() {\n  return \"timeline + diff\";\n}\n",
      status: "pending",
      tool: "edit_file",
      createdAt: Date.now() - 1000 * 80,
    },
  ];
  let demoJobs = [
    {
      schemaVersion: 1,
      id: "demo-job-runtime",
      title: "优化 Hi Code 工作台",
      status: "running",
      source: "runtime_queue",
      trigger: "demo",
      actor: "user",
      executor: "hicode-runtime",
      createdAt: Date.now() - 1000 * 60 * 12,
      updatedAt: Date.now() - 1000 * 40,
      startedAt: Date.now() - 1000 * 60 * 11,
      retryCount: 0,
      tasks: [
        {
          id: "demo-task-1",
          title: "整理 renderer 架构",
          status: "running",
          createdAt: Date.now() - 1000 * 60 * 12,
          startedAt: Date.now() - 1000 * 60 * 11,
          executor: "hicode-runtime",
          steps: [
            { id: "demo-step-1", title: "读取当前前端入口", status: "succeeded", artifacts: [], gateResults: [] },
            { id: "demo-step-2", title: "生成 diff 和测试", status: "running", artifacts: ["demo-artifact-1"], gateResults: [] },
          ],
          artifacts: ["demo-artifact-1"],
          gateResults: [],
        },
      ],
      artifacts: [
        {
          id: "demo-artifact-1",
          type: "diff",
          name: "renderer diff",
          path: "/demo/hicode-project/renderer/renderer.js",
          createdAt: Date.now() - 1000 * 80,
        },
      ],
      events: [
        { id: "demo-job-evt-1", jobId: "demo-job-runtime", type: "job.created", message: "Job created from runtime_queue", createdAt: Date.now() - 1000 * 60 * 12, status: "queued" },
        { id: "demo-job-evt-2", jobId: "demo-job-runtime", type: "runtime.tool:start", message: "Read renderer/renderer.js", createdAt: Date.now() - 1000 * 60 * 8, actor: "read_file" },
        { id: "demo-job-evt-3", jobId: "demo-job-runtime", type: "runtime.diff:created", message: "Changed renderer/renderer.js", createdAt: Date.now() - 1000 * 80, actor: "edit_file" },
      ],
      gateResults: [
        { id: "demo-gate-1", gate: "renderer syntax", status: "passed", createdAt: Date.now() - 1000 * 70, message: "node --check renderer/renderer.js passed", artifacts: ["demo-artifact-1"] },
      ],
      approvals: [],
    },
    {
      schemaVersion: 1,
      id: "demo-job-failed",
      title: "运行失败的测试任务",
      status: "failed",
      source: "test",
      trigger: "demo",
      actor: "tester",
      executor: "npm",
      createdAt: Date.now() - 1000 * 60 * 45,
      updatedAt: Date.now() - 1000 * 60 * 43,
      startedAt: Date.now() - 1000 * 60 * 44,
      endedAt: Date.now() - 1000 * 60 * 43,
      error: "npm test exited with code 1",
      retryCount: 0,
      tasks: [],
      artifacts: [],
      events: [
        { id: "demo-job-failed-evt-1", jobId: "demo-job-failed", type: "job.status", message: "running -> failed", createdAt: Date.now() - 1000 * 60 * 43, status: "failed" },
      ],
      gateResults: [
        { id: "demo-gate-failed", gate: "feature tests", status: "failed", createdAt: Date.now() - 1000 * 60 * 43, message: "1 failing assertion", artifacts: [] },
      ],
      approvals: [],
    },
  ];
  const demoProviders = [
    { id: "hicode-internal", name: "Hi Code Internal", status: "enabled" },
    { id: "codex-cli", name: "Codex CLI", status: "not_configured" },
    { id: "claude-code", name: "Claude Code", status: "not_configured" },
  ];
  let demoArenaRuns = [
    {
      schemaVersion: 1,
      id: "demo-arena-1",
      title: "Patch Arena renderer smoke",
      task: "拆分并验证 renderer 面板",
      status: "ready",
      providerIds: ["hicode-internal"],
      createdAt: Date.now() - 1000 * 60 * 20,
      updatedAt: Date.now() - 1000 * 60 * 10,
      actor: "user",
      sourcePath: "/demo/hicode-project",
      jobId: "demo-job-runtime",
      decisions: [],
      artifacts: [],
      candidates: [
        {
          id: "demo-candidate-1",
          runId: "demo-arena-1",
          providerId: "hicode-internal",
          providerName: "Hi Code Internal",
          status: "ready",
          createdAt: Date.now() - 1000 * 60 * 20,
          updatedAt: Date.now() - 1000 * 60 * 10,
          patch: {
            path: "/demo/hicode-data/patch-arena/artifacts/demo/changes.patch",
            changedFiles: ["renderer/components/patch-arena-panel.js"],
            summary: "1 changed file",
          },
          score: { total: 92, gatesPassed: 4, gatesFailed: 0, riskyFiles: 0, securitySensitiveFiles: 0, changedFiles: 1, notes: [] },
          gateResults: [
            { id: "demo-arena-gate-1", gate: "syntax check", status: "passed", message: "1 JavaScript file passed", createdAt: Date.now() - 1000 * 60 * 11 },
            { id: "demo-arena-gate-2", gate: "changed files summary", status: "passed", message: "renderer/components/patch-arena-panel.js", createdAt: Date.now() - 1000 * 60 * 11 },
          ],
          artifacts: [
            { type: "patch", path: "/demo/hicode-data/patch-arena/artifacts/demo/changes.patch", name: "changes.patch", size: 128 },
            { type: "gate-results", path: "/demo/hicode-data/patch-arena/artifacts/demo/gate-results.json", name: "gate-results.json", size: 256 },
          ],
          logs: ["created copy sandbox", "command exited with 0", "collected patch"],
          riskNotes: [],
        },
      ],
    },
  ];
  let demoIndustrialProject = {
    schemaVersion: 1,
    projectId: "demo-industrial-project",
    name: "Demo 工业研发项目",
    type: "industrial_workbench",
    domains: ["software", "mechanical", "electrical", "documentation", "qa"],
    requirements: [
      { id: "REQ-001", title: "追踪关键交付物", status: "active", createdAt: Date.now() - 1000 * 60 * 30, updatedAt: Date.now() - 1000 * 60 * 20 },
    ],
    artifacts: [
      { id: "ART-001", type: "source_code", name: "Hi Code desktop app", path: "src/", domain: "software", status: "active", requirementIds: ["REQ-001"], designIds: [], testIds: [], releaseTargetIds: [], createdAt: Date.now() - 1000 * 60 * 28, updatedAt: Date.now() - 1000 * 60 * 18 },
    ],
    qualityGates: [
      { id: "GATE-001", type: "test", name: "Feature tests", status: "passed", artifactIds: ["ART-001"], requirementIds: ["REQ-001"], releaseTargetIds: [], message: "67 passed", createdAt: Date.now() - 1000 * 60 * 18, updatedAt: Date.now() - 1000 * 60 * 18 },
    ],
    toolchain: [],
    standards: [],
    releaseTargets: [],
    traceability: [
      { id: "TRACE-001", relation: "requirement_design", fromType: "requirement", fromId: "REQ-001", toType: "design", toId: "DES-001", createdAt: Date.now() - 1000 * 60 * 18 },
    ],
    events: [],
    createdAt: Date.now() - 1000 * 60 * 30,
    updatedAt: Date.now() - 1000 * 60 * 18,
  };
  const demoIndustrialSchema = {
    ok: true,
    domains: ["software", "mechanical", "cad", "solidworks", "pcb", "plc", "bim", "architecture", "process_chemical", "energy", "materials", "electrical", "automation", "manufacturing", "documentation", "qa"],
    artifactTypes: ["source_code", "requirement_doc", "architecture_doc", "test_plan", "cad_model", "drawing", "step_file", "stl_file", "pcb_project", "schematic", "layout", "gerber", "bom", "plc_program", "io_map", "wiring_diagram", "ifc_model", "pid_diagram", "simulation_report", "material_spec", "inspection_report", "release_package"],
    gateTypes: ["build", "test", "lint", "security", "cad_validation", "pcb_erc", "pcb_drc", "plc_compile", "bim_check", "process_safety", "energy_simulation", "documentation_review", "human_approval"],
  };
  const demoQualityGates = [
    { id: "software.npm_build", name: "npm build", type: "command_gate", category: "software", severity: "high", description: "Run npm build before release.", remediation: { summary: "Fix build errors.", steps: ["Read stderr.", "Rerun gate."] } },
    { id: "software.syntax_check", name: "syntax check", type: "command_gate", category: "software", severity: "high", description: "Run JavaScript/Electron syntax checks.", remediation: { summary: "Fix syntax errors.", steps: ["Run syntax check.", "Rerun gate."] } },
    { id: "software.security_sensitive_file_changed", name: "security sensitive file changed", type: "security_gate", category: "security", severity: "high", description: "Warn on sensitive file changes.", remediation: { summary: "Review security-sensitive diffs.", steps: ["Inspect IPC and preload.", "Record approval."] } },
    { id: "cad.artifact_exists", name: "CAD artifact exists", type: "file_exists_gate", category: "cad", severity: "high", description: "CAD model artifact must exist.", artifactPaths: [".hicode/artifacts/freecad/control-box.FCStd"], remediation: { summary: "Generate or attach CAD artifact.", steps: ["Run FreeCAD adapter.", "Attach evidence."] } },
    { id: "pcb.gerber_exists", name: "Gerber exists", type: "artifact_integrity_gate", category: "pcb", severity: "high", description: "Gerber output must exist.", artifactPaths: [".hicode/artifacts/kicad/gerbers"], remediation: { summary: "Export Gerber package.", steps: ["Run KiCad flow.", "Review DRC."] } },
    { id: "plc.safety_interlock_documented", name: "safety interlock documented", type: "documentation_gate", category: "plc", severity: "critical", description: "PLC safety interlock documentation must be present.", artifactPaths: [".hicode/artifacts/plc/safety-interlocks.md"], remediation: { summary: "Document safety interlocks.", steps: ["Include emergency stop.", "Require human approval."] } },
    { id: "bim.code_check_manual_approval", name: "code check manual approval", type: "human_approval_gate", category: "approval", severity: "critical", description: "Building code checks require manual approval.", requiresApproval: true, remediation: { summary: "Record manual code-check approval.", steps: ["Attach reviewer identity.", "Do not claim automated compliance."] } },
  ];
  let demoDomainPacks = ["software-product", "mechanical-cad", "pcb-eda", "plc-automation"].map((id) => ({
    manifest: {
      id,
      name: id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
      version: "1.0.0",
      domains: id === "pcb-eda" ? ["pcb", "electrical", "qa"] : id === "plc-automation" ? ["plc", "automation", "electrical", "qa"] : id === "mechanical-cad" ? ["mechanical", "cad", "manufacturing", "qa"] : ["software", "documentation", "qa"],
      description: "Demo Domain Pack manifest for browser-only fallback.",
      standards: [{ id: `${id}-std-1`, name: "Reference standard profile", version: "current", domains: ["software"] }],
      templates: [{ id: `${id}-template-1`, name: "Requirement Template", type: "requirement_doc", path: "templates/requirements.md", content: "# Requirement\n" }],
      checklists: [{ id: `${id}-checklist-1`, name: "Release Checklist", type: "release", path: "checklists/release.md", items: ["Requirement approved", "Gate evidence recorded"] }],
      toolRequirements: [{ id: `${id}-tool-1`, name: "External tool", type: "external_tool", required: false, domains: ["software"], dryRunSupported: true, permissions: ["explicit_user_approval_required"] }],
      qualityGates: [{ id: `${id}-gate-1`, name: "Documentation review", type: "documentation_review", required: true, automated: false }],
      agentProfiles: [{ id: `${id}-reviewer`, name: "Domain Reviewer", role: "domain_reviewer", domains: ["software"], instructions: ["Review pack artifacts."], permissions: ["read_project"] }],
      sampleProjects: [`samples/${id}`],
    },
    source: "builtin",
    installed: id === "software-product",
    enabled: id === "software-product",
    recommended: id === "software-product" || id === "mechanical-cad",
  }));
  const demoAgentProfiles = [
    { id: "product-manager", name: "Product Manager", role: "product-manager", domains: ["software", "documentation"], responsibilities: [{ description: "Clarify requirements and approvals." }] },
    { id: "system-architect", name: "System Architect", role: "system-architect", domains: ["software", "pcb", "plc"], responsibilities: [{ description: "Plan architecture and dependencies." }] },
    { id: "fullstack-engineer", name: "Fullstack Engineer", role: "fullstack-engineer", domains: ["software"], responsibilities: [{ description: "Prepare software implementation path." }] },
    { id: "qa-engineer", name: "QA Engineer", role: "qa-engineer", domains: ["qa"], responsibilities: [{ description: "Plan verification." }] },
    { id: "pcb-engineer", name: "PCB Engineer", role: "pcb-engineer", domains: ["pcb", "electrical"], responsibilities: [{ description: "Plan schematic, layout, Gerber, ERC/DRC." }] },
  ];
  let demoAgentPlans = [];
  const demoFreeCadCapabilityNames = {
    drawing_placeholder_plan: "Drawing Plan",
  };
  const demoFreeCadCapabilities = ["parametric_part_generation", "enclosure_generation", "step_export", "stl_export", "basic_geometry_check", "drawing_placeholder_plan"].map((id) => ({
    id,
    name: demoFreeCadCapabilityNames[id] || id.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    artifactTypes: id === "step_export" ? ["step_file"] : id === "stl_export" ? ["stl_file"] : id === "drawing_placeholder_plan" ? ["drawing"] : ["cad_model"],
    qualityGates: ["cad_validation"],
    dryRunSupported: true,
    requiresInstalledTool: !["basic_geometry_check", "drawing_placeholder_plan"].includes(id),
  }));
  const demoKiCadCapabilities = ["project_inspection", "schematic_check", "pcb_drc", "gerber_export", "drill_export", "bom_export_plan"].map((id) => ({
    id,
    name: id.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    artifactTypes: id.includes("gerber") || id.includes("drill") ? ["gerber"] : id.includes("bom") ? ["bom"] : ["inspection_report"],
    qualityGates: id === "schematic_check" ? ["pcb_erc"] : id === "pcb_drc" ? ["pcb_drc"] : ["documentation_review"],
    dryRunSupported: true,
    requiresInstalledTool: !["project_inspection", "bom_export_plan"].includes(id),
  }));
  const demoPlcCapabilities = ["structured_text_generation", "io_map_generation", "plc_project_scaffold", "syntax_check_plan", "fat_sat_checklist", "safety_review_required"].map((id) => ({
    id,
    name: id.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    artifactTypes: id.includes("io_map") ? ["io_map"] : id.includes("checklist") ? ["test_plan"] : id.includes("structured_text") || id.includes("scaffold") ? ["plc_program"] : ["inspection_report"],
    qualityGates: id.includes("syntax") ? ["plc_compile"] : id.includes("safety") ? ["human_approval"] : ["documentation_review"],
    dryRunSupported: true,
    requiresInstalledTool: id.includes("syntax"),
  }));
  const demoBimCapabilities = ["ifc_inspection", "element_count", "space_count", "property_extract", "clash_check_plan", "code_check_checklist", "bim_delivery_checklist"].map((id) => ({
    id,
    name: id.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    artifactTypes: id.includes("delivery") ? ["release_package"] : id.includes("ifc") ? ["ifc_model", "inspection_report"] : ["inspection_report"],
    qualityGates: id.includes("code") ? ["human_approval"] : ["bim_check", "documentation_review"],
    dryRunSupported: true,
    requiresInstalledTool: ["ifc_inspection", "element_count", "space_count", "property_extract"].includes(id),
  }));
  const demoSolidWorksCapabilities = ["part_generation_bridge", "assembly_generation_bridge", "drawing_export_bridge", "step_export_bridge", "bom_export_bridge", "macro_generation", "external_execution_required"].map((id) => ({
    id,
    name: id.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    artifactTypes: id.includes("drawing") ? ["drawing"] : id.includes("step") ? ["step_file"] : id.includes("bom") ? ["bom"] : id.includes("macro") ? ["architecture_doc"] : ["cad_model"],
    qualityGates: ["cad_validation", "human_approval"],
    dryRunSupported: true,
    requiresInstalledTool: !["macro_generation", "external_execution_required"].includes(id),
  }));
  const demoAvevaCapabilities = ["engineering_data_exchange_plan", "tag_list_import_export_plan", "equipment_list_import_export_plan", "piping_line_list_plan", "document_register_plan", "change_sync_plan", "external_connector_required"].map((id) => ({
    id,
    name: id.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    artifactTypes: id.includes("document") ? ["release_package"] : id.includes("piping") ? ["pid_diagram", "inspection_report"] : ["inspection_report"],
    qualityGates: ["process_safety", "documentation_review", "human_approval"],
    dryRunSupported: true,
    requiresInstalledTool: id === "external_connector_required",
  }));
  const demoToolchainAdapters = ["freecad", "kicad", "openplc", "ifcopenshell", "solidworks", "altium", "revit", "codesys", "twincat", "aveva"].map((id) => ({
    adapter: {
      id,
      name: id === "freecad" ? "FreeCAD" : id === "openplc" ? "OpenPLC / IEC 61131-3" : id === "ifcopenshell" ? "IfcOpenShell / IFC" : id === "solidworks" ? "SolidWorks Bridge" : id === "aveva" ? "AVEVA Engineering Bridge" : id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
      vendor: "Demo",
      kind: ["solidworks", "altium", "revit", "codesys", "twincat", "aveva"].includes(id) ? "commercial" : "open-source",
      domains: id === "kicad" ? ["pcb", "electrical"] : id.includes("plc") || id === "codesys" || id === "twincat" ? ["plc", "automation"] : id === "ifcopenshell" || id === "revit" ? ["bim", "architecture"] : id === "aveva" ? ["process_chemical", "energy", "manufacturing"] : ["mechanical", "cad"],
      capabilities: id === "freecad" ? demoFreeCadCapabilities : id === "kicad" ? demoKiCadCapabilities : id === "openplc" ? demoPlcCapabilities : id === "ifcopenshell" ? demoBimCapabilities : id === "solidworks" ? demoSolidWorksCapabilities : id === "aveva" ? demoAvevaCapabilities : [{ id: `${id}-dry-run`, name: "Dry-run planning", artifactTypes: ["inspection_report"], qualityGates: ["documentation_review"], dryRunSupported: true }],
    },
    detection: { adapterId: id, toolName: id === "freecad" ? "FreeCAD" : id === "kicad" ? "KiCad" : id === "openplc" ? "OpenPLC / IEC 61131-3" : id === "ifcopenshell" ? "IfcOpenShell / IFC" : id === "solidworks" ? "SolidWorks Bridge" : id === "aveva" ? "AVEVA Engineering Bridge" : id, installed: false, reason: id === "solidworks" ? "unsupported_platform: SolidWorks bridge requires Windows and a licensed local installation." : id === "aveva" ? "No AVEVA enterprise connector profile is configured in browser demo." : `${id} not detected in browser demo.`, setupHint: id === "freecad" ? "Install FreeCAD and expose FreeCADCmd/freecadcmd." : id === "kicad" ? "Install KiCad and expose kicad-cli." : id === "openplc" ? "Install OpenPLC/MATIEC and expose iec2c/openplc." : id === "ifcopenshell" ? "Install IfcOpenShell Python module and expose python3." : id === "solidworks" ? "Use Windows with licensed SolidWorks; generate bridge package only in demo." : id === "aveva" ? "Configure enterprise-approved AVEVA connector profile; never enter passwords in demo." : "Install the tool and expose command or env var.", diagnostics: [{ severity: "warning", code: id === "solidworks" ? "solidworks.unsupported_platform" : id === "aveva" ? "aveva.connection.not_configured" : "tool.missing", message: id === "solidworks" ? "unsupported_platform" : id === "aveva" ? "not configured" : "not installed" }] },
  }));
  const demoToolRequirements = [{ source: "domain-pack", packId: "pcb-eda", id: "eda-tool", name: "EDA tool", domains: ["pcb"], dryRunSupported: true }];
  const buildDemoReleaseReadiness = (version = "0.5.0") => {
    const gateResults = demoIndustrialProject.qualityGates.map((gate) => ({
      id: `project-${gate.id}`,
      gateId: gate.id,
      name: gate.name,
      status: gate.status,
      source: "industrial_project",
      severity: gate.status === "failed" || gate.status === "requires_approval" ? "blocking" : gate.status === "passed" ? "info" : "warning",
      message: gate.message || "",
      artifactLinks: gate.artifactIds || [],
      createdAt: gate.updatedAt,
      metadata: { demo: true },
    }));
    const artifacts = demoIndustrialProject.artifacts || [];
    const simulatedGates = gateResults.filter((gate) => gate.status === "simulated");
    const risks = [
      ...gateResults.filter((gate) => ["failed", "requires_approval", "simulated", "not_run", "warning"].includes(gate.status)).map((gate) => ({
        id: `demo-risk-${gate.gateId}`,
        severity: gate.status === "failed" || gate.status === "requires_approval" ? "blocking" : "warning",
        title: `Gate ${gate.status}`,
        message: `${gate.name}: ${gate.status}`,
        source: "gate",
        relatedId: gate.gateId,
      })),
      ...artifacts.filter((artifact) => artifact.metadata?.simulated).map((artifact) => ({
        id: `demo-risk-${artifact.id}-simulated`,
        severity: "warning",
        title: "Simulated artifact",
        message: `${artifact.name} is simulated demo output.`,
        source: "artifact",
        relatedId: artifact.id,
      })),
    ];
    const gateSummary = gateResults.reduce((summary, gate) => {
      summary.total += 1;
      summary[gate.status] = (summary[gate.status] || 0) + 1;
      return summary;
    }, { total: 0 });
    return {
      ready: !risks.some((risk) => risk.severity === "blocking"),
      version: version || "0.5.0",
      releasePath: `/demo/hicode-project/releases/${version || "0.5.0"}`,
      project: { projectId: demoIndustrialProject.projectId, name: demoIndustrialProject.name, type: demoIndustrialProject.type, domains: demoIndustrialProject.domains },
      gateSummary,
      artifactSummary: { total: artifacts.length, included: artifacts.length, missing: 0, simulated: artifacts.filter((artifact) => artifact.metadata?.simulated).length },
      approvals: demoIndustrialProject.events.filter((event) => /approval/i.test(event.type)).map((event) => ({ id: event.id, status: event.data?.status || "recorded", scope: event.data?.requirementId || event.type, decidedBy: event.actor, source: "industrial_project" })),
      blockers: risks.filter((risk) => risk.severity === "blocking"),
      warnings: risks.filter((risk) => risk.severity !== "blocking"),
      risks,
      simulatedGates,
      missingArtifacts: [],
      gateResults,
    };
  };
  let demoConfig = {
    defaultProfile: "default",
    profiles: {
      default: {
        name: "default",
        baseURL: "https://api.deepseek.com/v1",
        apiKey: "",
        model: "deepseek-chat",
        contextWindow: 65536,
        temperature: 0.2,
      },
    },
    compactThreshold: 0.75,
    reasoningLevel: "medium",
    sandbox: false,
    mcpServers: {},
  };
  window.hicode = {
    onOutput: (cb) => outputHandlers.push(cb),
    onReady: (cb) => {
      readyHandlers.push(cb);
      const p = demoConfig.profiles[demoConfig.defaultProfile] || demoConfig.profiles.default;
      setTimeout(() => cb({ model: p.model, baseURL: p.baseURL, cwd: "/demo/hicode-project", sessionId: demoRuntimeSessionId }), 20);
    },
    onAsk: (cb) => askHandlers.push(cb),
    onTurnDone: (cb) => turnDoneHandlers.push(cb),
    onToolEvent: (cb) => toolEventHandlers.push(cb),
    onDiffsChanged: (cb) => diffsChangedHandlers.push(cb),
    onRuntimeQueue: (cb) => runtimeQueueHandlers.push(cb),
    send: (text) => {
      const now = Date.now();
      const evt = {
        id: `evt-demo-${now}`,
        type: "tool:start",
        tool: text.startsWith("/") ? "command" : "grep",
        title: text.startsWith("/") ? `Run ${text}` : "Grep project context",
        summary: text,
        status: "running",
        createdAt: now,
      };
      demoEvents.push(evt);
      toolEventHandlers.forEach((cb) => cb(evt));
      const lines = text.startsWith("/")
        ? [`执行 ${text}`, "读取项目上下文...", "完成。"]
        : ["我会先查看相关文件，然后给出最小修改。", "", "⏺ read_file  src/runtime.ts", "  │ 128\tasync function handleInput(input: string): Promise<void> {", "", "建议：保留权限确认、收紧文件边界，并在界面中展示工具活动。"];
      let i = 0;
      const tick = () => {
        if (i < lines.length) {
          outputHandlers.forEach((cb) => cb(lines[i++] + "\n"));
          setTimeout(tick, 80);
        } else {
          evt.status = "done";
          evt.updatedAt = Date.now();
          toolEventHandlers.forEach((cb) => cb({ ...evt, type: "tool:done" }));
          diffsChangedHandlers.forEach((cb) => cb([...demoDiffs]));
          turnDoneHandlers.forEach((cb) => cb());
        }
      };
      setTimeout(tick, 80);
    },
    answer: () => {},
    interrupt: () => turnDoneHandlers.forEach((cb) => cb()),
    clearRuntimeQueue: async () => {
      runtimeQueueHandlers.forEach((cb) => cb({ running: null, queued: [] }));
      return { ok: true, count: 0 };
    },
    listToolEvents: async () => demoEvents,
    listRecoverableTasks: async () => [
      {
        id: "demo-recovery-1",
        sessionId: "demo-1",
        turnId: "demo-1-turn-1",
        title: "Run npm test",
        summary: "模型输出中断，可以从原会话安全重试",
        status: "error",
        retryInput: "!npm test",
        phase: "streaming",
        recoveryAction: "retry_turn",
        canRetry: true,
        requiresApproval: false,
        reason: "模型输出中断，可以从原会话安全重试",
        createdAt: Date.now() - 1000 * 60 * 7,
        updatedAt: Date.now() - 1000 * 60 * 7,
        durationMs: 12_400,
      },
    ],
    listDiffs: async () => demoDiffs,
    acceptDiff: async (id) => {
      const diff = demoDiffs.find((x) => x.id === id);
      if (diff) diff.status = "accepted";
      diffsChangedHandlers.forEach((cb) => cb([...demoDiffs]));
      return { ok: true, diff };
    },
    rejectDiff: async (id) => {
      const diff = demoDiffs.find((x) => x.id === id);
      if (diff) diff.status = "rejected";
      diffsChangedHandlers.forEach((cb) => cb([...demoDiffs]));
      return { ok: true, diff };
    },
    acceptAllDiffs: async () => {
      let count = 0;
      for (const diff of demoDiffs) {
        if (diff.status === "pending") {
          diff.status = "accepted";
          count++;
        }
      }
      diffsChangedHandlers.forEach((cb) => cb([...demoDiffs]));
      return { ok: true, count };
    },
    rejectAllDiffs: async () => {
      let count = 0;
      for (const diff of demoDiffs) {
        if (diff.status === "pending") {
          diff.status = "rejected";
          count++;
        }
      }
      diffsChangedHandlers.forEach((cb) => cb([...demoDiffs]));
      return { ok: true, count };
    },
    clearArchivedDiffs: async () => {
      const before = demoDiffs.length;
      demoDiffs = demoDiffs.filter((diff) => diff.status === "pending");
      diffsChangedHandlers.forEach((cb) => cb([...demoDiffs]));
      return { ok: true, count: before - demoDiffs.length };
    },
    gitStatus: async () => ({
      ok: true,
      root: "/demo/hicode-project",
      branch: "main",
      ahead: 0,
      behind: 0,
      dirty: 2,
      staged: 1,
      unstaged: 1,
      untracked: 0,
      files: [
        { path: "renderer/renderer.js", status: "M", index: "M", worktree: " ", staged: true, unstaged: false, untracked: false },
        { path: "renderer/style.css", status: "M", index: " ", worktree: "M", staged: false, unstaged: true, untracked: false },
      ],
    }),
    gitDiff: async ({ path, staged }) => ({
      ok: true,
      diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@\n- old line\n+ ${staged ? "staged" : "worktree"} change`,
    }),
    gitStage: async () => ({ ok: true }),
    gitUnstage: async () => ({ ok: true }),
    gitCommitMessage: async () => ({ ok: true, message: "Update Hi Code workspace" }),
    gitCommit: async () => ({ ok: true, hash: "demo123", output: "Committed demo123" }),
    pickFolder: async () => "/demo/hicode-project",
    getCwd: async () => "/demo/hicode-project",
    listDir: async (dir) => demoFiles[dir || "/demo/hicode-project"] || [],
    readFile: async (p) => ({ path: p, content: `// ${p}\n\nexport function demo() {\n  return "Hi Code";\n}\n` }),
    listSessions: async () => sessions,
    resumeSession: async () => [
      { role: "user", text: "优化 Hi Code 米白色工作台界面" },
      { role: "assistant", text: "已切换到米白色工作台，并保留会话、命令、权限与文件预览。" },
    ],
    newSession: async () => {
      demoRuntimeSessionId = `demo-${Date.now()}`;
      const p = demoConfig.profiles[demoConfig.defaultProfile] || demoConfig.profiles.default;
      readyHandlers.forEach((cb) => cb({ model: p.model, baseURL: p.baseURL, cwd: "/demo/hicode-project", sessionId: demoRuntimeSessionId }));
      return { ok: true, sessionId: demoRuntimeSessionId };
    },
    readSession: async (id) => (id === "demo-1"
      ? [
        { role: "user", text: "优化 Hi Code 米白色工作台界面" },
        { role: "assistant", text: "已切换到米白色工作台，并保留会话、命令、权限与文件预览。" },
      ]
      : [{ role: "user", text: "hello" }, { role: "assistant", text: "你好，有什么可以帮你？" }]),
    deleteSession: async () => true,
    getConfig: async () => JSON.stringify(demoConfig, null, 2),
	    saveConfig: async (text) => {
      try {
        demoConfig = JSON.parse(text);
        const p = demoConfig.profiles?.[demoConfig.defaultProfile] || demoConfig.profiles?.default || {};
        readyHandlers.forEach((cb) => cb({
          model: p.model || "model",
          baseURL: p.baseURL || "",
          cwd: "/demo/hicode-project",
          capabilities: modelCapabilityHint(p),
        }));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || "invalid JSON" };
      }
    },
	    testModel: async (profile = {}) => ({ ok: true, message: "连接成功", capabilities: modelCapabilityHint(profile) }),
    getAppInfo: async () => ({ ok: true, version: "0.0.0-demo", electron: "-", chrome: "-", node: "-", platform: "browser", arch: "-", dataDir: "~/.hicode", configPath: "~/.hicode/config.json", repoUrl: "https://github.com/mc7yxyyq96-sketch/hi-code", license: "MIT" }),
    openDataDir: async () => ({ ok: false, error: "浏览器演示模式无法打开本地目录。" }),
    revealConfigFile: async () => ({ ok: false, error: "浏览器演示模式无法定位本地文件。" }),
    openAppPage: async () => ({ ok: false, error: "浏览器演示模式无法打开外部链接。" }),
    checkUpdates: async () => ({ ok: false, error: "浏览器演示模式无法检查更新。" }),
    getUsageStats: async () => buildDemoUsageStats(),
    authStatus: async () => ({ user: demoUser }),
    register: async ({ email, name }) => {
      demoUser = { email, name: name || email.split("@")[0] };
      return { ok: true, user: demoUser };
    },
    login: async ({ email }) => {
      demoUser = { email, name: email.split("@")[0] };
      return { ok: true, user: demoUser };
    },
    logout: async () => {
      demoUser = null;
      return { ok: true };
    },
    listCapabilities: async () => ({
      plugins: [
        { name: "github", description: "仓库、Issue、PR 与代码协作", status: "installed", source: "~/.codex/plugins/cache" },
        { name: "notion", description: "文档、知识库与任务管理", status: "installed", source: "~/.codex/plugins/cache" },
        { name: "data-analytics", description: "报告、仪表盘与数据分析", status: "installed", source: "~/.codex/plugins/cache" },
      ],
      skills: [
        { name: "playwright", description: "用真实浏览器验证 UI 流程", path: "~/.codex/skills/playwright/SKILL.md", status: "available" },
        { name: "openai-docs", description: "查询 OpenAI 官方产品文档", path: "~/.codex/skills/.system/openai-docs/SKILL.md", status: "available" },
        { name: "codex-security:security-scan", description: "仓库级安全扫描", path: "~/.codex/plugins/cache/...", status: "available" },
      ],
      mcp: [
        { name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], status: "configured", envCount: 0 },
      ],
      agents: [
        { name: "Reviewer Agent", role: "reviewer", description: "只读代码审查员", status: "installed", source: "Hi Code Store" },
      ],
    }),
    listStore: async (options = {}) => {
      const query = String(options.query || "").trim().toLowerCase();
      const items = demoStore.filter((item) => {
        if (!query) return true;
        const haystack = [item.id, item.kind, item.category, item.name, item.summary, ...(item.tags || [])].join(" ").toLowerCase();
        return query.split(/\s+/).every((term) => haystack.includes(term));
      });
      return {
      sourceId: "all",
      source: { id: "all", name: "全部源", region: "All", note: "聚合内置、本机 Codex 和国内镜像。" },
      sources: [
        { id: "all", name: "全部源", region: "All", note: "聚合内置、本机 Codex、国内镜像和 GitHub。" },
        { id: "builtin-cn", name: "内置源（中国友好）", region: "CN", note: "NPM 类安装使用 npmmirror。" },
        { id: "codex-local", name: "本机 Codex 缓存", region: "Local", note: "扫描 ~/.codex 中的 Skills 和 Plugins。" },
        { id: "npm-mirror", name: "NPM MCP 镜像", region: "CN", note: "从 npmmirror 搜索 MCP server 包。" },
        { id: "gitee-mirror", name: "Gitee 镜像源", region: "CN", note: "预留国内镜像 catalog。" },
        { id: "github-search", name: "GitHub 搜索源", region: "Global", note: "搜索 GitHub 仓库并下载 zip。" },
        { id: "github-cn", name: "GitHub 国内代理", region: "CN", note: "搜索 GitHub，下载时优先使用国内代理。" },
        { id: "github-catalog", name: "GitHub Catalog", region: "Global", note: "官方 raw catalog。" },
      ],
        query,
        totalItems: demoStore.length,
        filteredItems: items.length,
        items,
      };
    },
    setStoreSource: async () => ({ ok: true }),
    previewStoreItem: async (id) => {
      const item = demoStore.find((x) => x.id === id);
      if (!item) return { ok: false, error: "商店条目不存在" };
      const base = `/demo/hicode-data/store/${item.kind}s/${item.id}`;
      const changes = item.kind === "mcp"
        ? [{ action: "write", target: "~/.hicode/config.json", detail: `新增或覆盖 mcpServers.${item.id.replace(/^mcp-/, "")}` }]
        : [{ action: "write", target: `${base}/manifest.json`, detail: `安装 ${item.kind} 配置` }];
      return {
        ok: true,
        preview: {
          item,
          source: { id: "builtin-cn", name: "内置源（中国友好）", region: "CN" },
          changes,
          permissions: [
            item.kind === "mcp" ? "允许 Hi Code 配置并启动 stdio MCP。" : "允许 Hi Code 写入本地商店目录。",
            "安装后可在对应能力页中查看和使用。",
          ],
          warnings: item.id === "mcp-github" ? ["需要安装后配置 GITHUB_TOKEN。"] : [],
          env: item.id === "mcp-github" ? [{ key: "GITHUB_TOKEN", required: true }] : [],
          restartRequired: item.kind === "mcp",
        },
      };
    },
    installStoreItem: async (id) => {
      const item = demoStore.find((x) => x.id === id);
      if (item) {
        item.installed = true;
        item.enabled = true;
      }
      return { ok: true, item };
    },
    getStoreItem: async (id) => {
      const item = demoStore.find((x) => x.id === id);
      return item ? { ok: true, item, detail: { translatedSummary: storeChineseSummary(item), installedRecord: item.installed ? { enabled: item.enabled !== false } : null } } : { ok: false, error: "商店条目不存在" };
    },
    enableStoreItem: async (id) => {
      const item = demoStore.find((x) => x.id === id);
      if (item) {
        item.installed = true;
        item.enabled = true;
      }
      return item ? { ok: true, item } : { ok: false, error: "商店条目不存在" };
    },
    disableStoreItem: async (id) => {
      const item = demoStore.find((x) => x.id === id);
      if (item) item.enabled = false;
      return item ? { ok: true, item } : { ok: false, error: "商店条目不存在" };
    },
    uninstallStoreItem: async (id) => {
      const item = demoStore.find((x) => x.id === id);
      if (item) {
        item.installed = false;
        item.enabled = false;
      }
      return item ? { ok: true, item } : { ok: false, error: "商店条目不存在" };
    },
    listJobs: async () => ({ ok: true, jobs: [...demoJobs].sort((a, b) => b.updatedAt - a.updatedAt) }),
    getJob: async (id) => {
      const job = demoJobs.find((item) => item.id === id);
      return job ? { ok: true, job } : { ok: false, error: "job not found" };
    },
    cancelJob: async (id) => updateDemoJob(id, "cancelled"),
    retryJob: async (id) => updateDemoJob(id, "queued", { retry: true }),
    pauseJob: async (id) => updateDemoJob(id, "paused"),
    resumeJob: async (id) => updateDemoJob(id, "queued"),
    listJobEvents: async (id) => ({ ok: true, events: demoJobs.find((item) => item.id === id)?.events || [] }),
    listJobArtifacts: async (id) => ({ ok: true, artifacts: demoJobs.find((item) => item.id === id)?.artifacts || [] }),
    previewJobArtifact: async (_jobId, artifactId) => {
      const artifact = demoJobs.flatMap((job) => job.artifacts || []).find((item) => item.id === artifactId);
      if (!artifact) return { ok: false, error: "artifact not found" };
      return { ok: true, artifact, content: `Preview: ${artifact.path}\n\nDemo artifact content.` };
    },
    openJobArtifact: async () => ({ ok: true }),
    listProviders: async () => ({ ok: true, providers: demoProviders }),
    listArenaRuns: async () => ({ ok: true, runs: [...demoArenaRuns].sort((a, b) => b.updatedAt - a.updatedAt) }),
    getArenaRun: async (id) => {
      const run = demoArenaRuns.find((item) => item.id === id);
      return run ? { ok: true, run } : { ok: false, error: "arena run not found" };
    },
    createArenaRun: async ({ task, providerIds = ["hicode-internal"], command = "" } = {}) => {
      const runId = `demo-arena-${Date.now()}`;
      const candidateId = `demo-candidate-${Date.now()}`;
      const patchPath = `/demo/hicode-data/patch-arena/artifacts/${runId}/changes.patch`;
      const run = {
        schemaVersion: 1,
        id: runId,
        title: task || "Patch Arena run",
        task: task || "Patch Arena run",
        status: "ready",
        providerIds,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        actor: "user",
        sourcePath: "/demo/hicode-project",
        decisions: [],
        artifacts: [],
        candidates: providerIds.map((providerId) => ({
          id: `${candidateId}-${providerId}`,
          runId,
          providerId,
          providerName: demoProviders.find((provider) => provider.id === providerId)?.name || providerId,
          status: "ready",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          patch: { path: patchPath, changedFiles: [".hicode/arena/summary.md"], summary: "1 changed file" },
          score: { total: 90, gatesPassed: 3, gatesFailed: 0, riskyFiles: 0, securitySensitiveFiles: 0, changedFiles: 1, notes: command ? [`command: ${command}`] : [] },
          gateResults: [{ id: `demo-gate-${Date.now()}`, gate: "changed files summary", status: "passed", message: "1 changed file", createdAt: Date.now() }],
          artifacts: [{ type: "patch", path: patchPath, name: "changes.patch", size: 128 }],
          logs: ["demo candidate executed", command || "default internal command"],
          riskNotes: [],
        })),
      };
      demoArenaRuns.unshift(run);
      return { ok: true, run };
    },
    acceptArenaCandidate: async (runId, candidateId) => updateDemoArenaDecision(runId, candidateId, "accepted"),
    rejectArenaCandidate: async (runId, candidateId) => {
      const result = updateDemoArenaDecision(runId, candidateId, "rejected");
      if (result.ok) result.candidate.status = "rejected";
      return result;
    },
    mergeArenaCandidate: async (runId, candidateId) => {
      const result = updateDemoArenaDecision(runId, candidateId, "merged");
      if (result.ok) {
        result.candidate.status = "merged";
        result.run.status = "merged";
      }
      return result;
    },
    previewArenaArtifact: async (_runId, _candidateId, artifactPath) => ({
      ok: true,
      path: artifactPath,
      content: `diff --git a/.hicode/arena/summary.md b/.hicode/arena/summary.md\n+++ b/.hicode/arena/summary.md\n@@\n+Demo Patch Arena artifact\n`,
    }),
    openArenaArtifact: async () => ({ ok: true }),
    getIndustrialProjectSchema: async () => demoIndustrialSchema,
    getIndustrialProject: async () => ({ ok: true, project: demoIndustrialProject, path: "/demo/hicode-project/.hicode/project.json" }),
    validateIndustrialProject: async (payload) => ({ ok: !!payload?.name, errors: payload?.name ? [] : ["name is required"], project: payload }),
    buildIndustrialRequirementDraft: async ({ text = "", domain = "", priority = "" } = {}) => {
      const requirementId = `REQ-DEMO-${Date.now()}`;
      const draft = {
        id: requirementId,
        requirementId,
        title: text.split(/[。.!?\n]/)[0] || "Demo requirement",
        description: text || "Demo requirement",
        domain: domain || demoIndustrialProject.domains[0] || "software",
        priority: priority || "medium",
        acceptanceCriteria: ["Requirement is traceable.", "Artifact plan is generated.", "Test plan is generated."],
        linkedArtifacts: [],
        linkedTests: [],
        riskLevel: priority === "critical" ? "critical" : "medium",
        approvalRequired: priority === "critical",
      };
      return { ok: true, draft };
    },
    addIndustrialRequirement: async (payload = {}) => {
      const requirement = {
        id: payload.requirementId || `REQ-DEMO-${Date.now()}`,
        requirementId: payload.requirementId || `REQ-DEMO-${Date.now()}`,
        title: payload.title || "Demo requirement",
        description: payload.description || "",
        domain: payload.domain || "software",
        status: "draft",
        priority: payload.priority || "medium",
        acceptanceCriteria: payload.acceptanceCriteria || [],
        linkedArtifacts: payload.linkedArtifacts || [],
        linkedTests: payload.linkedTests || [],
        riskLevel: payload.riskLevel || "medium",
        approvalRequired: payload.approvalRequired === true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      demoIndustrialProject.requirements.push(requirement);
      demoIndustrialProject.updatedAt = Date.now();
      return { ok: true, project: demoIndustrialProject, requirement };
    },
    updateIndustrialRequirementCriteria: async ({ requirementId, acceptanceCriteria = [] } = {}) => {
      const requirement = demoIndustrialProject.requirements.find((item) => item.requirementId === requirementId || item.id === requirementId);
      if (!requirement) return { ok: false, error: "requirement not found" };
      requirement.acceptanceCriteria = acceptanceCriteria;
      requirement.updatedAt = Date.now();
      demoIndustrialProject.updatedAt = Date.now();
      return { ok: true, project: demoIndustrialProject, requirement };
    },
    generateIndustrialArtifactPlan: async ({ requirementId } = {}) => {
      const requirement = demoIndustrialProject.requirements.find((item) => item.requirementId === requirementId || item.id === requirementId);
      if (!requirement) return { ok: false, error: "requirement not found" };
      const artifact = {
        id: `${requirementId}-artifact-plan`,
        type: "requirement_doc",
        name: `${requirement.title} artifact plan`,
        path: `.hicode/generated/requirements/${requirementId}/artifact-plan.md`,
        domain: requirement.domain,
        status: "draft",
        requirementIds: [requirementId],
        designIds: [],
        testIds: [],
        releaseTargetIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      demoIndustrialProject.artifacts.push(artifact);
      requirement.linkedArtifacts = [...new Set([...(requirement.linkedArtifacts || []), artifact.id])];
      return { ok: true, project: demoIndustrialProject, requirement, generated: [{ name: "artifact-plan.md", relativePath: artifact.path }] };
    },
    generateIndustrialTestPlan: async ({ requirementId } = {}) => {
      const requirement = demoIndustrialProject.requirements.find((item) => item.requirementId === requirementId || item.id === requirementId);
      if (!requirement) return { ok: false, error: "requirement not found" };
      requirement.linkedTests = [...new Set([...(requirement.linkedTests || []), `${requirementId}-test-1`])];
      return { ok: true, project: demoIndustrialProject, requirement, generated: [{ name: "test-plan-outline.md", relativePath: `.hicode/generated/requirements/${requirementId}/test-plan-outline.md` }] };
    },
    generateIndustrialSpecPackage: async ({ requirementId } = {}) => ({ ok: true, project: demoIndustrialProject, generated: ["prd.md", "system-specification.md", "architecture-outline.md", "artifact-plan.md", "test-plan-outline.md", "release-checklist.md"].map((name) => ({ name, relativePath: `.hicode/generated/requirements/${requirementId}/${name}` })) }),
    approveIndustrialRequirement: async ({ requirementId } = {}) => ({ ok: true, project: demoIndustrialProject, approval: { id: `approval-${Date.now()}`, status: "approved", scope: `requirement:${requirementId}` } }),
    listDomainPacks: async () => ({ ok: true, packs: demoDomainPacks }),
    getDomainPack: async (packId) => {
      const pack = demoDomainPacks.find((item) => item.manifest.id === packId);
      return pack ? { ok: true, pack } : { ok: false, error: "domain pack not found" };
    },
    validateDomainPack: async (payload = {}) => ({ ok: !!(payload.manifest?.id || payload.id), errors: payload.manifest?.id || payload.id ? [] : ["id is required"], manifest: payload.manifest || payload }),
    installDomainPack: async ({ id } = {}) => {
      const pack = demoDomainPacks.find((item) => item.manifest.id === id);
      if (!pack) return { ok: false, error: "domain pack not found" };
      pack.installed = true;
      return { ok: true, pack, jobId: `demo-domain-pack-job-${Date.now()}` };
    },
    updateDomainPack: async (payload = {}) => window.hicode.installDomainPack(payload),
    enableDomainPack: async (packId) => {
      const pack = demoDomainPacks.find((item) => item.manifest.id === packId);
      if (!pack || !pack.installed) return { ok: false, error: "domain pack must be installed first" };
      pack.enabled = true;
      const existing = new Set(demoIndustrialProject.metadata?.domainPacks?.enabled || []);
      existing.add(packId);
      demoIndustrialProject.metadata = { ...(demoIndustrialProject.metadata || {}), domainPacks: { enabled: Array.from(existing), templates: pack.manifest.templates, checklists: pack.manifest.checklists } };
      demoIndustrialProject.qualityGates = [...demoIndustrialProject.qualityGates, ...pack.manifest.qualityGates.map((gate) => ({ id: `${packId}-${gate.id}`, type: gate.type, name: gate.name, status: "pending", artifactIds: [], requirementIds: [], releaseTargetIds: [], message: "Domain Pack gate", createdAt: Date.now(), updatedAt: Date.now() }))];
      return { ok: true, pack, project: demoIndustrialProject, jobId: `demo-domain-pack-job-${Date.now()}` };
    },
    disableDomainPack: async (packId) => {
      const pack = demoDomainPacks.find((item) => item.manifest.id === packId);
      if (!pack) return { ok: false, error: "domain pack not found" };
      pack.enabled = false;
      return { ok: true, pack, project: demoIndustrialProject, jobId: `demo-domain-pack-job-${Date.now()}` };
    },
    uninstallDomainPack: async (packId) => {
      const pack = demoDomainPacks.find((item) => item.manifest.id === packId);
      if (!pack) return { ok: false, error: "domain pack not found" };
      pack.installed = false;
      pack.enabled = false;
      return { ok: true, id: packId, jobId: `demo-domain-pack-job-${Date.now()}` };
    },
    recommendDomainPacks: async () => ({ ok: true, packs: demoDomainPacks.filter((pack) => pack.recommended) }),
    listAgentProfiles: async () => ({ ok: true, profiles: demoAgentProfiles }),
    getAgentProfile: async (profileId) => {
      const profile = demoAgentProfiles.find((item) => item.id === profileId);
      return profile ? { ok: true, profile } : { ok: false, error: "agent profile not found" };
    },
    createAgentPlan: async ({ task = "Plan project" } = {}) => {
      const domains = demoIndustrialProject.domains || ["software", "qa"];
      const includePcb = domains.includes("pcb") || /pcb|gerber|erc|drc/i.test(task);
      const tasks = [demoAgentProfiles[0], demoAgentProfiles[1], demoAgentProfiles[2], ...(includePcb ? [demoAgentProfiles[4]] : []), demoAgentProfiles[3]].map((profile, index) => ({
        id: `agent-task-${profile.id}`,
        agentId: profile.id,
        agentName: profile.name,
        role: profile.role,
        title: `${profile.name}: plan work`,
        status: "waiting_approval",
        executionGroup: index + 1,
        parallelGroup: `group-${index + 1}`,
        dependsOn: index ? ["product-manager"] : [],
        input: { task, projectType: demoIndustrialProject.type, domains, domainPackIds: demoDomainPacks.filter((pack) => pack.enabled).map((pack) => pack.manifest.id), dependsOn: [], context: {} },
        output: { summary: `${profile.name} output contract`, artifacts: ["requirement_doc"], reviewResult: "pending", notes: [] },
        expectedArtifacts: ["requirement_doc"],
        qualityGates: ["documentation_review"],
        reviewChecklist: [{ id: `${profile.id}-review`, title: "Review checklist", items: ["Traceable output"], required: true }],
        reviewResult: "pending",
        humanApprovalRequired: true,
      }));
      const plan = {
        id: `demo-agent-plan-${Date.now()}`,
        title: task,
        task,
        projectType: demoIndustrialProject.type,
        domains,
        domainPackIds: demoDomainPacks.filter((pack) => pack.enabled).map((pack) => pack.manifest.id),
        executionMode: "hybrid",
        tasks,
        reviewChain: tasks.map((item) => item.agentId),
        qualityGates: ["documentation_review", "human_approval"],
        humanApprovalPoints: ["Approve multi-agent plan before execution"],
        expectedArtifacts: ["requirement_doc", "test_plan", "release_package"],
        route: { patchArena: domains.includes("software"), patchArenaRequest: { task, providerIds: ["hicode-internal"], mode: "auto", reason: "demo" }, industrialPlan: includePcb, artifactPlan: ["requirement_doc"], checklistPlan: ["release checklist"], toolRunPlan: [] },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        actor: "user",
        source: "agent-team",
      };
      demoAgentPlans.unshift(plan);
      return { ok: true, plan, profiles: demoAgentProfiles };
    },
    listAgentPlans: async () => ({ ok: true, plans: demoAgentPlans }),
    getAgentPlan: async (planId) => {
      const plan = demoAgentPlans.find((item) => item.id === planId);
      return plan ? { ok: true, plan } : { ok: false, error: "agent plan not found" };
    },
    createMultiAgentJob: async ({ planId } = {}) => {
      const plan = demoAgentPlans.find((item) => item.id === planId) || demoAgentPlans[0];
      if (!plan) return { ok: false, error: "agent plan not found" };
      const job = { id: `demo-agent-job-${Date.now()}`, status: "waiting_approval", tasks: plan.tasks, artifacts: [], events: [] };
      return { ok: true, plan, job, artifacts: [{ name: "agent-plan.json" }], patchArenaRequest: plan.route.patchArenaRequest || null };
    },
    listToolchainAdapters: async () => ({ ok: true, adapters: demoToolchainAdapters, toolRequirements: demoToolRequirements, jobId: `demo-tool-detect-${Date.now()}` }),
    detectToolchainAdapter: async (adapterId) => {
      const item = demoToolchainAdapters.find((entry) => entry.adapter.id === adapterId);
      return item ? { ok: true, detection: item.detection, jobId: `demo-tool-detect-${Date.now()}` } : { ok: false, error: "adapter not found" };
    },
    getToolchainCapabilities: async (adapterId) => ({ ok: true, capabilities: demoToolchainAdapters.find((entry) => entry.adapter.id === adapterId)?.adapter.capabilities || [] }),
    validateToolchainAdapter: async (payload = {}) => ({ ok: !!(payload.adapter?.id || payload.id), errors: payload.adapter?.id || payload.id ? [] : ["adapter.id is required"], adapter: payload.adapter || payload }),
    runToolchainAdapter: async ({ adapterId, task = "Dry-run tool plan", mode = "dry-run" } = {}) => {
      const item = demoToolchainAdapters.find((entry) => entry.adapter.id === adapterId);
      if (!item) return { ok: false, error: "adapter not found" };
      const demoWorkspacePath = cwd || "/demo/hicode-project";
      if (adapterId === "freecad" && mode === "execute") {
        return { ok: false, error: "Browser demo cannot execute FreeCADCmd. Use the Electron app with FreeCAD installed, or run dry-run." };
      }
      if (adapterId === "kicad" && mode === "execute") {
        return { ok: false, error: "Browser demo cannot execute kicad-cli. Use the Electron app with KiCad installed, or run dry-run." };
      }
      if (adapterId === "openplc" && mode === "execute") {
        return { ok: false, error: "Browser demo cannot execute iec2c/openplc. Use the Electron app with OpenPLC/MATIEC installed, or generate a dry-run PLC draft." };
      }
      if (adapterId === "ifcopenshell" && mode === "execute") {
        return { ok: false, error: "Browser demo cannot execute Python/IfcOpenShell. Use the Electron app with IfcOpenShell installed, or run dry-run." };
      }
      if (adapterId === "solidworks" && mode === "execute") {
        return { ok: false, error: "Browser demo cannot execute SolidWorks COM/API bridges. Generate a bridge package and run it manually in a licensed Windows environment." };
      }
      if (adapterId === "aveva" && mode === "execute") {
        return { ok: false, error: "Browser demo cannot connect to AVEVA. Configure an approved enterprise connector outside demo, or run dry-run." };
      }
      const artifacts = adapterId === "freecad"
        ? ["freecad-run-plan.md", "expected-input.json", "expected-artifacts.json"].map((name) => ({ id: `demo-tool-artifact-${name}`, type: name.endsWith(".md") ? "freecad-dry-run-plan" : "freecad-dry-run-json", name, path: `${demoWorkspacePath}/.hicode/artifacts/freecad/dry-run-demo/${name}`, simulated: true }))
        : adapterId === "kicad"
          ? ["kicad-run-plan.md", "expected-input.json", "expected-artifacts.json", "command-preview.sh"].map((name) => ({ id: `demo-tool-artifact-${name}`, type: name.endsWith(".sh") ? "kicad-command-preview" : name.endsWith(".md") ? "kicad-dry-run-plan" : "kicad-dry-run-json", name, path: `${demoWorkspacePath}/.hicode/artifacts/kicad/dry-run-demo/${name}`, simulated: true }))
          : adapterId === "openplc"
            ? ["plc-program.st", "io-map.csv", "safety-interlocks.md", "fat-checklist.md", "sat-checklist.md", "metadata.json", "plc-compile-plan.md", "command-preview.sh", "expected-artifacts.json"].map((name) => ({ id: `demo-tool-artifact-${name}`, type: name.endsWith(".st") ? "plc_program" : name === "io-map.csv" ? "io_map" : name.includes("checklist") ? "test_plan" : name.endsWith(".sh") ? "plc-command-preview" : "inspection_report", name, path: `${demoWorkspacePath}/.hicode/artifacts/plc/openplc-dry-run-demo/${name}`, simulated: ["plc-compile-plan.md", "command-preview.sh", "expected-artifacts.json"].includes(name) }))
            : adapterId === "ifcopenshell"
              ? ["ifc-check-plan.md", "expected-input.json", "expected-artifacts.json", "command-preview.sh", "bim-delivery-checklist.md", "metadata.json"].map((name) => ({ id: `demo-tool-artifact-${name}`, type: name.includes("checklist") ? "bim-delivery-checklist" : name.endsWith(".sh") ? "bim-command-preview" : "inspection_report", name, path: `${demoWorkspacePath}/.hicode/artifacts/bim/ifc-dry-run-demo/${name}`, simulated: true }))
              : adapterId === "solidworks"
                ? ["solidworks-run-plan.md", "solidworks-bridge-plan.md", "macro-template.bas", "expected-artifacts.json", "manual-setup.md", "metadata.json"].map((name) => ({ id: `demo-tool-artifact-${name}`, type: name.endsWith(".bas") ? "solidworks-macro-template" : name.endsWith(".md") ? "solidworks-bridge-doc" : "inspection_report", name, path: `${demoWorkspacePath}/.hicode/artifacts/solidworks/bridge-package/${name}`, simulated: true, metadata: { generated: true, simulated: true, external_required: true } }))
                : adapterId === "aveva"
                  ? ["aveva-integration-plan.md", "data-exchange-schema.json", "tag-list-template.csv", "equipment-list-template.csv", "line-list-template.csv", "document-register-template.csv", "sync-risk-checklist.md", "metadata.json"].map((name) => ({ id: `demo-tool-artifact-${name}`, type: name.endsWith(".csv") ? "aveva-template" : name.includes("checklist") ? "aveva-risk-checklist" : "inspection_report", name, path: `${demoWorkspacePath}/.hicode/artifacts/aveva/integration-plan/${name}`, simulated: true, metadata: { generated: true, simulated: true, external_required: true, manual_approval_required: true } }))
        : [{ id: `demo-tool-artifact-${Date.now()}`, type: "industrial-tool-dry-run", name: `${adapterId}-dry-run.json`, path: `${demoWorkspacePath}/.hicode/generated/tool-adapters/${adapterId}/${adapterId}-dry-run.json`, simulated: true }];
      return {
        ok: true,
        jobId: `demo-tool-run-${Date.now()}`,
        result: {
          ok: true,
          adapterId,
          mode: "dry-run",
          simulated: true,
          summary: `${item.adapter.name} dry-run generated.`,
          commandPreview: [adapterId, "--dry-run", "--task", task],
          artifacts,
          diagnostics: [{ severity: "info", message: "Dry-run only; no real industrial tool execution." }],
          detection: item.detection,
        },
      };
    },
    listQualityGates: async () => ({ ok: true, gates: demoQualityGates }),
    runQualityGate: async ({ gateId, artifactPaths = [], changedFiles = [], schemaValue } = {}) => {
      const gate = demoQualityGates.find((item) => item.id === gateId) || demoQualityGates[0];
      const status = gate.type === "human_approval_gate"
        ? "requires_approval"
        : gate.type === "security_gate" && changedFiles.some((file) => /electron|preload|package|security/i.test(file))
          ? "warning"
          : gate.type === "adapter_gate"
            ? "simulated"
            : "passed";
      const now = Date.now();
      const result = {
        gateId: gate.id,
        gateName: gate.name,
        type: gate.type,
        status,
        severity: gate.severity,
        message: status === "passed" ? `${gate.name} passed in browser demo.` : `${gate.name}: ${status}`,
        remediation: gate.remediation,
        evidence: {
          gateId: gate.id,
          status,
          command: gate.type === "command_gate" ? gate.name : undefined,
          adapter: undefined,
          startedAt: now - 120,
          endedAt: now,
          stdoutSummary: gate.type === "command_gate" ? "demo command output" : "",
          stderrSummary: "",
          artifactLinks: artifactPaths.length ? artifactPaths : gate.artifactPaths || [],
          remediation: gate.remediation,
          manualApprovalRequired: status === "requires_approval",
          metadata: { demo: true, changedFiles, schemaValue },
        },
      };
      return { ok: true, run: { id: `demo-gate-run-${now}`, gateId: gate.id, status, startedAt: now - 120, endedAt: now, result }, result, jobId: `demo-quality-gate-job-${now}` };
    },
    approveQualityGate: async ({ gateId = "bim.code_check_manual_approval", approved = true, reason = "" } = {}) => {
      const gate = demoQualityGates.find((item) => item.id === gateId) || demoQualityGates.find((item) => item.type === "human_approval_gate");
      const now = Date.now();
      const status = approved ? "passed" : "failed";
      const result = {
        gateId: gate.id,
        gateName: gate.name,
        type: gate.type,
        status,
        severity: gate.severity,
        message: approved ? "Human approval recorded in browser demo." : "Human approval rejected in browser demo.",
        remediation: gate.remediation,
        evidence: {
          gateId: gate.id,
          status,
          startedAt: now - 80,
          endedAt: now,
          stdoutSummary: "",
          stderrSummary: "",
          artifactLinks: [],
          remediation: gate.remediation,
          manualApprovalRequired: !approved,
          metadata: { demo: true, reason },
        },
      };
      return { ok: true, run: { id: `demo-gate-run-${now}`, gateId: gate.id, status, startedAt: now - 80, endedAt: now, result }, result, jobId: `demo-quality-gate-job-${now}` };
    },
    getReleaseReadiness: async ({ version = "0.5.0" } = {}) => ({ ok: true, readiness: buildDemoReleaseReadiness(version || "0.5.0") }),
    buildReleasePackage: async ({ version = "0.5.0", createdBy = "demo-user" } = {}) => {
      const now = Date.now();
      const readiness = buildDemoReleaseReadiness(version || "0.5.0");
      if (!readiness.ready) return { ok: false, error: readiness.blockers.map((item) => item.message).join("; "), readiness };
      const releasePackage = {
        schemaVersion: 1,
        releaseId: `demo-release-${now}`,
        version: readiness.version,
        projectId: demoIndustrialProject.projectId,
        releasePath: readiness.releasePath,
        manifestPath: `${readiness.releasePath}/release-manifest.json`,
        notesPath: `${readiness.releasePath}/release-notes.md`,
        evidenceReportPath: `${readiness.releasePath}/evidence-report.md`,
        checksumPath: `${readiness.releasePath}/checksums.sha256`,
        readiness,
        artifacts: [
          { id: "source-code", type: "source_code", name: "Demo source snapshot", category: "source_code", relativePath: "artifacts/source-code" },
          { id: "project-docs", type: "documentation", name: "Demo docs", category: "architecture_doc", relativePath: "docs/project-docs" },
        ],
        checksums: { "release-manifest.json": "demo-checksum" },
        manifest: {
          schemaVersion: 1,
          releaseId: `demo-release-${now}`,
          projectId: demoIndustrialProject.projectId,
          version: readiness.version,
          createdAt: new Date(now).toISOString(),
          createdBy,
          sourceCommit: null,
          includedArtifacts: [],
          gateResults: readiness.gateResults,
          approvals: readiness.approvals,
          knownRisks: readiness.risks,
          checksums: { "release-manifest.json": "demo-checksum" },
        },
      };
      demoIndustrialProject.artifacts.push({ id: `REL-${now}`, type: "release_package", name: `Release ${readiness.version}`, path: `releases/${readiness.version}/release-manifest.json`, status: "released", requirementIds: [], designIds: [], testIds: [], releaseTargetIds: [], createdAt: now, updatedAt: now });
      return { ok: true, jobId: `demo-release-job-${now}`, releasePackage, readiness };
    },
    openReleasePackage: async ({ releasePath, version = "0.5.0" } = {}) => ({ ok: true, releasePath: releasePath || `/demo/hicode-project/releases/${version}` }),
    saveIndustrialProject: async ({ name, type, domains = [] } = {}) => {
      demoIndustrialProject = {
        ...demoIndustrialProject,
        name: name || demoIndustrialProject.name,
        type: type || demoIndustrialProject.type,
        domains: domains.length ? domains : demoIndustrialProject.domains,
        updatedAt: Date.now(),
      };
      return { ok: true, project: demoIndustrialProject, path: "/demo/hicode-project/.hicode/project.json" };
    },
    addIndustrialArtifact: async ({ type, name, path: artifactPath, domain } = {}) => {
      const artifact = {
        id: `ART-${Date.now()}`,
        type: type || "source_code",
        name: name || "artifact",
        path: artifactPath || "",
        domain: domain || undefined,
        status: "draft",
        requirementIds: [],
        designIds: [],
        testIds: [],
        releaseTargetIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      demoIndustrialProject.artifacts.push(artifact);
      demoIndustrialProject.updatedAt = Date.now();
      return { ok: true, project: demoIndustrialProject, artifact };
    },
    addIndustrialTraceability: async ({ fromType, fromId, toType, toId } = {}) => {
      const traceability = {
        id: `TRACE-${Date.now()}`,
        relation: `${fromType}_${toType}`.replace("requirement_design", "requirement_design").replace("design_artifact", "design_artifact").replace("artifact_test", "artifact_test").replace("test_release_gate", "test_release_gate"),
        fromType,
        fromId,
        toType,
        toId,
        createdAt: Date.now(),
      };
      demoIndustrialProject.traceability.push(traceability);
      demoIndustrialProject.updatedAt = Date.now();
      return { ok: true, project: demoIndustrialProject, traceability };
    },
    addIndustrialGateResult: async ({ type, name, status, message } = {}) => {
      const gate = {
        id: `GATE-${Date.now()}`,
        type: type || "test",
        name: name || type || "gate",
        status: status || "pending",
        artifactIds: [],
        requirementIds: [],
        releaseTargetIds: [],
        message: message || "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      demoIndustrialProject.qualityGates.push(gate);
      demoIndustrialProject.updatedAt = Date.now();
      return { ok: true, project: demoIndustrialProject, gate };
    },
	  };

  function updateDemoJob(id, status, options = {}) {
    const job = demoJobs.find((item) => item.id === id);
    if (!job) return { ok: false, error: "job not found" };
    job.status = status;
    job.updatedAt = Date.now();
    if (status === "queued") {
      job.endedAt = undefined;
      job.error = undefined;
    }
    if (options.retry) job.retryCount = (job.retryCount || 0) + 1;
    job.events.push({
      id: `demo-job-evt-${Date.now()}`,
      jobId: id,
      type: `job.${status}`,
      message: `Demo job is ${status}`,
      createdAt: Date.now(),
      status,
    });
    return { ok: true, job };
  }

  function updateDemoArenaDecision(runId, candidateId, decision) {
    const run = demoArenaRuns.find((item) => item.id === runId);
    if (!run) return { ok: false, error: "arena run not found" };
    const candidate = run.candidates.find((item) => item.id === candidateId);
    if (!candidate) return { ok: false, error: "arena candidate not found" };
    const record = { id: `demo-decision-${Date.now()}`, runId, candidateId, decision, actor: "user", createdAt: Date.now(), patchPath: candidate.patch?.path, result: { ok: true } };
    run.decisions.push(record);
    run.updatedAt = Date.now();
    return { ok: true, run, candidate, decision: record };
  }
}

const appState = getState();
const toast = createToastController();
const api = createHiCodeApi(window.hicode, { onError: (message) => toast.error(message) });
const syncState = (patch) => {
  setState(patch);
  return appState;
};

const auth = $("auth"), appRoot = $("app");
const authTitle = $("authTitle"), authForm = $("authForm"), authStatus = $("authStatus");
const authName = $("authName"), authEmail = $("authEmail"), authPassword = $("authPassword"), nameField = $("nameField");
const loginTab = $("loginTab"), registerTab = $("registerTab"), authSubmit = $("authSubmit");
const userName = $("userName"), userEmail = $("userEmail"), userInitial = $("userInitial"), userBadge = $("userBadge");
const main = $("main"), home = $("home"), chatview = $("chatview"), chat = $("chat");
const homeSlot = $("homeSlot"), chatSlot = $("chatSlot");
const greeting = $("greeting"), sessionsEl = $("sessions"), searchInput = $("search");
const projName = $("projName"), modelSide = $("modelNameSide"), appVersionEl = $("appVersion");
const askBox = $("ask"), askQ = $("ask-q");
const runStatus = $("runStatus"), runStatusDot = $("runStatusDot"), runStatusText = $("runStatusText"), runStatusMeta = $("runStatusMeta"), runStatusDetail = $("runStatusDetail");
const timelineList = $("timelineList");
const timelineDrawerBtn = $("timelineDrawerBtn"), diffDrawerBtn = $("diffDrawerBtn"), workbenchDrawerBackdrop = $("workbenchDrawerBackdrop");
const recoveryPanel = $("recoveryPanel"), recoveryList = $("recoveryList"), recoveryRefresh = $("recoveryRefresh");
const diffList = $("diffList"), diffView = $("diffView"), diffSummary = $("diffSummary");
const diffAccept = $("diffAccept"), diffReject = $("diffReject");
const diffAcceptAll = $("diffAcceptAll"), diffRejectAll = $("diffRejectAll"), diffHistory = $("diffHistory"), diffClear = $("diffClear");
const settings = $("settings"), cfg = $("cfg"), cfgErr = $("cfg-err");
const currentProject = $("currentProject");
const filesModal = $("files"), filePath = $("filePath"), fileList = $("fileList"), filePreview = $("filePreview");
const capabilityView = $("capabilityView"), capTitle = $("capTitle"), capSubtitle = $("capSubtitle"), capSummary = $("capSummary"), capList = $("capList"), capActions = $("capActions");
const commandView = $("commandView"), commandSearch = $("commandSearch"), commandSummary = $("commandSummary"), commandList = $("commandList"), commandComposerSlot = $("commandComposerSlot"), commandFocusInput = $("commandFocusInput"), commandRunInput = $("commandRunInput");
const gitView = $("gitView"), gitSub = $("gitSub"), gitBranch = $("gitBranch"), gitDirty = $("gitDirty"), gitStaged = $("gitStaged"), gitUnstaged = $("gitUnstaged");
const jobView = $("jobView"), jobSummary = $("jobSummary"), jobList = $("jobList"), jobDetail = $("jobDetail"), jobRefresh = $("jobRefresh"), jobStatusText = $("jobStatusText");
const arenaView = $("arenaView"), arenaSummary = $("arenaSummary"), arenaRunList = $("arenaRunList"), arenaCandidateList = $("arenaCandidateList"), arenaDetail = $("arenaDetail");
const arenaRefresh = $("arenaRefresh"), arenaStatusText = $("arenaStatusText"), arenaTask = $("arenaTask"), arenaProviders = $("arenaProviders"), arenaCommand = $("arenaCommand"), arenaCreate = $("arenaCreate");
const industrialView = $("industrialView"), industrialSummary = $("industrialSummary"), industrialDetail = $("industrialDetail"), industrialRefresh = $("industrialRefresh"), industrialStatusText = $("industrialStatusText");
const sampleProjectStatus = $("sampleProjectStatus"), sampleProjectDetail = $("sampleProjectDetail"), sampleProjectOverwrite = $("sampleProjectOverwrite"), sampleProjectRunInstalledTools = $("sampleProjectRunInstalledTools"), sampleProjectCreateControlBox = $("sampleProjectCreateControlBox");
const industrialName = $("industrialName"), industrialType = $("industrialType"), industrialDomains = $("industrialDomains"), industrialSave = $("industrialSave");
const industrialRequirementText = $("industrialRequirementText"), industrialRequirementDomain = $("industrialRequirementDomain"), industrialRequirementPriority = $("industrialRequirementPriority"), industrialRequirementDraft = $("industrialRequirementDraft"), industrialRequirementAdd = $("industrialRequirementAdd");
const industrialRequirementTitle = $("industrialRequirementTitle"), industrialRequirementCriteria = $("industrialRequirementCriteria"), industrialRequirementRisk = $("industrialRequirementRisk"), industrialRequirementApprovalRequired = $("industrialRequirementApprovalRequired"), industrialRequirementCriteriaSave = $("industrialRequirementCriteriaSave");
const industrialRequirementSelect = $("industrialRequirementSelect"), industrialGenerateArtifactPlan = $("industrialGenerateArtifactPlan"), industrialGenerateTestPlan = $("industrialGenerateTestPlan"), industrialGenerateSpecPackage = $("industrialGenerateSpecPackage"), industrialApproveRequirement = $("industrialApproveRequirement"), industrialRequirementDraftPreview = $("industrialRequirementDraftPreview");
const industrialArtifactType = $("industrialArtifactType"), industrialArtifactDomain = $("industrialArtifactDomain"), industrialArtifactName = $("industrialArtifactName"), industrialArtifactPath = $("industrialArtifactPath"), industrialAddArtifact = $("industrialAddArtifact");
const industrialTraceFromType = $("industrialTraceFromType"), industrialTraceFromId = $("industrialTraceFromId"), industrialTraceToType = $("industrialTraceToType"), industrialTraceToId = $("industrialTraceToId"), industrialAddTrace = $("industrialAddTrace");
const industrialGateType = $("industrialGateType"), industrialGateStatus = $("industrialGateStatus"), industrialGateName = $("industrialGateName"), industrialGateMessage = $("industrialGateMessage"), industrialAddGate = $("industrialAddGate");
const domainPackSummary = $("domainPackSummary"), domainPackList = $("domainPackList"), domainPackDetail = $("domainPackDetail"), domainPackRefresh = $("domainPackRefresh");
const agentTeamSummary = $("agentTeamSummary"), agentTeamProfiles = $("agentTeamProfiles"), agentTeamPlanList = $("agentTeamPlanList"), agentTeamDetail = $("agentTeamDetail"), agentTeamRefresh = $("agentTeamRefresh"), agentTeamStatus = $("agentTeamStatus"), agentTeamTask = $("agentTeamTask"), agentTeamCreatePlan = $("agentTeamCreatePlan"), agentTeamCreateJob = $("agentTeamCreateJob");
const toolchainSummary = $("toolchainSummary"), toolchainList = $("toolchainList"), toolchainDetail = $("toolchainDetail"), toolchainRefresh = $("toolchainRefresh"), toolchainStatus = $("toolchainStatus"), toolchainTask = $("toolchainTask");
const qualityGateSummary = $("qualityGateSummary"), qualityGateList = $("qualityGateList"), qualityGateDetail = $("qualityGateDetail"), qualityGateRefresh = $("qualityGateRefresh"), qualityGateStatus = $("qualityGateStatus");
const releaseCenterSummary = $("releaseCenterSummary"), releaseCenterDetail = $("releaseCenterDetail"), releaseCenterRefresh = $("releaseCenterRefresh"), releaseCenterStatus = $("releaseCenterStatus"), releaseVersion = $("releaseVersion"), releaseCreatedBy = $("releaseCreatedBy"), releaseOverwrite = $("releaseOverwrite"), releaseBuild = $("releaseBuild"), releaseOpen = $("releaseOpen");
const gitFiles = $("gitFiles"), gitSelected = $("gitSelected"), gitDiffView = $("gitDiffView"), gitCommitMessage = $("gitCommitMessage"), gitCommitStatus = $("gitCommitStatus");
const gitRefresh = $("gitRefresh"), gitStageAll = $("gitStageAll"), gitUnstageAll = $("gitUnstageAll"), gitWorktreeMode = $("gitWorktreeMode"), gitStagedMode = $("gitStagedMode");
const gitGenerateMessage = $("gitGenerateMessage"), gitCommitBtn = $("gitCommitBtn");
const storeConfirm = $("storeConfirm"), storeConfirmTitle = $("storeConfirmTitle"), storeConfirmSub = $("storeConfirmSub");
const storeConfirmSummary = $("storeConfirmSummary"), storeConfirmChanges = $("storeConfirmChanges"), storeConfirmPerms = $("storeConfirmPerms"), storeConfirmWarnings = $("storeConfirmWarnings");
const storeConfirmClose = $("storeConfirmClose"), storeConfirmCancel = $("storeConfirmCancel"), storeConfirmInstall = $("storeConfirmInstall");
const settingsTitle = $("settingsTitle"), settingsSubtitle = $("settingsSubtitle"), settingsSteps = $("settingsSteps"), quickModelForm = $("quickModelForm");
const cfgTest = $("cfg-test"), advancedToggle = $("advanced-toggle"), quickSave = $("quick-save"), cfgSave = $("cfg-save");
const providerGrid = $("providerGrid");
const settingsNav = $("settingsNav");
const settingsSections = {
  usage: $("settingsUsageSection"),
  model: $("settingsModelSection"),
  chat: $("settingsChatSection"),
  safety: $("settingsSafetySection"),
  mcp: $("settingsMcpSection"),
  data: $("settingsDataSection"),
  about: $("settingsAboutSection"),
};
const usagePanelRoot = $("usagePanelRoot");
const reasoningOptions = $("reasoningOptions"), compactThresholdSelect = $("compactThresholdSelect");
const sandboxToggle = $("sandboxToggle"), sandboxHint = $("sandboxHint");
const mcpCfg = $("mcpCfg"), mcpSave = $("mcp-save");
const dataDirPath = $("dataDirPath"), configFilePath = $("configFilePath");
const openDataDirBtn = $("openDataDirBtn"), revealConfigBtn = $("revealConfigBtn");
const aboutVersion = $("aboutVersion"), aboutRuntime = $("aboutRuntime"), aboutPlatform = $("aboutPlatform");
const updateStatus = $("updateStatus"), checkUpdatesBtn = $("checkUpdatesBtn");
const aboutRepoBtn = $("aboutRepoBtn"), aboutReleasesBtn = $("aboutReleasesBtn"), aboutIssuesBtn = $("aboutIssuesBtn");
const providerHint = $("providerHint");
const quickBaseURL = $("quickBaseURL"), quickApiKey = $("quickApiKey"), quickModel = $("quickModel"), quickContext = $("quickContext");
const advancedConfig = $("advanced-config");
const routeViews = { home, chatview, capabilityView, commandView, gitView, jobView, arenaView, industrialView };

// Build the single composer from the template, start it in the home slot.
const composer = $("composer-tpl").content.firstElementChild.cloneNode(true);
homeSlot.appendChild(composer);
const input = composer.querySelector("#input");
const attachBtn = composer.querySelector("#attach");
const attachmentTray = composer.querySelector("#attachmentTray");
const sendBtn = composer.querySelector("#send");
const stopBtn = composer.querySelector("#stop");
const cmdmenu = composer.querySelector("#cmdmenu");
const modelPicker = composer.querySelector("#modelPicker");
const modelPill = composer.querySelector("#modelPill");
const modelName = composer.querySelector("#modelName");
const accessBtn = composer.querySelector("#access");
const accessLabel = composer.querySelector("#accessLabel");
const queueStatus = composer.querySelector("#queueStatus");
const queueCount = composer.querySelector("#queueCount");
const queuePreview = composer.querySelector("#queuePreview");
const queueOpenJob = composer.querySelector("#queueOpenJob");
const queueClear = composer.querySelector("#queueClear");

let busy = false, agentBody = null, agentRaw = "", yolo = false, cwd = "", inChat = false;
let currentModel = { model: "", baseURL: "", capabilities: null };
let pendingAttachments = [];
let queuedInputs = [];
let runtimeQueueState = { running: null, queued: [] };
let cfgText = "", selectedProvider = "deepseek", settingsMode = "model";
let authMode = "login", currentCapability = "";
let capabilityCache = null;
let storeCache = null, storeCacheKey = "", storeKind = "all", storeCategory = "all", storeQuery = "", storeMessage = "", storeSearchTimer = null, storeRequestSeq = 0;
let storePage = 1;
let pendingStoreInstall = null;
let toolEvents = [], recoverableTasks = [], diffs = [], selectedDiffId = null, showArchivedDiffs = false;
let runState = null, runTimer = null, runHideTimer = null, lastRunErrorDetail = "";
let gitState = null, selectedGitPath = "", selectedGitStaged = false;
let storeSearchComposing = false, composerComposing = false;
syncState({
  busy,
  agentBody,
  agentRaw,
  yolo,
  cwd,
  inChat,
  pendingAttachments,
  queuedInputs,
  runtimeQueueState,
  cfgText,
  selectedProvider,
  authMode,
  currentCapability,
  capabilityCache,
  storeCache,
  storeCacheKey,
  storeKind,
  storeCategory,
  storeQuery,
  storeMessage,
  storePage,
  pendingStoreInstall,
  toolEvents,
  recoverableTasks,
  diffs,
  selectedDiffId,
  showArchivedDiffs,
  runState,
  gitState,
  selectedGitPath,
  selectedGitStaged,
});

const fileTree = mountFileTree({
  elements: {
    modal: filesModal,
    pathLabel: filePath,
    list: fileList,
    preview: filePreview,
    closeButton: $("file-close"),
  },
  api,
  getCwd: () => cwd,
});

const jobCenter = mountJobCenterPanel({
  elements: {
    root: jobView,
    summary: jobSummary,
    list: jobList,
    detail: jobDetail,
    refresh: jobRefresh,
    status: jobStatusText,
  },
  api,
  toast,
});

const patchArena = mountPatchArenaPanel({
  elements: {
    root: arenaView,
    summary: arenaSummary,
    list: arenaRunList,
    candidates: arenaCandidateList,
    detail: arenaDetail,
    refresh: arenaRefresh,
    status: arenaStatusText,
    task: arenaTask,
    providers: arenaProviders,
    command: arenaCommand,
    create: arenaCreate,
  },
  api,
  toast,
});

const industrialProject = mountIndustrialProjectPanel({
  elements: {
    root: industrialView,
    summary: industrialSummary,
    detail: industrialDetail,
    refresh: industrialRefresh,
    status: industrialStatusText,
    name: industrialName,
    type: industrialType,
    domains: industrialDomains,
    save: industrialSave,
    requirementText: industrialRequirementText,
    requirementDomain: industrialRequirementDomain,
    requirementPriority: industrialRequirementPriority,
    buildDraft: industrialRequirementDraft,
    addRequirement: industrialRequirementAdd,
    requirementTitle: industrialRequirementTitle,
    requirementCriteria: industrialRequirementCriteria,
    requirementRisk: industrialRequirementRisk,
    requirementApprovalRequired: industrialRequirementApprovalRequired,
    saveCriteria: industrialRequirementCriteriaSave,
    requirementSelect: industrialRequirementSelect,
    generateArtifactPlan: industrialGenerateArtifactPlan,
    generateTestPlan: industrialGenerateTestPlan,
    generateSpecPackage: industrialGenerateSpecPackage,
    approveRequirement: industrialApproveRequirement,
    draftPreview: industrialRequirementDraftPreview,
    artifactType: industrialArtifactType,
    artifactDomain: industrialArtifactDomain,
    artifactName: industrialArtifactName,
    artifactPath: industrialArtifactPath,
    addArtifact: industrialAddArtifact,
    traceFromType: industrialTraceFromType,
    traceFromId: industrialTraceFromId,
    traceToType: industrialTraceToType,
    traceToId: industrialTraceToId,
    addTrace: industrialAddTrace,
    gateType: industrialGateType,
    gateStatus: industrialGateStatus,
    gateName: industrialGateName,
    gateMessage: industrialGateMessage,
    addGate: industrialAddGate,
  },
  api,
  toast,
});

const domainPacks = mountDomainPackPanel({
  elements: {
    summary: domainPackSummary,
    list: domainPackList,
    detail: domainPackDetail,
    refresh: domainPackRefresh,
  },
  api,
  toast,
  onProjectChanged: () => industrialProject.refresh(),
});

const agentTeam = mountAgentTeamPanel({
  elements: {
    summary: agentTeamSummary,
    profiles: agentTeamProfiles,
    planList: agentTeamPlanList,
    detail: agentTeamDetail,
    refresh: agentTeamRefresh,
    status: agentTeamStatus,
    task: agentTeamTask,
    createPlan: agentTeamCreatePlan,
    createJob: agentTeamCreateJob,
  },
  api,
  toast,
});

const toolchain = mountToolchainPanel({
  elements: {
    summary: toolchainSummary,
    list: toolchainList,
    detail: toolchainDetail,
    refresh: toolchainRefresh,
    status: toolchainStatus,
    task: toolchainTask,
  },
  api,
  toast,
});

const qualityGates = mountQualityGatePanel({
  elements: {
    summary: qualityGateSummary,
    list: qualityGateList,
    detail: qualityGateDetail,
    refresh: qualityGateRefresh,
    status: qualityGateStatus,
  },
  api,
  toast,
});

const releaseCenter = mountReleaseCenterPanel({
  elements: {
    summary: releaseCenterSummary,
    detail: releaseCenterDetail,
    refresh: releaseCenterRefresh,
    status: releaseCenterStatus,
    version: releaseVersion,
    createdBy: releaseCreatedBy,
    overwrite: releaseOverwrite,
    build: releaseBuild,
    open: releaseOpen,
  },
  api,
  toast,
});

mountSampleProjectPanel({
  elements: {
    status: sampleProjectStatus,
    detail: sampleProjectDetail,
    overwrite: sampleProjectOverwrite,
    runInstalledTools: sampleProjectRunInstalledTools,
    create: sampleProjectCreateControlBox,
  },
  api,
  toast,
  refreshTargets: [industrialProject, domainPacks, toolchain, qualityGates, releaseCenter, jobCenter],
});

const REASONING_LEVELS = [
  ["low", "低", "更快响应，适合简单改动"],
  ["medium", "中", "日常编码默认"],
  ["high", "高", "更充分地规划和审查"],
  ["ultra", "超高", "复杂任务和多文件重构"],
];

const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    contextWindow: 65536,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "DeepSeek 官方 OpenAI 兼容接口，填 API Key 即可。",
  },
  kimi: {
    label: "Kimi 全球",
    baseURL: "https://api.moonshot.ai/v1",
    model: "kimi-k2.7-code",
    contextWindow: 262144,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    credentialGroup: "kimi",
    note: "Moonshot/Kimi 全球开放平台，适合在 platform.kimi.ai 创建的 API Key。",
  },
  "kimi-cn": {
    label: "Kimi 国内",
    baseURL: "https://api.moonshot.cn/v1",
    model: "kimi-k2.7-code",
    contextWindow: 262144,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    credentialGroup: "kimi",
    note: "Moonshot/Kimi 国内开放平台，适合在国内控制台创建的 API Key。",
  },
  "kimi-code": {
    label: "Kimi Code",
    baseURL: "https://api.kimi.com/coding/v1",
    model: "kimi-for-coding",
    contextWindow: 262144,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    credentialGroup: "kimi",
    note: "Kimi Code 专用 OpenAI 兼容入口，适合 Kimi Code 订阅/编码密钥。",
  },
  qwen: {
    label: "通义千问",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    contextWindow: 131072,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "阿里云百炼 DashScope OpenAI 兼容模式，填百炼 API Key 即可。",
  },
  zhipu: {
    label: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5",
    contextWindow: 131072,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "智谱开放平台 OpenAI 兼容接口，填 API Key 即可。",
  },
  minimax: {
    label: "MiniMax",
    baseURL: "https://api.minimax.io/v1",
    model: "MiniMax-M1",
    contextWindow: 262144,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "MiniMax OpenAI 兼容接口，适合长上下文和 Agentic 任务。",
  },
  siliconflow: {
    label: "硅基流动",
    baseURL: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    contextWindow: 65536,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "硅基流动模型聚合接口，国内下载和访问相对友好。",
  },
  gemini: {
    label: "Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-pro",
    contextWindow: 1048576,
    apiKey: "",
    keyPlaceholder: "AIza...",
    apiOnly: true,
    note: "Google Gemini OpenAI 兼容接口，填 Gemini API Key 即可。",
  },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    contextWindow: 128000,
    apiKey: "",
    keyPlaceholder: "sk-or-...",
    apiOnly: true,
    note: "OpenRouter 聚合接口，可在高级 JSON 中替换为任意模型 ID。",
  },
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4.1",
    contextWindow: 128000,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "OpenAI 官方接口，填 API Key 即可。",
  },
  ollama: {
    label: "Ollama",
    baseURL: "http://127.0.0.1:11434/v1",
    model: "deepseek-chat",
    contextWindow: 65536,
    apiKey: "sk-no-key-required",
    keyPlaceholder: "sk-no-key-required",
    apiOnly: false,
    note: "本地 OpenAI 兼容服务，通常不需要真实 API Key。",
  },
  custom: {
    label: "自定义",
    baseURL: "",
    model: "",
    contextWindow: 65536,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: false,
    note: "填写任意 OpenAI 兼容服务的 Base URL、模型名和 API Key。",
  },
};

/* ---------- auth ---------- */
function setAuthMode(mode) {
  authMode = mode;
  syncState({ authMode });
  const isRegister = mode === "register";
  authTitle.textContent = isRegister ? "注册" : "登录";
  authSubmit.textContent = isRegister ? "创建账号" : "登录";
  nameField.classList.toggle("hidden", !isRegister);
  loginTab.classList.toggle("active", !isRegister);
  registerTab.classList.toggle("active", isRegister);
  authStatus.textContent = "";
  authStatus.classList.remove("ok");
  authPassword.autocomplete = isRegister ? "new-password" : "current-password";
}

let cachedUserProfile = buildUserProfile(null);

function applyUserProfile(user) {
  cachedUserProfile = buildUserProfile(user);
  userName.textContent = cachedUserProfile.displayName;
  userEmail.textContent = cachedUserProfile.emailLine;
  userInitial.textContent = cachedUserProfile.initials.slice(0, 1);
  if (userBadge) {
    userBadge.textContent = cachedUserProfile.badge;
    userBadge.classList.toggle("hidden", !cachedUserProfile.badge);
  }
}

function formatSidebarVersion(version) {
  const raw = String(version || "").trim();
  if (!raw) return "";
  const prerelease = raw.match(/^(\d+\.\d+\.\d+)-alpha\.(\d+)$/i);
  if (prerelease) return `v${prerelease[1]} α${prerelease[2]}`;
  return `v${raw}`;
}

function setSidebarVersion(version) {
  if (!appVersionEl) return;
  const raw = String(version || "").trim();
  appVersionEl.textContent = formatSidebarVersion(raw);
  appVersionEl.title = raw ? `当前版本 v${raw}` : "当前版本";
}

function showSignedIn(user) {
  auth.classList.add("hidden");
  appRoot.classList.remove("hidden");
  applyUserProfile(user);
  input.focus();
}

function showSignedOut() {
  appRoot.classList.add("hidden");
  auth.classList.remove("hidden");
  setAuthMode("login");
  authEmail.focus();
}

function setAuthStatus(text, ok = false) {
  authStatus.textContent = text;
  authStatus.classList.toggle("ok", ok);
}

async function initAuth() {
  const status = await api.authStatus();
  if (status?.user) showSignedIn(status.user);
  else showSignedOut();
}

loginTab.onclick = () => setAuthMode("login");
registerTab.onclick = () => setAuthMode("register");
authForm.onsubmit = async (e) => {
  e.preventDefault();
  const payload = {
    name: authName.value.trim(),
    email: authEmail.value.trim(),
    password: authPassword.value,
  };
  const r = authMode === "register"
    ? await api.register(payload)
    : await api.login(payload);
  if (!r.ok) return setAuthStatus(r.error || "认证失败");
  setAuthStatus("已登录", true);
  authPassword.value = "";
  showSignedIn(r.user);
};

$("skipAuth").onclick = () => showSignedIn(null); // use locally without an account

$("logoutBtn").onclick = async () => {
  await api.logout();
  showSignedOut();
};

/* ---------- ANSI → HTML ---------- */
const esc = (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c);
const escAll = (s) => s.replace(/[&<>]/g, esc);
const colorClass = (n) => ({30:"c-gray",90:"c-gray",31:"c-red",91:"c-red",32:"c-green",92:"c-green",33:"c-yellow",93:"c-yellow",34:"c-blue",94:"c-blue",35:"c-magenta",95:"c-magenta",36:"c-cyan",96:"c-cyan"})[n];
function ansiToHtml(s) {
  let html = "", i = 0, bold = false, color = null, open = false;
  const cur = () => [bold ? "c-bold" : null, color].filter(Boolean);
  const sync = () => { if (open) { html += "</span>"; open = false; } const c = cur(); if (c.length) { html += `<span class="${c.join(" ")}">`; open = true; } };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\x1b" && s[i + 1] === "[") {
      const m = /^\x1b\[([0-9;]*)m/.exec(s.slice(i));
      if (!m) break;
      const codes = m[1].split(";").filter((x) => x !== "").map(Number);
      if (!codes.length) codes.push(0);
      for (const c of codes) { if (c === 0) { bold = false; color = null; } else if (c === 1) bold = true; else if (c === 22) bold = false; else if (c === 39) color = null; else color = colorClass(c) ?? color; }
      sync(); i += m[0].length;
    } else { html += esc(ch); i++; }
  }
  if (open) html += "</span>";
  return html;
}

const COMMANDS = [
  ["/team", "架构师→程序员→审查员"],
  ["/build", "经理拆解 + 并行执行"],
  ["/agent", "委派单个角色"],
  ["/council", "多模型作答 + 综合"],
  ["/debate", "多模型辩论 + 裁决"],
  ["/models", "模型配置"],
  ["/diff", "Git 改动"],
  ["/undo", "撤销上一轮"],
  ["/compact", "压缩上下文"],
  ["/sessions", "历史会话"],
  ["/mcp", "MCP 服务"],
  ["/sandbox", "切换沙箱"],
  ["/cost", "用量"],
  ["/tools", "工具列表"],
  ["/clear", "清空对话"],
  ["/help", "全部命令"],
];
const COMMAND_CATEGORIES = {
  "/team": "智能体团队",
  "/build": "智能体团队",
  "/agent": "智能体团队",
  "/council": "智能体团队",
  "/debate": "智能体团队",
  "/models": "设置",
  "/diff": "工作区",
  "/undo": "工作区",
  "/compact": "上下文",
  "/sessions": "工作区",
  "/mcp": "MCP",
  "/sandbox": "安全",
  "/cost": "运行时",
  "/tools": "工具链",
  "/clear": "对话",
  "/help": "帮助",
};

/* ---------- view switching ---------- */
function setActiveNav(id) {
  closeWorkbenchDrawers();
  document.querySelectorAll(".nav-row").forEach((btn) => btn.classList.toggle("active", btn.id === id));
}

function setWorkbenchDrawer(name = "") {
  const timelineOpen = name === "timeline";
  const diffOpen = name === "diff";
  document.body.classList.toggle("timeline-drawer-open", timelineOpen);
  document.body.classList.toggle("diff-drawer-open", diffOpen);
  timelineDrawerBtn?.setAttribute("aria-expanded", timelineOpen ? "true" : "false");
  diffDrawerBtn?.setAttribute("aria-expanded", diffOpen ? "true" : "false");
}

function closeWorkbenchDrawers() {
  setWorkbenchDrawer("");
}

function showChat() {
  if (inChat) return;
  jobCenter.stop();
  patchArena.stop();
  industrialProject.stop();
  domainPacks.stop();
  agentTeam.stop();
  toolchain.stop();
  qualityGates.stop();
  releaseCenter.stop();
  inChat = true;
  syncState({ inChat });
  showRoute({ main, views: routeViews, route: "chatview", mainClass: "chatting", activeNav: "newChat", setActiveNav });
  chatSlot.appendChild(composer);
  input.focus();
}
function showHome() {
  jobCenter.stop();
  patchArena.stop();
  industrialProject.stop();
  domainPacks.stop();
  agentTeam.stop();
  toolchain.stop();
  qualityGates.stop();
  releaseCenter.stop();
  inChat = false;
  syncState({ inChat });
  showRoute({ main, views: routeViews, route: "home", mainClass: "home", activeNav: "newChat", setActiveNav });
  homeSlot.appendChild(composer);
  input.focus();
}

async function showCapabilities(kind) {
  jobCenter.stop();
  patchArena.stop();
  industrialProject.stop();
  domainPacks.stop();
  agentTeam.stop();
  toolchain.stop();
  qualityGates.stop();
  releaseCenter.stop();
  inChat = false;
  syncState({ inChat, currentCapability: kind });
  currentCapability = kind;
  showRoute({
    main,
    views: routeViews,
    route: "capabilityView",
    mainClass: "capability",
    activeNav: CAPABILITY_META[kind]?.nav || "pluginsBtn",
    setActiveNav,
  });
  await renderCapabilities(kind);
}

async function showStore() {
  jobCenter.stop();
  patchArena.stop();
  industrialProject.stop();
  domainPacks.stop();
  agentTeam.stop();
  toolchain.stop();
  qualityGates.stop();
  releaseCenter.stop();
  inChat = false;
  syncState({ inChat });
  showRoute({ main, views: routeViews, route: "capabilityView", mainClass: "capability", activeNav: "storeBtn", setActiveNav });
  await renderStore();
}

function showCommandCenter() {
  jobCenter.stop();
  patchArena.stop();
  industrialProject.stop();
  domainPacks.stop();
  agentTeam.stop();
  toolchain.stop();
  qualityGates.stop();
  releaseCenter.stop();
  inChat = false;
  syncState({ inChat });
  showRoute({ main, views: routeViews, route: "commandView", mainClass: "commands", activeNav: "cmdBtn", setActiveNav });
  commandComposerSlot.appendChild(composer);
  if (!input.value.trim()) input.value = "/";
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  renderCommandCenter(commandSearch.value.trim());
  input.focus();
  if (input.value === "/") showMenu("/");
}

async function showGit() {
  jobCenter.stop();
  patchArena.stop();
  industrialProject.stop();
  domainPacks.stop();
  agentTeam.stop();
  toolchain.stop();
  qualityGates.stop();
  releaseCenter.stop();
  inChat = false;
  syncState({ inChat });
  showRoute({ main, views: routeViews, route: "gitView", mainClass: "git", activeNav: "gitBtn", setActiveNav });
  await refreshGitStatus();
}

async function showJobCenter(jobId = "") {
  patchArena.stop();
  industrialProject.stop();
  domainPacks.stop();
  agentTeam.stop();
  toolchain.stop();
  qualityGates.stop();
  releaseCenter.stop();
  inChat = false;
  syncState({ inChat });
  showRoute({ main, views: routeViews, route: "jobView", mainClass: "jobs", activeNav: "jobsBtn", setActiveNav });
  await jobCenter.open(jobId);
}

async function showPatchArena() {
  jobCenter.stop();
  industrialProject.stop();
  domainPacks.stop();
  agentTeam.stop();
  toolchain.stop();
  qualityGates.stop();
  releaseCenter.stop();
  inChat = false;
  syncState({ inChat });
  showRoute({ main, views: routeViews, route: "arenaView", mainClass: "arena", activeNav: "arenaBtn", setActiveNav });
  await patchArena.open();
}

async function showIndustrialProject() {
  jobCenter.stop();
  patchArena.stop();
  inChat = false;
  syncState({ inChat });
  showRoute({ main, views: routeViews, route: "industrialView", mainClass: "industrial", activeNav: "industrialBtn", setActiveNav });
  await industrialProject.open();
  await domainPacks.open();
  await agentTeam.open();
  await toolchain.open();
  await qualityGates.open();
  await releaseCenter.open();
}

/* ---------- chat rendering ---------- */
const atBottom = () => chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
const scrollDown = () => (chat.scrollTop = chat.scrollHeight);
function inputTextWithAttachments(text, attachments = []) {
  const refs = attachments
    .map((attachment) => attachment?.relativePath ? `@${attachment.relativePath}` : "")
    .filter(Boolean);
  return refs.length ? `${text}\n${refs.join("\n")}` : text;
}
function renderPendingAttachments() {
  if (!attachmentTray) return;
  attachmentTray.innerHTML = "";
  attachmentTray.classList.toggle("hidden", pendingAttachments.length === 0);
  pendingAttachments.forEach((attachment, index) => {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    chip.title = attachment.relativePath || attachment.name || "图片附件";
    const label = document.createElement("span");
    label.textContent = `图片：${attachment.name || "image"}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "移除图片";
    remove.textContent = "×";
    remove.onclick = () => {
      pendingAttachments.splice(index, 1);
      syncState({ pendingAttachments });
      renderPendingAttachments();
    };
    chip.append(label, remove);
    attachmentTray.appendChild(chip);
  });
}
function clearPendingAttachments() {
  pendingAttachments = [];
  syncState({ pendingAttachments });
  renderPendingAttachments();
}
function appendPendingAttachment(result) {
  if (!result?.ok || !result.relativePath) return false;
  pendingAttachments.push({
    name: result.name || result.relativePath.split("/").pop() || "image",
    relativePath: result.relativePath,
    mime: result.mime || "image/*",
    size: result.size || 0,
  });
  syncState({ pendingAttachments });
  renderPendingAttachments();
  input.focus();
  return true;
}
function addUserMessage(text, attachments = []) {
  const el = document.createElement("div");
  el.className = "msg user";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  if (Array.isArray(attachments) && attachments.length) {
    const tray = document.createElement("div");
    tray.className = "attachment-tray";
    for (const attachment of attachments) {
      const chip = document.createElement("span");
      chip.className = "attachment-chip";
      const label = document.createElement("span");
      label.textContent = `图片：${attachment.name || attachment.relativePath || "image"}`;
      chip.appendChild(label);
      tray.appendChild(chip);
    }
    bubble.appendChild(tray);
  }
  el.appendChild(bubble);
  chat.appendChild(el); scrollDown();
}
function startAgentMessage() {
  const el = document.createElement("div"); el.className = "msg agent";
  el.innerHTML = `<div class="avatar"><span class="logo"></span></div><div class="agent-body agent-pending"></div>`;
  chat.appendChild(el);
  agentBody = el.querySelector(".agent-body");
  agentBody.textContent = "Hi Code 正在思考…";
  agentRaw = "";
  scrollDown();
}
function appendOutput(chunk) {
  if (busy && runningSessionId && currentSessionId !== runningSessionId) {
    if (liveSessionSnapshot?.id === runningSessionId) liveSessionSnapshot.agentRaw += chunk;
    return;
  }
  if (!agentBody) startAgentMessage();
  const stick = atBottom();
  agentRaw += chunk;
  agentBody.classList.remove("agent-pending", "agent-empty", "agent-error");
  agentBody.innerHTML = ansiToHtml(agentRaw);
  const outputError = detectRuntimeOutputError(chunk);
  if (outputError) {
    lastRunErrorDetail = outputError;
    updateRunStatus({
      label: "模型请求失败",
      detail: outputError,
      status: "error",
    });
  } else if (runState?.status !== "error") {
    updateRunStatus({
      label: "正在输出",
      detail: summarizeRunText(chunk),
      status: "running",
    });
  }
  if (stick) scrollDown();
}
function finishAgentMessageIfEmpty(status = "done", detail = "") {
  if (!agentBody || agentRaw.trim()) return;
  agentBody.classList.remove("agent-pending", "agent-empty", "agent-error");
  if (status === "error" || status === "denied" || status === "interrupted") {
    agentBody.classList.add("agent-error");
    agentBody.textContent = detail || "任务没有完成。请查看上方状态或时间线里的失败原因。";
    return;
  }
  agentBody.classList.add("agent-empty");
  agentBody.textContent = "这次模型没有返回可显示内容。可以重试，或在“接入 API”里测试/切换模型。";
}
function addSystemNote(text) {
  const el = document.createElement("div"); el.className = "msg agent";
  el.innerHTML = `<div class="avatar"><span class="logo"></span></div><div class="agent-body c-gray"></div>`;
  el.querySelector(".agent-body").textContent = text; chat.appendChild(el); scrollDown();
}
function setBusy(v) {
  busy = v;
  syncState({ busy });
  composer.classList.toggle("is-busy", v);
  sendBtn.classList.remove("hidden");
  sendBtn.title = v ? "加入待发送队列" : "发送";
  stopBtn.classList.toggle("hidden", !v);
  input.disabled = false;
  input.focus();
}
function runLine(text, options = {}) {
  if (!text) return;
  if (busy) return enqueueInput(text);
  showChat();
  beginRunStatus(text);
  addUserMessage(options.displayText || text, options.attachments || []); startAgentMessage(); setBusy(true);
  runningSessionId = activeRuntimeSessionId || runningSessionId || currentSessionId;
  if (runningSessionId && !currentSessionId) currentSessionId = runningSessionId;
  liveSessionSnapshot = null;
  renderSessions(searchInput.value.trim());
  api.send(text);
}
function submit() {
  const text = input.value.trim();
  if (!text && !pendingAttachments.length) return;
  const attachments = pendingAttachments.slice();
  const displayText = text || "请识别这张图片。";
  const payload = inputTextWithAttachments(displayText, attachments);
  input.value = "";
  input.style.height = "auto";
  clearPendingAttachments();
  hideMenu();
  runLine(payload, { displayText, attachments });
}

function enqueueInput(text) {
  queuedInputs.push(text);
  syncState({ queuedInputs });
  renderQueueStatus();
  updateRunStatus({
    label: "当前任务执行中",
    detail: `已排队 ${queuedInputs.length} 条，当前任务结束后自动发送`,
    status: "running",
  });
}

function runNextQueuedInput() {
  if (busy || !queuedInputs.length) return;
  const next = queuedInputs.shift();
  syncState({ queuedInputs });
  renderQueueStatus();
  if (next) runLine(next);
}

function renderQueueStatus() {
  if (!queueStatus || !queueCount || !queuePreview) return;
  const runtimeQueued = Array.isArray(runtimeQueueState?.queued) ? runtimeQueueState.queued : [];
  const runtimeRunning = runtimeQueueState?.running || null;
  const total = queuedInputs.length + runtimeQueued.length + (runtimeRunning ? 1 : 0);
  queueStatus.classList.toggle("hidden", total === 0);
  const labels = [];
  if (runtimeRunning) labels.push("运行中 1 条");
  if (queuedInputs.length) labels.push(`待发送 ${queuedInputs.length} 条`);
  if (runtimeQueued.length) labels.push(`主队列 ${runtimeQueued.length} 条`);
  queueCount.textContent = labels.join(" · ") || "没有排队任务";
  const preview = runtimeRunning?.summary || queuedInputs[0] || runtimeQueued[0]?.summary || "";
  queuePreview.textContent = preview.slice(0, 90);
  const jobCenterId = runtimeRunning?.jobCenterId || runtimeQueued.find((job) => job.jobCenterId)?.jobCenterId || "";
  if (queueOpenJob) {
    queueOpenJob.classList.toggle("hidden", !jobCenterId);
    queueOpenJob.onclick = () => jobCenterId && showJobCenter(jobCenterId);
  }
}

function beginRunStatus(inputText) {
  clearTimeout(runHideTimer);
  lastRunErrorDetail = "";
  runState = {
    active: true,
    status: "running",
    label: inputText.startsWith("!") ? "准备执行命令" : "发送给模型",
    detail: inputText,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    stepCount: 0,
  };
  syncState({ runState });
  ensureRunTimer();
  renderRunStatus();
}

function updateRunStatus(patch) {
  if (!runState || !runState.active) return;
  runState = {
    ...runState,
    ...patch,
    updatedAt: Date.now(),
  };
  syncState({ runState });
  renderRunStatus();
}

function updateRunStatusFromEvent(event) {
  if (!event) return;
  if (!runState) beginRunStatus(event.summary || event.title || "任务");
  const next = runStatusFromEvent(event);
  if (!next) return;
  updateRunStatus({
    ...next,
    stepCount: (runState?.stepCount || 0) + (countsAsRunStep(event) ? 1 : 0),
  });
}

function finishRunStatus(status = "done", detail = "") {
  if (!runState) return;
  runState = {
    ...runState,
    active: false,
    status,
    label: status === "done" ? "任务完成" : status === "interrupted" ? "任务已停止" : status === "denied" ? "权限已拒绝" : "任务失败",
    detail: detail || runState.detail,
    updatedAt: Date.now(),
  };
  syncState({ runState });
  renderRunStatus();
  stopRunTimer();
  clearTimeout(runHideTimer);
  runHideTimer = setTimeout(() => {
    if (runStatus) runStatus.classList.add("hidden");
  }, 7000);
}

function stripAnsiCodes(text) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function detectRuntimeOutputError(chunk) {
  const firstLine = stripAnsiCodes(chunk)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";
  const match = /^(?:[✗×]\s*)?error:\s*(.+)$/i.exec(firstLine);
  if (!match) return "";
  const message = match[1]?.trim() || "模型或工具执行失败";
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

function runStatusFromEvent(event) {
  const status = event.status || "running";
  if (event.type === "turn:start") return { label: "任务已开始", detail: event.summary || event.title, status: "running" };
  if (event.type === "turn:update") return { label: turnUpdateLabel(event), detail: event.summary || event.title, status };
  if (event.type === "permission:requested") return { label: "等待权限确认", detail: event.summary || event.payload?.action || event.title, status: "waiting" };
  if (event.type === "tool:start") return { label: `正在执行 ${event.tool || "工具"}`, detail: event.summary || event.title, status: "running" };
  if (event.type === "tool:output") return { label: `${event.tool || "工具"} 输出中`, detail: event.summary || summarizeRunText(event.payload?.chunk || ""), status: "running" };
  if (event.type === "tool:done") {
    return {
      label: `${event.tool || "工具"} ${status === "done" ? "完成" : statusText(status)}`,
      detail: event.summary || event.title,
      status: status === "done" ? "running" : status,
    };
  }
  if (event.type === "diff:created") return { label: "发现文件改动", detail: event.summary || event.path || event.title, status: "running" };
  if (event.type === "turn:done") {
    finishRunStatus(status, event.summary || "");
    return null;
  }
  return { label: event.title || event.type, detail: event.summary || "", status };
}

function turnUpdateLabel(event) {
  const phase = event.payload?.phase;
  if (phase === "thinking") return "模型思考中";
  if (phase === "compacting") return "压缩上下文";
  if (phase === "calling-tools") return "准备调用工具";
  if (phase === "interrupted") return "正在停止";
  return event.title || "任务进行中";
}

function countsAsRunStep(event) {
  return ["turn:update", "tool:start", "tool:done", "permission:requested", "diff:created"].includes(event.type);
}

function ensureRunTimer() {
  if (runTimer) return;
  runTimer = setInterval(renderRunStatus, 1000);
}

function stopRunTimer() {
  if (!runTimer) return;
  clearInterval(runTimer);
  runTimer = null;
}

function renderRunStatus() {
  if (!runStatus || !runState) return;
  runStatus.classList.remove("hidden", "is-running", "is-waiting", "is-done", "is-error", "is-denied", "is-interrupted");
  runStatus.classList.add(statusClass(runState.status) || (runState.active ? "is-running" : "is-done"));
  runStatusText.textContent = runState.label || "任务进行中";
  runStatusMeta.textContent = runStatusMetaText();
  runStatusDetail.textContent = runState.detail || "等待下一步事件…";
  if (runStatusDot) runStatusDot.title = statusText(runState.status);
}

function runStatusMetaText() {
  const bits = [];
  const elapsed = runState?.startedAt ? formatDuration(Date.now() - runState.startedAt) : "";
  if (elapsed) bits.push(elapsed);
  if (runState?.stepCount) bits.push(`${runState.stepCount} 步`);
  const model = modelName?.textContent?.trim();
  if (model && model !== "…") bits.push(model);
  return bits.join(" · ");
}

/* ---------- workbench timeline + diff ---------- */
async function refreshWorkbench() {
  await Promise.all([refreshToolEvents(), refreshRecoverableTasks(), refreshDiffs()]);
}

async function refreshToolEvents() {
  if (!api.has("listToolEvents")) return;
  toolEvents = coalesceToolEvents(await api.listToolEvents());
  syncState({ toolEvents });
  renderTimeline();
}

async function refreshRecoverableTasks() {
  if (!api.has("listRecoverableTasks")) {
    recoverableTasks = [];
    renderRecoverableTasks();
    return;
  }
  try {
    recoverableTasks = await api.listRecoverableTasks(6);
  } catch {
    recoverableTasks = [];
  }
  syncState({ recoverableTasks });
  renderRecoverableTasks();
}

async function refreshDiffs() {
  if (!api.has("listDiffs")) return;
  setDiffs(await api.listDiffs());
}

function addToolEvent(event) {
  toolEvents = mergeToolEventInto(toolEvents, event).slice(-120);
  syncState({ toolEvents });
  updateRunStatusFromEvent(event);
  renderTimeline();
}

function coalesceToolEvents(events) {
  let merged = [];
  for (const event of events || []) merged = mergeToolEventInto(merged, event);
  return merged.slice(-120);
}

function mergeToolEventInto(list, event) {
  const parentId = event?.payload?.parentId;
  const idx = list.findIndex((item) => item.id === event.id || (parentId && item.id === parentId));
  if (idx >= 0) {
    const current = list[idx];
    list[idx] = {
      ...current,
      ...event,
      id: current.id,
      type: current.type,
      payload: { ...(current.payload || {}), ...(event.payload || {}) },
      updatedAt: event.updatedAt || Date.now(),
    };
  } else {
    list.push(event);
  }
  return list;
}

function renderRecoverableTasks() {
  if (!recoveryPanel || !recoveryList) return;
  recoveryList.innerHTML = "";
  const tasks = Array.isArray(recoverableTasks) ? recoverableTasks : [];
  recoveryPanel.classList.toggle("hidden", tasks.length === 0);
  if (!tasks.length) return;

  for (const task of tasks.slice(0, 6)) {
    const row = document.createElement("div");
    row.className = `recovery-row ${statusClass(task.status)}`;
    row.innerHTML = `
      <span class="recovery-status"></span>
      <span class="recovery-main">
        <span class="recovery-title"></span>
        <span class="recovery-meta"></span>
      </span>
      <button class="timeline-action recovery-retry" type="button"></button>
    `;
    row.querySelector(".recovery-status").textContent = statusText(task.status);
    row.querySelector(".recovery-title").textContent = task.title || task.summary || "可恢复任务";
    row.querySelector(".recovery-meta").textContent = recoveryMeta(task);
    const action = row.querySelector(".recovery-retry");
    action.textContent = recoveryActionLabel(task);
    action.onclick = () => handleRecoverableTask(task);
    recoveryList.appendChild(row);
  }
}

async function handleRecoverableTask(task) {
  if (busy) return addSystemNote("当前任务还在执行，稍后再处理恢复任务。");
  if (!task?.sessionId) return addSystemNote("恢复记录缺少原会话标识，已阻止在当前会话中执行。");
  await openSession(task.sessionId);
  if (currentSessionId !== task.sessionId) return addSystemNote("未能恢复原会话，已阻止重试。");

  const action = task.recoveryAction || "inspect_tool";
  if ((action === "retry_turn" || action === "retry_with_approval") && task.canRetry === true) {
    if (sessionMetaById(task.sessionId)?.replayOnly) {
      return addSystemNote("该会话目前只能回放，无法安全恢复运行时；请检查记录后手动创建新任务。");
    }
    const retryInput = String(task.retryInput || "").trim();
    if (!retryInput) return addSystemNote("恢复记录缺少原始输入，已阻止空任务重试。");
    if (action === "retry_with_approval") addSystemNote("已恢复原会话；本次重试会重新请求人工审批。");
    return runLine(retryInput);
  }

  addSystemNote(task.reason || "已打开原会话。请先检查未完成输出和工具副作用，再决定后续操作。");
}

function recoveryActionLabel(task) {
  return {
    retry_turn: "重试",
    retry_with_approval: "重新确认",
    review_output: "查看输出",
    inspect_tool: "检查状态",
  }[task?.recoveryAction] || "检查状态";
}

function renderTimeline() {
  if (!timelineList) return;
  timelineList.innerHTML = "";
  const items = [...toolEvents].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.textContent = "工具调用会显示在这里。";
    timelineList.appendChild(empty);
    return;
  }
  for (const event of items.slice(0, 80)) {
    const row = document.createElement("div");
    row.className = `timeline-row ${statusClass(event.status)} ${event.type.replace(":", "-")}`;
    row.innerHTML = `
      <span class="timeline-dot"></span>
      <span class="timeline-main">
        <span class="timeline-title"></span>
        <span class="timeline-meta"></span>
      </span>
      <span class="timeline-actions"></span>
    `;
    row.querySelector(".timeline-title").textContent = event.title || event.tool || event.type;
    row.querySelector(".timeline-meta").textContent = timelineMeta(event);
    row.onclick = (clickEvent) => {
      if (clickEvent.target.closest("button")) return;
      if (event.diffId) selectDiff(event.diffId);
    };
    const actions = row.querySelector(".timeline-actions");
    const retryInput = event.payload?.retryInput;
    if (isRetryableTurn(event) && retryInput) {
      const retry = document.createElement("button");
      retry.className = "timeline-action";
      retry.textContent = "Retry";
      retry.title = "重新执行这个任务";
      retry.onclick = () => {
        if (busy) return addSystemNote("当前任务还在执行，稍后再重试。");
        runLine(String(retryInput));
      };
      actions.appendChild(retry);
    }
    timelineList.appendChild(row);
  }
}

function isRetryableTurn(event) {
  return event.type?.startsWith("turn:") && ["error", "interrupted", "denied"].includes(event.status);
}

function timelineMeta(event) {
  const bits = [];
  if (event.type?.startsWith("turn:")) bits.push("turn");
  else if (event.type === "permission:requested") bits.push("permission");
  else bits.push(event.tool || event.type);
  if (event.status) bits.push(statusText(event.status));
  const duration = formatDuration(event.payload?.durationMs);
  if (duration) bits.push(duration);
  if (event.summary && event.summary !== event.title) bits.push(String(event.summary).slice(0, 80));
  return bits.filter(Boolean).join(" · ");
}

function recoveryMeta(task) {
  const bits = [];
  const when = task.updatedAt || task.createdAt;
  if (when) bits.push(new Date(when).toLocaleString());
  const duration = formatDuration(task.durationMs);
  if (duration) bits.push(duration);
  const phase = {
    running_model: "模型运行中断",
    streaming: "流式输出中断",
    waiting_approval: "等待审批",
    tool_running: "工具状态未知",
    failed: "执行失败",
    denied: "审批已拒绝",
    interrupted: "任务已中断",
  }[task.phase];
  if (phase) bits.push(phase);
  if (task.partialAssistantText) bits.push(`保留 ${task.partialAssistantText.length} 字输出${task.partialOutputTruncated ? "（已截断）" : ""}`);
  if (task.reason) bits.push(task.reason);
  return bits.filter(Boolean).join(" · ");
}

function statusText(status) {
  return {
    running: "running",
    waiting: "waiting",
    done: "done",
    error: "error",
    denied: "denied",
    interrupted: "interrupted",
  }[status] || status;
}

function statusClass(status) {
  return {
    running: "is-running",
    waiting: "is-waiting",
    done: "is-done",
    error: "is-error",
    denied: "is-denied",
    interrupted: "is-interrupted",
  }[status] || "";
}

function setDiffs(next) {
  diffs = Array.isArray(next) ? next : [];
  const { visible } = diffBuckets();
  if (!selectedDiffId || !visible.some((diff) => diff.id === selectedDiffId)) {
    selectedDiffId = visible[0]?.id || null;
  }
  syncState({ diffs, selectedDiffId });
  renderDiffs();
}

function diffBuckets() {
  const pending = diffs.filter((diff) => diff.status === "pending");
  const archived = diffs.filter((diff) => diff.status !== "pending");
  return {
    pending,
    archived,
    visible: showArchivedDiffs ? [...pending, ...archived] : pending,
  };
}

function renderDiffs() {
  if (!diffList || !diffView) return;
  diffList.innerHTML = "";
  const { pending, archived, visible } = diffBuckets();
  diffSummary.textContent = `${pending.length} 个可回滚${archived.length ? ` · ${archived.length} 个已归档` : ""}`;
  updateDiffChrome(pending.length, archived.length);

  if (!diffs.length) {
    diffList.innerHTML = `<div class="diff-empty">Agent 修改文件后会出现在这里。</div>`;
    diffView.textContent = "还没有文件改动。";
    setDiffButtons(false);
    return;
  }
  if (!visible.length) {
    selectedDiffId = null;
    diffList.innerHTML = `<div class="diff-empty">没有可回滚改动。${archived.length ? `${archived.length} 个历史改动已归档。` : ""}</div>`;
    diffView.textContent = "当前没有可归档或回滚的文件改动。";
    setDiffButtons(false);
    return;
  }

  for (const diff of visible) {
    const row = document.createElement("button");
    row.className = `diff-row ${diff.id === selectedDiffId ? "active" : ""} diff-${diff.status}`;
    row.innerHTML = `
      <span class="diff-file"></span>
      <span class="diff-status"></span>
    `;
    row.querySelector(".diff-file").textContent = diff.path;
    row.querySelector(".diff-status").textContent = diffStatusText(diff.status);
    row.onclick = () => selectDiff(diff.id);
    diffList.appendChild(row);
  }

  const selected = visible.find((diff) => diff.id === selectedDiffId) || visible[0];
  selectedDiffId = selected?.id || null;
  if (!selected) return;
  diffView.innerHTML = renderUnifiedDiff(selected);
  setDiffButtons(selected.status === "pending");
}

function selectDiff(id) {
  const diff = diffs.find((item) => item.id === id);
  if (!diff || (diff.status !== "pending" && !showArchivedDiffs)) return;
  selectedDiffId = id;
  syncState({ selectedDiffId });
  renderDiffs();
}

function updateDiffChrome(pendingCount, archivedCount) {
  if (diffAcceptAll) diffAcceptAll.disabled = pendingCount === 0;
  if (diffRejectAll) diffRejectAll.disabled = pendingCount === 0;
  if (diffHistory) {
    diffHistory.disabled = archivedCount === 0;
    diffHistory.classList.toggle("active", showArchivedDiffs);
    diffHistory.textContent = showArchivedDiffs ? "隐藏历史" : "历史";
  }
  if (diffClear) diffClear.disabled = archivedCount === 0;
}

function setDiffButtons(enabled) {
  diffAccept.disabled = !enabled;
  diffReject.disabled = !enabled;
}

if (recoveryRefresh) recoveryRefresh.onclick = refreshRecoverableTasks;

diffAccept.onclick = async () => {
  if (!selectedDiffId || !api.has("acceptDiff")) return;
  const diff = diffs.find((item) => item.id === selectedDiffId);
  if (!diff || diff.status !== "pending") return;
  const r = await api.acceptDiff(selectedDiffId);
  if (!r?.ok) addSystemNote(r?.error || "归档改动失败");
  await refreshDiffs();
};
diffReject.onclick = async () => {
  if (!selectedDiffId || !api.has("rejectDiff")) return;
  const diff = diffs.find((item) => item.id === selectedDiffId);
  if (!diff || diff.status !== "pending") return;
  const r = await api.rejectDiff(selectedDiffId);
  if (!r?.ok) addSystemNote(r?.error || "回滚改动失败");
  await refreshDiffs();
};
diffAcceptAll.onclick = async () => {
  if (!api.has("acceptAllDiffs")) return;
  const r = await api.acceptAllDiffs();
  if (!r?.ok) addSystemNote(r?.error || "全部归档失败");
  await refreshDiffs();
};
diffRejectAll.onclick = async () => {
  if (!api.has("rejectAllDiffs")) return;
  const r = await api.rejectAllDiffs();
  if (!r?.ok) addSystemNote(r?.error || "全部回滚失败");
  await refreshDiffs();
};
diffHistory.onclick = () => {
  showArchivedDiffs = !showArchivedDiffs;
  const { visible } = diffBuckets();
  selectedDiffId = visible[0]?.id || null;
  syncState({ showArchivedDiffs, selectedDiffId });
  renderDiffs();
};
diffClear.onclick = async () => {
  if (!api.has("clearArchivedDiffs")) return;
  const r = await api.clearArchivedDiffs();
  if (!r?.ok) addSystemNote(r?.error || "清理历史改动失败");
  if (r?.ok) showArchivedDiffs = false;
  await refreshDiffs();
};

/* ---------- Git workflow ---------- */
async function refreshGitStatus() {
  if (!api.has("gitStatus")) return;
  gitSetStatus("正在读取 Git 状态…");
  gitState = await api.gitStatus();
  syncState({ gitState });
  renderGitStatus();
  if (gitState?.ok && selectedGitPath) await loadGitDiff();
}

function renderGitStatus() {
  const state = gitState;
  if (!state?.ok) {
    gitSub.textContent = state?.error || "当前项目不是 Git 仓库。";
    gitBranch.textContent = "-";
    gitDirty.textContent = "0";
    gitStaged.textContent = "0";
    gitUnstaged.textContent = "0";
    gitFiles.innerHTML = `<div class="git-empty">当前项目不是 Git 仓库，或 Git 不可用。</div>`;
    gitDiffView.textContent = "没有可显示的 diff。";
    selectedGitPath = "";
    syncState({ selectedGitPath });
    setGitButtons(false, false);
    gitSetStatus("");
    return;
  }

  gitSub.textContent = `${state.root || cwd}${state.upstream ? ` · ${state.upstream}` : ""}${state.ahead || state.behind ? ` · ahead ${state.ahead || 0} / behind ${state.behind || 0}` : ""}`;
  gitBranch.textContent = state.branch || "-";
  gitDirty.textContent = String(state.dirty || 0);
  gitStaged.textContent = String(state.staged || 0);
  gitUnstaged.textContent = String(state.unstaged || 0);
  setGitButtons(state.unstaged > 0, state.staged > 0);

  const files = sortedGitFiles(state.files || []);
  if (!files.length) {
    gitFiles.innerHTML = `<div class="git-empty">工作区干净，没有改动。</div>`;
    selectedGitPath = "";
    syncState({ selectedGitPath });
    gitSelected.textContent = "差异";
    gitDiffView.textContent = "没有可显示的 diff。";
    gitSetStatus("工作区干净", "ok");
    return;
  }

  if (!selectedGitPath || !files.some((file) => file.path === selectedGitPath)) {
    const first = files[0];
    selectedGitPath = first.path;
    selectedGitStaged = first.staged && !first.unstaged;
    syncState({ selectedGitPath, selectedGitStaged });
  }
  renderGitFiles(files);
  gitSetStatus("");
}

function renderGitFiles(files) {
  gitFiles.innerHTML = "";
  for (const file of files) {
    const row = document.createElement("div");
    row.className = `git-file-row ${file.path === selectedGitPath ? "active" : ""}`;
    const mainBtn = document.createElement("button");
    mainBtn.className = "git-file-main";
    mainBtn.innerHTML = `
      <span class="git-status-code"></span>
      <span class="git-file-text">
        <span class="git-file-path"></span>
        <span class="git-file-meta"></span>
      </span>
    `;
    mainBtn.querySelector(".git-status-code").textContent = file.status || "M";
    mainBtn.querySelector(".git-file-path").textContent = file.path;
    mainBtn.querySelector(".git-file-meta").textContent = gitFileMeta(file);
    mainBtn.onclick = () => selectGitFile(file.path, file.staged && !file.unstaged);
    row.appendChild(mainBtn);

    const actions = document.createElement("div");
    actions.className = "git-file-actions";
    if (file.unstaged) actions.appendChild(gitFileAction("暂存", () => stageGitPaths([file.path])));
    if (file.staged) actions.appendChild(gitFileAction("取消暂存", () => unstageGitPaths([file.path])));
    row.appendChild(actions);
    gitFiles.appendChild(row);
  }
}

function gitFileAction(label, fn) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.onclick = async (event) => {
    event.stopPropagation();
    await fn();
  };
  return btn;
}

function sortedGitFiles(files) {
  return [...files].sort((a, b) =>
    Number(b.staged) - Number(a.staged)
    || Number(b.unstaged) - Number(a.unstaged)
    || a.path.localeCompare(b.path),
  );
}

function gitFileMeta(file) {
  const bits = [];
  if (file.staged) bits.push("已暂存");
  if (file.unstaged) bits.push(file.untracked ? "未跟踪" : "未暂存");
  if (file.oldPath) bits.push(`来自 ${file.oldPath}`);
  return bits.join(" · ") || "已改动";
}

async function selectGitFile(filePath, staged = false) {
  selectedGitPath = filePath;
  selectedGitStaged = staged;
  syncState({ selectedGitPath, selectedGitStaged });
  renderGitStatus();
  await loadGitDiff();
}

async function loadGitDiff() {
  if (!selectedGitPath || !api.has("gitDiff")) return;
  gitSelected.textContent = selectedGitPath;
  gitWorktreeMode.classList.toggle("active", !selectedGitStaged);
  gitStagedMode.classList.toggle("active", selectedGitStaged);
  gitDiffView.textContent = "正在读取 diff…";
  const r = await api.gitDiff({ path: selectedGitPath, staged: selectedGitStaged });
  gitDiffView.textContent = r?.ok ? (r.diff || "没有差异") : (r?.error || "读取差异失败");
}

async function stageGitPaths(paths) {
  if (!paths.length || !api.has("gitStage")) return;
  gitSetStatus("正在暂存…");
  const r = await api.gitStage(paths);
  if (!r?.ok) gitSetStatus(r?.error || "暂存失败", "error");
  await refreshGitStatus();
  await loadGitDiff();
}

async function unstageGitPaths(paths) {
  if (!paths.length || !api.has("gitUnstage")) return;
  gitSetStatus("正在取消暂存…");
  const r = await api.gitUnstage(paths);
  if (!r?.ok) gitSetStatus(r?.error || "取消暂存失败", "error");
  selectedGitStaged = false;
  await refreshGitStatus();
  await loadGitDiff();
}

function setGitButtons(canStage, canUnstage) {
  gitStageAll.disabled = !canStage;
  gitUnstageAll.disabled = !canUnstage;
  gitGenerateMessage.disabled = !canUnstage;
  gitCommitBtn.disabled = !canUnstage;
}

function gitSetStatus(text, kind = "") {
  gitCommitStatus.textContent = text || "";
  gitCommitStatus.classList.toggle("error", kind === "error");
  gitCommitStatus.classList.toggle("ok", kind === "ok");
}

gitRefresh.onclick = refreshGitStatus;
gitStageAll.onclick = async () => {
  const paths = (gitState?.files || []).filter((file) => file.unstaged).map((file) => file.path);
  await stageGitPaths(paths);
};
gitUnstageAll.onclick = async () => {
  const paths = (gitState?.files || []).filter((file) => file.staged).map((file) => file.path);
  await unstageGitPaths(paths);
};
gitWorktreeMode.onclick = async () => {
  selectedGitStaged = false;
  await loadGitDiff();
};
gitStagedMode.onclick = async () => {
  selectedGitStaged = true;
  await loadGitDiff();
};
gitGenerateMessage.onclick = async () => {
  if (!api.has("gitCommitMessage")) return;
  const r = await api.gitCommitMessage();
  if (!r?.ok) return gitSetStatus(r?.error || "生成 message 失败", "error");
  gitCommitMessage.value = r.message || "";
  gitSetStatus("已生成 commit message", "ok");
};
gitCommitBtn.onclick = async () => {
  if (!api.has("gitCommit")) return;
  const r = await api.gitCommit(gitCommitMessage.value);
  if (!r?.ok) return gitSetStatus(r?.error || "commit 失败", "error");
  gitCommitMessage.value = "";
  gitSetStatus(`已提交 ${r.hash || ""}`.trim(), "ok");
  selectedGitPath = "";
  await refreshGitStatus();
};

/* ---------- IPC in ---------- */
api.onReady((d) => {
  cwd = d.cwd;
  syncState({ cwd });
  setCurrentModelDisplay(d);
  setSidebarVersion(d.version);
  if (d.sessionId) activeRuntimeSessionId = d.sessionId;
  if (!busy && !currentSessionId && chatHasMessages()) currentSessionId = activeRuntimeSessionId;
  projName.textContent = shortPath(d.cwd);
  currentProject.textContent = shortPath(d.cwd);
  loadSessions();
  refreshWorkbench();
});
api.onOutput((s) => appendOutput(s));
api.onTurnDone(() => {
  setBusy(false);
  let finalStatus = "done";
  let finalDetail = "任务已结束";
  if (runState?.active) {
    finalStatus = runState.status === "error" || lastRunErrorDetail
      ? "error"
      : runState.status === "interrupted"
        ? "interrupted"
        : runState.status === "denied"
          ? "denied"
          : "done";
    finalDetail = finalStatus === "done" ? "任务已结束" : lastRunErrorDetail || runState.detail;
    finishRunStatus(finalStatus, finalDetail);
  }
  finishAgentMessageIfEmpty(finalStatus, finalDetail);
  if (liveSessionSnapshot?.id === runningSessionId) {
    liveSessionSnapshot = null;
  }
  runningSessionId = null;
  if (currentSessionId === null && activeRuntimeSessionId) currentSessionId = activeRuntimeSessionId;
  agentBody = null;
  loadSessions();
  refreshWorkbench();
  setTimeout(runNextQueuedInput, 80);
});
api.onToolEvent?.((event) => addToolEvent(event));
api.onDiffsChanged?.((nextDiffs) => setDiffs(nextDiffs));
api.onRuntimeQueue?.((state) => {
  runtimeQueueState = normalizeRuntimeQueue(state);
  syncState({ runtimeQueueState });
  renderQueueStatus();
});
api.onAsk(({ id, q }) => {
  askQ.textContent = q; askBox.classList.remove("hidden");
  askBox.querySelectorAll(".btn").forEach((b) => { b.onclick = () => { askBox.classList.add("hidden"); api.answer(id, b.dataset.v); }; });
  scrollDown();
});

/* ---------- sessions ---------- */
let allSessions = [];
let currentSessionId = null;
let activeRuntimeSessionId = null;
let runningSessionId = null;
let liveSessionSnapshot = null;

function formatSessionAge(value) {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "";
  const delta = Date.now() - ts;
  if (delta < 60_000) return "刚刚";
  if (delta < 60 * 60_000) return `${Math.max(1, Math.round(delta / 60_000))} 分钟前`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / (60 * 60_000))} 小时前`;
  if (delta < 7 * 24 * 60 * 60_000) return `${Math.round(delta / (24 * 60 * 60_000))} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function sessionMatchesFilter(session, filter) {
  if (!filter) return true;
  const q = filter.toLowerCase();
  return [
    session.firstPrompt,
    session.model,
    session.cwd,
  ].some((value) => String(value || "").toLowerCase().includes(q));
}

function chatHasMessages() {
  return Boolean(chat?.querySelector(".msg"));
}

function firstPromptFromVisibleChat() {
  const bubble = chat?.querySelector(".msg.user .bubble");
  const text = bubble?.childNodes?.[0]?.textContent || bubble?.textContent || "";
  return text.replace(/\s+/g, " ").trim();
}

function makeRuntimeSessionFallback() {
  const id = runningSessionId || activeRuntimeSessionId || currentSessionId;
  if (!id || allSessions.some((session) => session.id === id)) return null;
  const isRunning = Boolean(busy && runningSessionId === id);
  const hasLiveSnapshot = liveSessionSnapshot?.id === id;
  const visibleMessageCount = chat.querySelectorAll(".msg").length;
  if (!isRunning && !hasLiveSnapshot && !(currentSessionId === id && visibleMessageCount > 0)) return null;
  const messageCount = Math.max(visibleMessageCount, liveSessionSnapshot?.messageCount || 0, 1);
  const firstPrompt = firstPromptFromVisibleChat() || runState?.detail || liveSessionSnapshot?.firstPrompt || "正在进行的会话";
  return {
    id,
    cwd,
    model: currentModel?.model || "",
    updatedAt: Date.now(),
    firstPrompt,
    messageCount,
    transient: true,
    running: isRunning,
  };
}

async function loadSessions() {
  allSessions = await api.listSessions();
  const knownIds = new Set(allSessions.map((session) => session.id));
  const transientSessionId = runningSessionId || activeRuntimeSessionId;
  if (currentSessionId && !knownIds.has(currentSessionId) && currentSessionId !== transientSessionId) currentSessionId = null;
  syncState({ allSessions });
  renderSessions(searchInput.value.trim());
}
function renderSessions(filter) {
  const runtimeFallback = makeRuntimeSessionFallback();
  const source = runtimeFallback ? [runtimeFallback, ...allSessions] : allSessions;
  const list = source.filter((session) => sessionMatchesFilter(session, filter));
  sessionsEl.innerHTML = "";
  if (!list.length) { sessionsEl.innerHTML = `<div class="sessions-empty">还没有最近会话</div>`; return; }
  for (const s of list) {
    const running = Boolean(s.running || (busy && runningSessionId && s.id === runningSessionId));
    const transient = Boolean(s.transient);
    const el = document.createElement("div");
    el.className = `sess${s.id === currentSessionId ? " active" : ""}${running ? " sess-running" : ""}${transient ? " sess-transient" : ""}`;
    el.innerHTML = `<button class="sess-main" title="打开会话"><span class="t"></span><span class="s"><span class="sess-time"></span><span class="sess-count"></span></span></button><button class="sess-del" title="删除">×</button>`;
    el.querySelector(".t").textContent = (running ? "● " : "") + (s.firstPrompt || "(空会话)");
    el.querySelector(".sess-time").textContent = running ? "进行中" : transient ? "未保存" : s.replayOnly ? "回放" : formatSessionAge(s.updatedAt);
    el.querySelector(".sess-count").textContent = s.replayOnly ? `${s.eventCount || s.messageCount || 0} 事件` : `${s.messageCount || 0} 条`;
    el.querySelector(".sess-main").onclick = () => openSession(s.id);
    if (transient) {
      const del = el.querySelector(".sess-del");
      del.disabled = true;
      del.classList.add("hidden");
      del.title = "运行中的会话结束后可删除";
    }
    el.querySelector(".sess-del").onclick = async (e) => {
      e.stopPropagation();
      if (transient || (busy && s.id === runningSessionId)) return;
      await api.deleteSession(s.id);
      if (currentSessionId === s.id) currentSessionId = null;
      loadSessions();
    };
    sessionsEl.appendChild(el);
  }
}

function sessionMetaById(id) {
  return allSessions.find((session) => session.id === id) || (liveSessionSnapshot?.id === id ? liveSessionSnapshot : null);
}

function renderChatFromMessages(msgs) {
  chat.innerHTML = "";
  showChat();
  for (const m of msgs) {
    if (m.role === "user") addUserMessage(m.text);
    else { startAgentMessage(); agentBody.textContent = m.text; }
  }
  agentBody = null;
  agentRaw = "";
  scrollDown();
}

function saveLiveSessionSnapshot() {
  if (!busy || !runningSessionId) return;
  liveSessionSnapshot = {
    id: runningSessionId,
    chatHtml: chat.innerHTML,
    agentRaw,
    firstPrompt: runState?.detail || "",
    messageCount: Math.max(chat.querySelectorAll(".msg").length, 1),
  };
}

function restoreLiveSessionSnapshot() {
  if (!liveSessionSnapshot || liveSessionSnapshot.id !== runningSessionId) return false;
  chat.innerHTML = liveSessionSnapshot.chatHtml;
  agentRaw = liveSessionSnapshot.agentRaw;
  const bodies = chat.querySelectorAll(".msg.agent .agent-body");
  agentBody = bodies.length ? bodies[bodies.length - 1] : null;
  if (agentBody && agentRaw) agentBody.innerHTML = ansiToHtml(agentRaw);
  scrollDown();
  return true;
}

/** Open a saved session: restore it silently and render its history (no /resume echo). */
async function openSession(id) {
  if (!id) return;
  const meta = sessionMetaById(id);
  if (id === currentSessionId) {
    if (liveSessionSnapshot?.id === id) restoreLiveSessionSnapshot();
    if (!chatHasMessages()) {
      const msgs = await api.readSession(id).catch(() => []);
      if (msgs.length) renderChatFromMessages(msgs);
      else {
        chat.innerHTML = "";
        showChat();
        addSystemNote("这个会话还没有保存内容。发送第一条消息后会出现在最近列表。");
      }
    } else {
      showChat();
    }
    showChat();
    renderSessions(searchInput.value.trim());
    scrollDown();
    return;
  }

  if (meta?.replayOnly) {
    const msgs = await api.readSession(id).catch(() => []);
    currentSessionId = id;
    runningSessionId = null;
    liveSessionSnapshot = null;
    renderSessions(searchInput.value.trim());
    renderChatFromMessages(msgs);
    return;
  }

  if (busy && id === runningSessionId) {
    const previousSessionId = currentSessionId;
    currentSessionId = id;
    const restored = restoreLiveSessionSnapshot();
    if (!restored) {
      const msgs = await api.readSession(id).catch(() => []);
      if (msgs.length) renderChatFromMessages(msgs);
      else if (previousSessionId && previousSessionId !== id) {
        chat.innerHTML = "";
        addSystemNote("正在恢复进行中的会话，新的输出会继续显示在这里。");
      }
    }
    renderSessions(searchInput.value.trim());
    showChat();
    return;
  }

  if (busy) {
    if (currentSessionId === runningSessionId) saveLiveSessionSnapshot();
    const msgs = await api.readSession(id);
    currentSessionId = id;
    renderSessions(searchInput.value.trim());
    renderChatFromMessages(msgs);
    return;
  }

  const msgs = await api.resumeSession(id);
  currentSessionId = id;
  runningSessionId = null;
  activeRuntimeSessionId = id;
  liveSessionSnapshot = null;
  renderSessions(searchInput.value.trim());
  renderChatFromMessages(msgs);
}
searchInput.addEventListener("input", () => renderSessions(searchInput.value.trim()));

async function startNewConversation() {
  if (busy) {
    saveLiveSessionSnapshot();
    toast.info("当前任务仍在运行。请先等待完成或点击停止，再新建对话。");
    renderSessions(searchInput.value.trim());
    return;
  }
  const result = api.has("newSession") ? await api.newSession() : { ok: false };
  if (result?.ok && result.sessionId) {
    activeRuntimeSessionId = result.sessionId;
  } else {
    api.send("/clear");
    activeRuntimeSessionId = null;
  }
  currentSessionId = null;
  runningSessionId = null;
  liveSessionSnapshot = null;
  agentBody = null;
  agentRaw = "";
  chat.innerHTML = "";
  renderSessions(searchInput.value.trim());
  showHome();
  setGreeting();
}

/* ---------- greeting ---------- */
function setGreeting() {
  const h = new Date().getHours();
  greeting.textContent = h < 6 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}

/* ---------- command center ---------- */
function renderCommandCenter(filter = "") {
  const q = filter.toLowerCase();
  const items = COMMANDS.filter(([name, desc]) => {
    const category = COMMAND_CATEGORIES[name] || "命令";
    return !q || name.includes(q) || desc.toLowerCase().includes(q) || category.toLowerCase().includes(q);
  });
  const categories = new Set(items.map(([name]) => COMMAND_CATEGORIES[name] || "命令"));
  commandSummary.innerHTML = [
    ["命令", COMMANDS.length],
    ["当前匹配", items.length],
    ["分类", categories.size],
    ["输入框", input.value.trim() || "/"],
  ].map(([label, value]) => `<div class="job-stat"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`).join("");
  if (!items.length) {
    commandList.innerHTML = `<div class="cap-empty">没有匹配的命令。</div>`;
    return;
  }
  commandList.innerHTML = items.map(([name, desc]) => {
    const category = COMMAND_CATEGORIES[name] || "命令";
    return `
      <article class="command-item" data-command="${escapeHtml(name)}">
        <div class="command-icon"><span class="i-command"></span></div>
        <div class="command-main">
          <div class="command-name">${escapeHtml(name)}</div>
          <div class="command-desc">${escapeHtml(desc)}</div>
          <div class="command-meta">${escapeHtml(category)} · ${escapeHtml(commandBehaviorText(name))}</div>
        </div>
        <div class="command-actions">
          <button class="ghost" data-command-fill="${escapeHtml(name)}">填入</button>
          <button class="primary" data-command-run="${escapeHtml(name)}">${escapeHtml(commandActionLabel(name))}</button>
        </div>
      </article>`;
  }).join("");
  commandList.querySelectorAll("[data-command-fill]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      fillCommandInput(button.dataset.commandFill);
    };
  });
  commandList.querySelectorAll("[data-command-run]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      executeCommand(button.dataset.commandRun);
    };
  });
  commandList.querySelectorAll(".command-item").forEach((row) => {
    row.onclick = () => fillCommandInput(row.dataset.command);
  });
}

function commandBehaviorText(name) {
  if (["/models", "/diff", "/mcp", "/sessions", "/tools"].includes(name)) return "打开对应工作台";
  if (name === "/clear") return "清空当前对话";
  return "发送给 runtime 执行";
}

function commandActionLabel(name) {
  if (name === "/models") return "打开配置";
  if (name === "/diff") return "打开 Git";
  if (name === "/mcp") return "打开 MCP";
  if (name === "/sessions") return "查看最近";
  if (name === "/tools") return "打开工具";
  if (name === "/clear") return "清空";
  return "运行";
}

function fillCommandInput(name) {
  if (!name) return;
  input.value = `${name} `;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  hideMenu();
  input.focus();
  renderCommandCenter(commandSearch.value.trim());
}

function executeCommand(name) {
  if (!name) return;
  if (name === "/models") return openSettings("model");
  if (name === "/diff") return showGit();
  if (name === "/mcp") return showCapabilities("mcp");
  if (name === "/sessions") {
    showHome();
    const wrap = $("searchWrap");
    wrap.classList.remove("hidden");
    searchInput.focus();
    return;
  }
  if (name === "/tools") return showIndustrialProject();
  if (name === "/clear") {
    chat.innerHTML = "";
    api.send("/clear");
    showHome();
    setGreeting();
    return;
  }
  runLine(name);
}

/* ---------- sidebar + composer controls ---------- */
function resetSidebarScroll() {
  const sideScroll = document.querySelector(".side-scroll");
  if (sideScroll) sideScroll.scrollTop = 0;
}

function scheduleSidebarScrollReset() {
  resetSidebarScroll();
  requestAnimationFrame(resetSidebarScroll);
  window.setTimeout(resetSidebarScroll, 80);
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-nav-collapsed", collapsed);
  const toggle = $("sidebarToggle");
  if (!toggle) return;
  toggle.setAttribute("aria-pressed", collapsed ? "true" : "false");
  toggle.setAttribute("aria-label", collapsed ? "展开菜单" : "收起菜单");
  toggle.setAttribute("title", collapsed ? "展开菜单" : "收起菜单");
  const label = toggle.querySelector(".sidebar-toggle-label");
  if (label) label.textContent = collapsed ? "展开菜单" : "收起菜单";
}

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Local storage can be unavailable in hardened test shells; the UI state still updates.
  }
}

function initSidebarCollapse() {
  setSidebarCollapsed(readSidebarCollapsed());
  scheduleSidebarScrollReset();
  const toggle = $("sidebarToggle");
  if (!toggle) return;
  toggle.onclick = () => {
    const collapsed = !document.body.classList.contains("sidebar-nav-collapsed");
    writeSidebarCollapsed(collapsed);
    setSidebarCollapsed(collapsed);
    scheduleSidebarScrollReset();
  };
}

initSidebarCollapse();
$("newChat").onclick = startNewConversation;
$("searchToggle").onclick = () => {
  const w = $("searchWrap"); w.classList.toggle("hidden");
  if (!w.classList.contains("hidden")) searchInput.focus(); else { searchInput.value = ""; renderSessions(""); }
};
$("cmdBtn").onclick = showCommandCenter;
commandSearch.addEventListener("input", () => renderCommandCenter(commandSearch.value.trim()));
commandFocusInput.onclick = () => {
  if (!input.value.trim()) input.value = "/";
  input.focus();
  if (input.value === "/") showMenu("/");
};
commandRunInput.onclick = () => {
  const text = input.value.trim();
  if (!text) return;
  if (text.startsWith("/") && text.split(/\s+/).length === 1) return executeCommand(text);
  submit();
};
async function pickFolder() {
  const dir = await api.pickFolder();
  if (dir) {
    cwd = dir;
    syncState({ cwd });
    projName.textContent = shortPath(dir);
    currentProject.textContent = shortPath(dir);
    chat.innerHTML = "";
    loadSessions();
    if (inChat) addSystemNote("已切换到 " + dir);
  }
}
async function chooseImageAttachment() {
  const result = await api.attachImage({});
  if (result?.canceled) return;
  if (!appendPendingAttachment(result)) {
    toast.error(result?.error || "图片附件失败");
    return;
  }
  const message = visionCapabilityNotice();
  if (currentModel.capabilities?.vision?.status === "supported") toast.ok(message);
  else toast.info(message);
}
async function attachImageDataUrl(dataUrl, name = "pasted-image.png") {
  const result = await api.attachImage({ dataUrl, name });
  if (!appendPendingAttachment(result)) {
    toast.error(result?.error || "图片附件失败");
    return false;
  }
  const message = visionCapabilityNotice();
  if (currentModel.capabilities?.vision?.status === "supported") toast.ok(message);
  else toast.info(message);
  return true;
}
function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}
async function attachImageFile(file) {
  if (!file || !String(file.type || "").startsWith("image/")) return false;
  try {
    const dataUrl = await readImageFileAsDataUrl(file);
    return attachImageDataUrl(dataUrl, file.name || "image.png");
  } catch (error) {
    toast.error(error?.message || "图片读取失败");
    return false;
  }
}
$("projRow").onclick = pickFolder;
$("settingsBtn").onclick = () => openSettings("usage");
$("filesBtn").onclick = () => fileTree.open(cwd);
$("jobsBtn").onclick = () => showJobCenter();
$("arenaBtn").onclick = showPatchArena;
$("industrialBtn").onclick = showIndustrialProject;
$("gitBtn").onclick = showGit;
$("storeBtn").onclick = showStore;
$("pluginsBtn").onclick = () => showCapabilities("plugins");
$("skillsBtn").onclick = () => showCapabilities("skills");
$("agentsBtn").onclick = () => showCapabilities("agents");
$("mcpBtn").onclick = () => showCapabilities("mcp");
storeConfirmClose.onclick = closeStoreInstallPreview;
storeConfirmCancel.onclick = closeStoreInstallPreview;
storeConfirmInstall.onclick = confirmStoreInstall;
$("diffBtn").onclick = showGit;
$("jobsTopBtn").onclick = () => showJobCenter();
$("arenaTopBtn").onclick = showPatchArena;
$("industrialTopBtn").onclick = showIndustrialProject;
$("modelsBtn").onclick = () => openSettings("model");
timelineDrawerBtn.onclick = () => setWorkbenchDrawer(document.body.classList.contains("timeline-drawer-open") ? "" : "timeline");
diffDrawerBtn.onclick = () => setWorkbenchDrawer(document.body.classList.contains("diff-drawer-open") ? "" : "diff");
workbenchDrawerBackdrop.onclick = closeWorkbenchDrawers;
attachBtn.onclick = chooseImageAttachment;
modelPill.onclick = (e) => {
  e.stopPropagation();
  toggleModelPicker();
};
modelPicker.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => hideModelPicker());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideModelPicker();
    closeWorkbenchDrawers();
  }
});
accessBtn.onclick = () => {
  yolo = !yolo;
  accessBtn.classList.toggle("full", yolo);
  accessLabel.textContent = yolo ? "完全访问" : "需确认";
  api.send("/yolo");
};
sendBtn.onclick = submit;
if (queueClear) queueClear.onclick = async () => {
  queuedInputs = [];
  syncState({ queuedInputs });
  try {
    if (api.has("clearRuntimeQueue")) await api.clearRuntimeQueue();
  } finally {
    renderQueueStatus();
  }
};
stopBtn.onclick = () => {
  if (!busy) return;
  updateRunStatus({ label: "正在停止", detail: "已请求中断当前任务", status: "interrupted" });
  api.interrupt();
};

/* ---------- quick cards ---------- */
mountAiTeamPanel({
  cards: document.querySelectorAll(".qcard"),
  input,
  openSettings,
  runLine,
});

/* ---------- capabilities ---------- */
async function getCapabilities(refresh = false) {
  if (!capabilityCache || refresh) capabilityCache = await api.listCapabilities();
  syncState({ capabilityCache });
  return capabilityCache;
}

function storeKindFromCapability(kind) {
  return { plugins: "plugin", skills: "skill", agents: "agent", mcp: "mcp" }[kind] || kind;
}

function capabilityItemKey(kind, item = {}) {
  return `${kind}:${item.storeItemId || item.id || item.name || item.path || item.source || ""}`;
}

function capabilityStoreIdCandidates(item = {}) {
  return Array.from(new Set([item.storeItemId, item.id, item.name].filter(Boolean).map(String)));
}

function isStoreManagedCapabilityCandidate(item = {}) {
  const sourceText = [item.source, item.path, item.storeItemId].filter(Boolean).join(" ");
  return Boolean(item.storeItemId || item.id || /Hi Code Store|[/\\]\.(?:vibe|hicode)[/\\]store|~[/\\]\.(?:vibe|hicode)[/\\]store/.test(sourceText));
}

async function getCapabilityStoreItems(kind, items) {
  const expectedKind = storeKindFromCapability(kind);
  const managed = new Map();
  const candidates = items.filter(isStoreManagedCapabilityCandidate);
  await Promise.all(candidates.map(async (item) => {
    for (const id of capabilityStoreIdCandidates(item)) {
      const result = await (api.getStoreItemSilent ? api.getStoreItemSilent(id) : api.getStoreItem(id));
      const storeItem = result?.item;
      if (result?.ok && storeItem?.installed && storeItem.kind === expectedKind) {
        managed.set(capabilityItemKey(kind, item), storeItem);
        return;
      }
    }
  }));
  return managed;
}

async function renderCapabilities(kind, refresh = false) {
  const meta = CAPABILITY_META[kind];
  const all = await getCapabilities(refresh);
  const items = all[kind] || [];
  const managedStoreItems = await getCapabilityStoreItems(kind, items);
  capTitle.textContent = meta.title;
  capSubtitle.textContent = meta.subtitle;
  capActions.innerHTML = "";
  capSummary.innerHTML = "";
  capList.innerHTML = "";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "ghost";
  refreshBtn.textContent = "刷新";
  refreshBtn.onclick = () => renderCapabilities(kind, true);
  capActions.appendChild(refreshBtn);

  if (kind === "mcp") {
    const cfgBtn = document.createElement("button");
    cfgBtn.className = "primary";
    cfgBtn.textContent = "配置 MCP";
    cfgBtn.onclick = openMcpSettings;
    capActions.appendChild(cfgBtn);
  }

  const stats = [
    ["插件", all.plugins?.length || 0],
    ["技能", all.skills?.length || 0],
    ["MCP", all.mcp?.length || 0],
    ["智能体", all.agents?.length || 0],
  ];
  for (const [label, value] of stats) {
    const stat = document.createElement("div");
    stat.className = "cap-stat";
    stat.innerHTML = `<b></b><span></span>`;
    stat.querySelector("b").textContent = String(value);
    stat.querySelector("span").textContent = label;
    capSummary.appendChild(stat);
  }

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "cap-empty";
    empty.textContent = meta.empty;
    capList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "cap-item";
    row.innerHTML = `
      <div class="cap-icon"><span class="${meta.icon}"></span></div>
      <div class="cap-main">
        <div class="cap-name"></div>
        <div class="cap-desc"></div>
        <div class="cap-meta"></div>
      </div>
      <div class="store-actions capability-actions"></div>
    `;
    row.querySelector(".cap-name").textContent = item.name;
    row.querySelector(".cap-desc").textContent = capabilityDescription(kind, item);
    row.querySelector(".cap-meta").textContent = capabilityMeta(kind, item);
    renderCapabilityActions(row.querySelector(".capability-actions"), kind, item, managedStoreItems.get(capabilityItemKey(kind, item)));
    capList.appendChild(row);
  }
}

function renderCapabilityActions(actions, kind, item, storeItem) {
  actions.innerHTML = "";
  const lifecycle = capabilityLifecycleState(kind, item, storeItem);
  if (lifecycle.managed) {
    const badge = document.createElement("span");
    badge.className = `cap-badge installed${lifecycle.enabled ? "" : " disabled"}`;
    badge.textContent = lifecycle.statusLabel;
    actions.appendChild(badge);
    if (lifecycle.useLabel) {
      const use = document.createElement("button");
      use.className = "cap-badge";
      use.textContent = lifecycle.useLabel;
      use.onclick = () => useCapability(kind, item);
      actions.appendChild(use);
    }
    const toggle = document.createElement("button");
    toggle.className = "cap-badge";
    toggle.textContent = lifecycle.toggleLabel;
    toggle.onclick = () => storeManageItem(storeItem.id, lifecycle.toggleAction, { returnToCapability: kind });
    actions.appendChild(toggle);
    const uninstall = document.createElement("button");
    uninstall.className = "cap-badge danger";
    uninstall.textContent = lifecycle.destructiveLabel;
    uninstall.onclick = () => storeManageItem(storeItem.id, lifecycle.destructiveAction, { returnToCapability: kind });
    actions.appendChild(uninstall);
    return;
  }
  if (lifecycle.useLabel) {
    const action = document.createElement("button");
    action.className = "cap-badge";
    action.textContent = lifecycle.useLabel;
    action.onclick = () => useCapability(kind, item);
    actions.appendChild(action);
  }
  const readonly = document.createElement("span");
  readonly.className = "cap-badge readonly";
  readonly.title = lifecycle.readonlyReason;
  readonly.textContent = lifecycle.statusLabel;
  actions.appendChild(readonly);
}

function useCapability(kind, item) {
  if (kind === "skills") {
    showHome();
    input.value = `$${item.name} `;
    input.focus();
    return;
  }
  if (kind === "agents") {
    showIndustrialProject();
    toast.ok(`已打开智能体分工面板：${item.name || "智能体"}`);
    return;
  }
  if (kind === "mcp") {
    runLine("/mcp");
  }
}

/* ---------- store ---------- */
function storeQueryOptions() {
  return buildStoreQueryOptions(storeQuery);
}

async function getStore(refresh = false) {
  const key = JSON.stringify(storeQueryOptions());
  if (!storeCache || refresh || storeCacheKey !== key) {
    storeCache = await api.listStore(storeQueryOptions());
    storeCacheKey = key;
    syncState({ storeCache, storeCacheKey });
  }
  return storeCache;
}

function commitStoreSearch(value, immediate = false) {
  storeQuery = value;
  storeMessage = "";
  storePage = 1;
  syncState({ storeQuery, storeMessage, storePage });
  if (storeSearchTimer) clearTimeout(storeSearchTimer);
  const run = () => {
    storeCache = null;
    syncState({ storeCache });
    renderStore(true);
  };
  if (immediate) run();
  else storeSearchTimer = setTimeout(run, 260);
}

async function renderStore(refresh = false) {
  const requestSeq = ++storeRequestSeq;
  const keepSearchFocus = document.activeElement?.id === "storeSearchInput";
  const store = await getStore(refresh);
  if (requestSeq !== storeRequestSeq) return;
  const items = store.items || [];
  const activeSource = store.source || (store.sources || []).find((s) => s.id === store.sourceId) || {};
  capTitle.textContent = "技能商店";
  capSubtitle.textContent = `当前源：${activeSource.name || "全部源"}。${activeSource.note || "聚合展示插件、技能、MCP 和智能体，搜索后可直接安装。"}`;
  capActions.innerHTML = "";
  capSummary.innerHTML = "";
  capList.innerHTML = "";

  const searchWrap = document.createElement("div");
  searchWrap.className = "store-search";
  const searchIcon = document.createElement("span");
  searchIcon.className = "i-search";
  const searchInput = document.createElement("input");
  searchInput.id = "storeSearchInput";
  searchInput.type = "search";
  searchInput.placeholder = "搜索插件 / 技能 / MCP / 智能体";
  searchInput.value = storeQuery;
  searchInput.oncompositionstart = () => {
    storeSearchComposing = true;
  };
  searchInput.oncompositionend = () => {
    storeSearchComposing = false;
    commitStoreSearch(searchInput.value, true);
  };
  searchInput.oninput = (e) => {
    if (storeSearchComposing || e.isComposing) return;
    commitStoreSearch(searchInput.value);
  };
  searchInput.onkeydown = (e) => {
    if (storeSearchComposing || e.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitStoreSearch(searchInput.value, true);
    }
  };
  searchWrap.append(searchIcon, searchInput);
  if (storeQuery) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "store-search-clear";
    clearBtn.textContent = "清除";
    clearBtn.onclick = () => {
      storeQuery = "";
      storeMessage = "";
      storePage = 1;
      storeCache = null;
      syncState({ storeQuery, storeMessage, storePage, storeCache });
      renderStore(true);
    };
    searchWrap.appendChild(clearBtn);
  }
  capActions.appendChild(searchWrap);

  const sourceSelect = document.createElement("select");
  sourceSelect.className = "store-source";
  sourceSelect.title = "选择下载源";
  for (const source of store.sources || []) {
    const opt = document.createElement("option");
    opt.value = source.id;
    opt.textContent = `${source.region === "CN" ? "国内 · " : source.region === "Local" ? "本机 · " : source.id?.startsWith("github") ? "GitHub · " : source.region === "All" ? "" : ""}${source.name}`;
    opt.selected = source.id === store.sourceId;
    sourceSelect.appendChild(opt);
  }
  sourceSelect.onchange = async () => {
    await api.setStoreSource(sourceSelect.value);
    storeCache = null;
    storePage = 1;
    storeMessage = "来源已切换，已按当前搜索重新查询。";
    syncState({ storeCache, storePage, storeMessage });
    renderStore(true);
  };
  capActions.appendChild(sourceSelect);

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "ghost";
  refreshBtn.textContent = "刷新";
  refreshBtn.onclick = () => {
    storeCache = null;
    syncState({ storeCache });
    renderStore(true);
  };
  capActions.appendChild(refreshBtn);

  const kinds = ["plugin", "skill", "mcp", "agent"];
  for (const kind of kinds) {
    const stat = document.createElement("div");
    stat.className = "cap-stat";
    stat.innerHTML = `<b></b><span></span>`;
    stat.querySelector("b").textContent = String(items.filter((x) => x.kind === kind).length);
    stat.querySelector("span").textContent = STORE_KIND_LABELS[kind];
    capSummary.appendChild(stat);
  }

  const filters = document.createElement("div");
  filters.className = "store-filters";
  const filtered = items.filter((item) =>
    (storeKind === "all" || item.kind === storeKind) &&
    (storeCategory === "all" || (item.category || "other") === storeCategory)
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / STORE_PAGE_SIZE));
  storePage = Math.min(Math.max(1, storePage), totalPages);
  const pageStart = (storePage - 1) * STORE_PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + STORE_PAGE_SIZE);
  const resultInfo = document.createElement("div");
  resultInfo.className = "store-result-info";
  const totalItems = Number.isFinite(store.totalItems) ? store.totalItems : items.length;
  const sourceName = activeSource.name || "全部源";
  const pageRange = filtered.length
    ? ` · 第 ${storePage} / ${totalPages} 页 · ${pageStart + 1}-${Math.min(pageStart + STORE_PAGE_SIZE, filtered.length)}`
    : "";
  resultInfo.textContent = storeQuery.trim()
    ? `${sourceName} 搜索“${storeQuery.trim()}”：命中 ${filtered.length} / ${totalItems}${pageRange}`
    : `${sourceName}：显示 ${filtered.length} / ${totalItems} 个条目${pageRange}`;
  const kindBar = document.createElement("div");
  kindBar.className = "store-segment";
  for (const kind of ["all", ...kinds]) {
    const btn = document.createElement("button");
    btn.className = kind === storeKind ? "active" : "";
    btn.textContent = STORE_KIND_LABELS[kind];
    btn.onclick = () => { storeKind = kind; storePage = 1; syncState({ storeKind, storePage }); renderStore(); };
    kindBar.appendChild(btn);
  }
  const categories = ["all", ...Array.from(new Set(items.map((x) => x.category || "other"))).sort()];
  if (storeCategory !== "all" && !categories.includes(storeCategory)) categories.push(storeCategory);
  const catBar = document.createElement("div");
  catBar.className = "store-segment";
  for (const cat of categories) {
    const btn = document.createElement("button");
    btn.className = cat === storeCategory ? "active" : "";
    btn.textContent = STORE_CATEGORY_LABELS[cat] || cat;
    btn.onclick = () => { storeCategory = cat; storePage = 1; syncState({ storeCategory, storePage }); renderStore(); };
    catBar.appendChild(btn);
  }
  filters.append(resultInfo, kindBar, catBar);
  capList.appendChild(filters);

  if (storeMessage) {
    const msg = document.createElement("div");
    msg.className = "store-message";
    msg.textContent = storeMessage;
    capList.appendChild(msg);
  }

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "cap-empty";
    empty.textContent = storeQuery.trim()
      ? `没有在 ${sourceName} 中找到“${storeQuery.trim()}”。可以换一个来源、调整分类，或清空搜索。`
      : "当前筛选下没有可安装条目。";
    capList.appendChild(empty);
    if (keepSearchFocus) restoreStoreSearchFocus(searchInput);
    return;
  }

  if (filtered.length > STORE_PAGE_SIZE) {
    capList.appendChild(renderStorePager(filtered.length));
  }

  for (const item of pageItems) {
    const row = document.createElement("div");
    row.className = "cap-item store-item";
    row.tabIndex = 0;
    row.innerHTML = `
      <div class="cap-icon"><span class="${storeIcon(item.kind)}"></span></div>
      <div class="cap-main">
        <div class="cap-name"></div>
        <div class="cap-desc"></div>
        <div class="cap-meta"></div>
      </div>
      <div class="store-actions"></div>
    `;
    row.onclick = (event) => {
      if (event.target.closest("button")) return;
      openStoreItemDetail(item.id);
    };
    row.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openStoreItemDetail(item.id);
      }
    };
    row.querySelector(".cap-name").textContent = item.name;
    row.querySelector(".cap-desc").textContent = item.summary || "";
    const itemSource = item.sourceName || (item.source === "builtin" ? "内置" : item.source || sourceName);
    row.querySelector(".cap-meta").textContent = [
      STORE_KIND_LABELS[item.kind] || item.kind,
      STORE_CATEGORY_LABELS[item.category] || item.category || "其他",
      itemSource,
      (item.tags || []).join(", "),
    ].filter(Boolean).join(" · ");
    const actions = row.querySelector(".store-actions");
    const actionState = storeInstallActionState(item);
    if (item.installed) {
      const badge = document.createElement("span");
      badge.className = `cap-badge installed${item.enabled === false ? " disabled" : ""}`;
      badge.textContent = actionState.secondary;
      actions.appendChild(badge);
      const toggle = document.createElement("button");
      toggle.className = "cap-badge";
      toggle.textContent = actionState.primary;
      toggle.onclick = () => storeManageItem(item.id, item.enabled === false ? "enable" : "disable");
      actions.appendChild(toggle);
      const uninstall = document.createElement("button");
      uninstall.className = "cap-badge danger";
      uninstall.textContent = actionState.destructive;
      uninstall.onclick = () => storeManageItem(item.id, "uninstall");
      actions.appendChild(uninstall);
    } else {
      const detail = document.createElement("button");
      detail.className = "cap-badge";
      detail.textContent = "详情";
      detail.onclick = () => openStoreItemDetail(item.id);
      actions.appendChild(detail);
      const install = document.createElement("button");
      install.className = "cap-badge primary";
      install.textContent = "安装";
      install.onclick = () => openStoreInstallPreview(item.id);
      actions.appendChild(install);
    }
    capList.appendChild(row);
  }
  if (filtered.length > STORE_PAGE_SIZE) {
    capList.appendChild(renderStorePager(filtered.length));
  }
  if (keepSearchFocus) restoreStoreSearchFocus(searchInput);
}

function renderStorePager(total) {
  const totalPages = Math.max(1, Math.ceil(total / STORE_PAGE_SIZE));
  const pager = document.createElement("div");
  pager.className = "store-pager";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "上一页";
  prev.disabled = storePage <= 1;
  prev.onclick = () => {
    storePage = Math.max(1, storePage - 1);
    renderStore();
  };
  const label = document.createElement("span");
  label.textContent = `第 ${storePage} / ${totalPages} 页`;
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "下一页";
  next.disabled = storePage >= totalPages;
  next.onclick = () => {
    storePage = Math.min(totalPages, storePage + 1);
    renderStore();
  };
  pager.append(prev, label, next);
  return pager;
}

function ensureStoreDetailModal() {
  let modal = document.getElementById("storeDetail");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "storeDetail";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-card store-detail-card">
      <div class="settings-head">
        <div>
          <div class="modal-title" id="storeDetailTitle">扩展详情</div>
          <div class="muted" id="storeDetailSub">查看来源、作用和安装状态。</div>
        </div>
        <button id="storeDetailClose" class="icon-btn" title="关闭">×</button>
      </div>
      <div class="store-detail-body">
        <div id="storeDetailSummary" class="store-detail-summary"></div>
        <div id="storeDetailTranslation" class="store-detail-translation hidden"></div>
        <div id="storeDetailMeta" class="store-detail-meta"></div>
        <div id="storeDetailInstallInfo" class="store-confirm-warnings hidden"></div>
      </div>
      <div class="modal-foot store-confirm-foot">
        <button id="storeDetailTranslate" class="ghost">翻译成中文</button>
        <button id="storeDetailUninstall" class="ghost danger hidden">卸载</button>
        <button id="storeDetailInstall" class="primary">安装</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#storeDetailClose").onclick = () => modal.classList.add("hidden");
  modal.onclick = (event) => {
    if (event.target === modal) modal.classList.add("hidden");
  };
  return modal;
}

async function openStoreItemDetail(itemId) {
  const result = await api.getStoreItem(itemId);
  if (!result.ok) {
    toast.error(result.error || "无法打开商店条目详情");
    return;
  }
  const modal = ensureStoreDetailModal();
  const item = result.item || {};
  const originalSummary = item.summary || "暂无简介。";
  const translatedCandidate = String(result.detail?.translatedSummary || "").trim();
  const translated = storeChineseSummary({ ...item, translatedSummary: translatedCandidate || "" });
  let showingTranslated = false;
  modal.querySelector("#storeDetailTitle").textContent = item.name || itemId;
  modal.querySelector("#storeDetailSub").textContent = [
    STORE_KIND_LABELS[item.kind] || item.kind || "扩展",
    STORE_CATEGORY_LABELS[item.category] || item.category || "其他",
    item.sourceName || item.source || item.sourceId,
    item.installed ? (item.enabled === false ? "已安装，当前禁用" : "已安装，当前启用") : "未安装",
  ].filter(Boolean).join(" · ");
  modal.querySelector("#storeDetailSummary").textContent = originalSummary;
  const translation = modal.querySelector("#storeDetailTranslation");
  translation.textContent = "点击“翻译成中文”可查看该条目的中文作用说明。";
  translation.classList.add("hidden");
  modal.querySelector("#storeDetailMeta").innerHTML = [
    ["ID", item.id],
    ["标签", (item.tags || []).join(", ")],
    ["安装时间", item.installedAt ? new Date(item.installedAt).toLocaleString() : ""],
  ].filter(([, value]) => value).map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("");
  const info = modal.querySelector("#storeDetailInstallInfo");
  const installRecord = result.detail?.installedRecord;
  if (installRecord?.result) {
    info.classList.remove("hidden");
    const imported = (installRecord.result.imported || []).map((entry) => `${entry.kind}: ${entry.path}`).join("；");
    const warnings = (installRecord.result.warnings || []).join("；");
    info.innerHTML = "";
    for (const line of [imported ? `已导入：${imported}` : "", warnings ? `提示：${warnings}` : ""].filter(Boolean)) {
      const row = document.createElement("div");
      row.textContent = line;
      info.appendChild(row);
    }
  } else {
    info.classList.add("hidden");
    info.innerHTML = "";
  }
  const translateBtn = modal.querySelector("#storeDetailTranslate");
  translateBtn.textContent = "翻译成中文";
  translateBtn.onclick = () => {
    showingTranslated = !showingTranslated;
    modal.querySelector("#storeDetailSummary").textContent = showingTranslated ? translated : originalSummary;
    translation.textContent = showingTranslated ? "已显示中文说明。本地翻译用于帮助理解，安装前仍应确认来源和权限。" : "点击“翻译成中文”可查看该条目的中文作用说明。";
    translation.classList.toggle("hidden", !showingTranslated);
    translateBtn.textContent = showingTranslated ? "查看原文" : "翻译成中文";
  };
  const installBtn = modal.querySelector("#storeDetailInstall");
  const uninstallBtn = modal.querySelector("#storeDetailUninstall");
  installBtn.textContent = item.installed ? (item.enabled === false ? "启用" : "禁用") : "安装";
  installBtn.onclick = async () => {
    modal.classList.add("hidden");
    if (!item.installed) return openStoreInstallPreview(item.id);
    return storeManageItem(item.id, item.enabled === false ? "enable" : "disable");
  };
  uninstallBtn.classList.toggle("hidden", !item.installed);
  uninstallBtn.onclick = async () => {
    modal.classList.add("hidden");
    return storeManageItem(item.id, "uninstall");
  };
  modal.classList.remove("hidden");
}

async function storeManageItem(itemId, action, options = {}) {
  const labels = { enable: "启用", disable: "禁用", uninstall: "卸载" };
  if (action === "uninstall" && !window.confirm("确定卸载这个商店条目吗？相关商店缓存和导入文件会被移除。")) return;
  const method = action === "enable" ? api.enableStoreItem : action === "disable" ? api.disableStoreItem : api.uninstallStoreItem;
  const result = await method(itemId);
  if (!result.ok) {
    toast.error(result.error || `${labels[action] || "操作"}失败`);
    return;
  }
  storeMessage = `${result.item?.name || itemId} 已${labels[action] || "更新"}。`;
  capabilityCache = null;
  storeCache = null;
  syncState({ storeMessage, capabilityCache, storeCache });
  toast.ok(storeMessage);
  if (options.returnToCapability) await renderCapabilities(options.returnToCapability, true);
  else await renderStore(true);
}

async function openStoreInstallPreview(itemId) {
  const result = await api.previewStoreItem(itemId);
  if (!result.ok) {
    storeMessage = result.error || "无法生成安装预览";
    await renderStore();
    return;
  }
  const preview = result.preview;
  pendingStoreInstall = preview.item?.id || itemId;
  syncState({ pendingStoreInstall });
  storeConfirmTitle.textContent = `安装 ${preview.item?.name || itemId}`;
  storeConfirmSub.textContent = `${STORE_KIND_LABELS[preview.item?.kind] || preview.item?.kind || "扩展"} · ${preview.source?.name || "下载源"}`;
  storeConfirmSummary.textContent = preview.item?.summary || "安装前请确认下面的文件变更和权限说明。";
  renderStorePreviewList(storeConfirmChanges, preview.changes || [], (change) =>
    `${STORE_ACTION_LABELS[change.action] || change.action} · ${change.target}${change.detail ? ` · ${change.detail}` : ""}`
  );
  renderStorePreviewList(storeConfirmPerms, preview.permissions || [], (permission) => permission);
  const warnings = [
    ...(preview.warnings || []),
    ...(preview.env || []).filter((e) => e.required).map((e) => `需要配置环境变量 ${e.key}`),
    preview.restartRequired ? "MCP 安装后可能需要重启应用或重新初始化 MCP 连接。" : "",
  ].filter(Boolean);
  if (warnings.length) {
    storeConfirmWarnings.classList.remove("hidden");
    storeConfirmWarnings.innerHTML = "";
    for (const warning of warnings) {
      const item = document.createElement("div");
      item.textContent = warning;
      storeConfirmWarnings.appendChild(item);
    }
  } else {
    storeConfirmWarnings.classList.add("hidden");
    storeConfirmWarnings.innerHTML = "";
  }
  storeConfirmInstall.textContent = "确认安装";
  storeConfirmInstall.disabled = false;
  storeConfirm.classList.remove("hidden");
}

function renderStorePreviewList(root, items, format) {
  root.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "store-confirm-empty";
    empty.textContent = "没有需要展示的项目。";
    root.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "store-confirm-row";
    row.textContent = format(item);
    root.appendChild(row);
  }
}

function closeStoreInstallPreview() {
  pendingStoreInstall = null;
  syncState({ pendingStoreInstall });
  storeConfirm.classList.add("hidden");
}

async function confirmStoreInstall() {
  if (!pendingStoreInstall) return;
  const itemId = pendingStoreInstall;
  storeConfirmInstall.textContent = "安装中";
  storeConfirmInstall.disabled = true;
  const result = await api.installStoreItem(itemId, { allowUnverifiedDownload: true });
  if (result.ok) {
    storeMessage = `${result.item?.name || itemId} 已安装。`;
    capabilityCache = null;
    storeCache = null;
    syncState({ storeMessage, capabilityCache, storeCache });
    closeStoreInstallPreview();
    await renderStore(true);
  } else {
    storeConfirmInstall.textContent = "确认安装";
    storeConfirmInstall.disabled = false;
    storeConfirmWarnings.classList.remove("hidden");
    const item = document.createElement("div");
    item.textContent = result.error || "安装失败";
    storeConfirmWarnings.appendChild(item);
  }
}

function restoreStoreSearchFocus(inputEl) {
  setTimeout(() => {
    inputEl.focus();
    const end = inputEl.value.length;
    inputEl.setSelectionRange(end, end);
  }, 0);
}

/* ---------- settings ---------- */
const SETTINGS_TAB_META = {
  usage: ["用量与统计", "Token 消耗、活动热力图与会话概览"],
  model: ["接入模型 API", "默认写入 ~/.hicode/config.json"],
  chat: ["对话与推理", "推理深度与上下文压缩策略"],
  safety: ["权限与安全", "命令沙箱与始终生效的安全边界"],
  mcp: ["MCP 服务器", "只编辑 ~/.hicode/config.json 里的 mcpServers"],
  data: ["数据与存储", "本地数据的位置与打开入口"],
  about: ["关于 Hi Code", "版本、运行环境与开源信息"],
};

async function openSettings(tab = "usage") {
  setCfgStatus("");
  cfgText = (await api.getConfig()) || "";
  syncState({ cfgText });
  cfg.value = cfgText || JSON.stringify(makeConfigFromQuick({}), null, 2);
  hydrateQuickForm(cfg.value);
  advancedConfig.classList.add("hidden");
  settings.classList.remove("hidden");
  await switchSettingsTab(tab);
}

async function openMcpSettings() {
  return openSettings("mcp");
}

async function switchSettingsTab(tab) {
  settingsMode = SETTINGS_TAB_META[tab] ? tab : "usage";
  const [title, subtitle] = SETTINGS_TAB_META[settingsMode];
  settingsTitle.textContent = title;
  settingsSubtitle.textContent = subtitle;
  settingsNav.querySelectorAll(".settings-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsTab === settingsMode);
  });
  settings.classList.add("settings-switching");
  for (const [name, section] of Object.entries(settingsSections)) {
    const active = name === settingsMode;
    section.classList.toggle("hidden", !active);
    section.classList.toggle("is-active", active);
  }
  window.setTimeout(() => settings.classList.remove("settings-switching"), 180);
  setCfgStatus("");
  if (settingsMode === "usage") await renderUsageSettings();
  if (settingsMode === "model") setTimeout(() => quickApiKey.focus(), 0);
  if (settingsMode === "chat") await renderChatSettings();
  if (settingsMode === "safety") await renderSafetySettings();
  if (settingsMode === "mcp") await renderMcpSettings();
  if (settingsMode === "data" || settingsMode === "about") await renderAppInfoSettings();
}

async function renderUsageSettings() {
  if (!usagePanelRoot) return;
  usagePanelRoot.classList.remove("is-mounted");
  usagePanelRoot.innerHTML = '<div class="settings-hint usage-loading">正在加载用量数据…</div>';
  const [stats, auth] = await Promise.all([api.getUsageStats(), api.authStatus()]);
  if (auth?.user) applyUserProfile(auth.user);
  renderUsagePanel(usagePanelRoot, stats, { profile: cachedUserProfile });
}

settingsNav.querySelectorAll(".settings-tab").forEach((btn) => {
  btn.onclick = () => switchSettingsTab(btn.dataset.settingsTab);
});

async function currentConfigObject() {
  cfgText = (await api.getConfig()) || cfgText || "";
  syncState({ cfgText });
  return normalizeConfig(parseConfig(cfgText));
}

async function renderChatSettings() {
  const config = await currentConfigObject();
  const reasoning = config.reasoningLevel || "medium";
  reasoningOptions.innerHTML = "";
  for (const [key, label, desc] of REASONING_LEVELS) {
    const row = pickerRow(label, desc, key === reasoning);
    row.onclick = async () => {
      await switchReasoningLevel(key);
      await renderChatSettings();
    };
    reasoningOptions.appendChild(row);
  }
  const threshold = typeof config.compactThreshold === "number" ? config.compactThreshold : 0.75;
  const options = Array.from(compactThresholdSelect.options).map((option) => Number(option.value));
  compactThresholdSelect.value = String(options.reduce((best, value) => (Math.abs(value - threshold) < Math.abs(best - threshold) ? value : best), options[0]));
}

compactThresholdSelect.onchange = async () => {
  const config = await currentConfigObject();
  config.compactThreshold = Number(compactThresholdSelect.value);
  await saveConfigText(JSON.stringify(config, null, 2), `压缩阈值已设为 ${Math.round(config.compactThreshold * 100)}%。`, { closeSettings: false });
  setCfgStatus(`压缩阈值已保存（${Math.round(config.compactThreshold * 100)}%）。`, true);
};

async function renderSafetySettings() {
  const config = await currentConfigObject();
  sandboxToggle.checked = config.sandbox === true;
  const info = await getAppInfoCached();
  if (info && info.platform !== "darwin") {
    sandboxToggle.disabled = true;
    sandboxHint.textContent = "当前平台不是 macOS，sandbox-exec 不可用；写入仍受工作区路径校验和逐项确认保护。";
  } else {
    sandboxToggle.disabled = false;
  }
}

sandboxToggle.onchange = async () => {
  const config = await currentConfigObject();
  config.sandbox = sandboxToggle.checked;
  await saveConfigText(JSON.stringify(config, null, 2), `bash 沙箱已${config.sandbox ? "开启" : "关闭"}。`, { closeSettings: false });
  setCfgStatus(`bash 沙箱已${config.sandbox ? "开启" : "关闭"}，立即生效。`, true);
};

async function renderMcpSettings() {
  const config = await currentConfigObject();
  mcpCfg.value = JSON.stringify(config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers) ? config.mcpServers : {}, null, 2);
  setTimeout(() => mcpCfg.focus(), 0);
}

let appInfoCache = null;
async function getAppInfoCached() {
  if (appInfoCache) return appInfoCache;
  const info = await api.getAppInfo();
  if (info && info.ok) appInfoCache = info;
  return appInfoCache;
}

async function renderAppInfoSettings() {
  const info = await getAppInfoCached();
  if (!info) return;
  dataDirPath.textContent = info.dataDir || "~/.hicode";
  configFilePath.textContent = info.configPath || "~/.hicode/config.json";
  aboutVersion.textContent = info.version ? `v${info.version}` : "";
  aboutVersion.title = info.version ? `当前版本 v${info.version}` : "当前版本";
  aboutRuntime.textContent = `Electron ${info.electron || "?"} · Chromium ${info.chrome || "?"} · Node ${info.node || "?"}`;
  aboutPlatform.textContent = `${info.platform || "?"} · ${info.arch || "?"}`;
}

openDataDirBtn.onclick = async () => {
  const r = await api.openDataDir();
  if (r.ok) setCfgStatus("已在文件管理器中打开数据目录。", true);
};
revealConfigBtn.onclick = async () => {
  const r = await api.revealConfigFile();
  if (r.ok) setCfgStatus("已定位配置文件。", true);
};
aboutRepoBtn.onclick = () => api.openAppPage("repo");
aboutReleasesBtn.onclick = () => api.openAppPage("releases");
aboutIssuesBtn.onclick = () => api.openAppPage("issues");

checkUpdatesBtn.onclick = async () => {
  checkUpdatesBtn.disabled = true;
  updateStatus.textContent = "正在检查更新…";
  const r = await api.checkUpdates();
  checkUpdatesBtn.disabled = false;
  if (!r.ok) {
    updateStatus.textContent = r.error || "检查更新失败。";
    return;
  }
  updateStatus.textContent = r.hasUpdate
    ? `发现新版本 v${r.latest}（当前 v${r.current}），请到下载页获取。`
    : `已是最新版本（v${r.current}）。`;
};

$("cfg-cancel").onclick = () => settings.classList.add("hidden");
$("quickModelForm").onsubmit = (e) => e.preventDefault();
advancedToggle.onclick = () => {
  if (settingsMode !== "model") return;
  advancedConfig.classList.toggle("hidden");
  if (!advancedConfig.classList.contains("hidden")) cfg.value = JSON.stringify(makeConfigFromQuick(parseConfig(cfg.value)), null, 2);
};
cfgSave.onclick = async () => saveConfigText(cfg.value, "JSON 已保存,模型已重载。");
mcpSave.onclick = async () => saveMcpConfigText();
quickSave.onclick = async () => {
  const problem = validateQuickProfile(quickProfile());
  if (problem) return setCfgStatus(problem);
  const next = makeConfigFromQuick(parseConfig(cfg.value || cfgText));
  await saveConfigText(JSON.stringify(next, null, 2), "模型 API 已保存,模型已重载。");
};
cfgTest.onclick = async () => {
  const profile = quickProfile();
  const problem = validateQuickProfile(profile);
  if (problem) return setCfgStatus(problem);
  setCfgStatus("正在测试连接...");
  const r = await api.testModel(profile);
  const capability = r?.capabilities?.vision;
  const capabilityText = capability?.status === "supported"
    ? "图片输入：看起来支持。"
    : capability?.status === "unsupported"
      ? "图片输入：当前模型可能不支持，请切换视觉模型。"
      : "图片输入：能力未知，失败时请切换视觉模型。";
  setCfgStatus(r.ok ? `连接成功,可以保存使用。${capabilityText}` : (r.error || "连接失败"), r.ok);
};

providerGrid.querySelectorAll(".provider").forEach((btn) => {
  btn.onclick = () => {
    const previousProvider = selectedProvider;
    selectedProvider = btn.dataset.provider;
    syncState({ selectedProvider });
    applyProvider(selectedProvider, true, previousProvider);
  };
});

function setCurrentModelDisplay(profile = {}) {
  const label = profile.model || "model";
  currentModel = {
    model: label,
    baseURL: profile.baseURL || "",
    capabilities: profile.capabilities || modelCapabilityHint(profile),
  };
  syncState({ currentModel });
  modelName.textContent = label;
  modelName.title = profile.baseURL || "";
  modelSide.textContent = label;
}

function modelCapabilityHint(profile = {}) {
  const model = String(profile.model || "").toLowerCase();
  const baseURL = String(profile.baseURL || "").toLowerCase();
  const haystack = `${model} ${baseURL}`;
  if (/\b(gpt-4o|gpt-4\.1|o4|gemini|qwen[-_/]vl|qvq|vl\b|vision|visual|multimodal|omni|glm-4v|grok.*vision|claude-3|claude.*sonnet|claude.*opus)\b/.test(haystack)) {
    return { vision: { status: "supported", supported: true, recommendation: "可以直接发送图片。" } };
  }
  if (/\b(deepseek-(chat|reasoner|coder)|kimi-k2|kimi.*coding|kimi-for-coding|coder|coding|embedding|rerank|text-embedding)\b/.test(haystack)) {
    return { vision: { status: "unsupported", supported: false, recommendation: "请切换视觉/多模态模型，或把图片内容改成文字描述。" } };
  }
  return { vision: { status: "unknown", supported: null, recommendation: "图片能力未知；如果识别失败，请切换支持视觉的模型。" } };
}

function visionCapabilityNotice(capabilities = currentModel.capabilities) {
  const vision = capabilities?.vision || {};
  if (vision.status === "supported") return "图片已添加，当前模型看起来支持视觉输入。";
  if (vision.status === "unsupported") {
    return `图片已添加，但当前模型 ${currentModel.model || ""} 可能不支持图片识别。${vision.recommendation || "请切换视觉/多模态模型。"}`.trim();
  }
  return "图片已添加。当前模型图片能力未知；如果识别失败，请切换支持视觉/多模态的模型。";
}

async function toggleModelPicker() {
  if (!modelPicker.classList.contains("hidden")) return hideModelPicker();
  await renderModelPicker();
  modelPicker.classList.remove("hidden");
}

function hideModelPicker() {
  modelPicker.classList.add("hidden");
}

async function renderModelPicker() {
  cfgText = (await api.getConfig()) || "";
  syncState({ cfgText });
  const config = normalizeConfig(parseConfig(cfgText));
  const profiles = config.profiles || {};
  const profileKeys = Object.keys(profiles);
  const reasoning = config.reasoningLevel || "medium";

  modelPicker.innerHTML = "";
  modelPicker.appendChild(modelPickerSection("推理", REASONING_LEVELS.map(([key, label, desc]) => {
    const item = pickerRow(label, desc, key === reasoning);
    item.onclick = () => switchReasoningLevel(key);
    return item;
  })));

  const modelRows = profileKeys
    .filter((key) => profiles[key]?.model)
    .map((key) => {
      const profile = profiles[key];
      const item = pickerRow(profile.model, modelSubtitle(key, profile), key === config.defaultProfile);
      item.onclick = () => switchModelProfile(key);
      return item;
    });

  if (modelRows.length) {
    modelPicker.appendChild(modelPickerSection("模型", modelRows));
  } else {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = "还没有接入模型。";
    modelPicker.appendChild(modelPickerSection("模型", [empty]));
  }

  const footer = document.createElement("div");
  footer.className = "picker-footer";
  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.textContent = "管理 API 和模型";
  settingsBtn.onclick = () => {
    hideModelPicker();
    openSettings("model");
  };
  footer.appendChild(settingsBtn);
  modelPicker.appendChild(footer);
}

function modelSubtitle(key, profile = {}) {
  const host = profile.baseURL ? profile.baseURL.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "custom";
  return `${key} · ${host}`;
}

async function switchReasoningLevel(level) {
  const config = normalizeConfig(parseConfig((await api.getConfig()) || cfgText));
  config.reasoningLevel = level;
  await saveConfigText(JSON.stringify(config, null, 2), `推理等级已切换为 ${reasoningLabel(level)}。`, { closeSettings: false });
  await renderModelPicker();
}

async function switchModelProfile(profileKey) {
  const config = normalizeConfig(parseConfig((await api.getConfig()) || cfgText));
  if (!config.profiles?.[profileKey]) return;
  config.defaultProfile = profileKey;
  config.roleModels = rewriteRoleModels(config.roleModels, profileKey);
  config.councilMembers = [profileKey];
  config.councilSynthesizer = profileKey;
  await saveConfigText(JSON.stringify(config, null, 2), `模型已切换为 ${config.profiles[profileKey].model}。`, { closeSettings: false });
  hideModelPicker();
}

function reasoningLabel(level) {
  return REASONING_LEVELS.find(([key]) => key === level)?.[1] || "中";
}

async function saveConfigText(text, okMessage, options = {}) {
  const r = await api.saveConfig(text);
  if (r.ok) {
    cfgText = text;
    syncState({ cfgText });
    setCurrentModelDisplay(defaultProfileFromConfig(parseConfig(text)));
    if (options.closeSettings !== false) settings.classList.add("hidden");
    if (inChat) addSystemNote(okMessage);
  } else {
    setCfgStatus(r.error || "保存失败");
  }
  return r;
}

async function saveMcpConfigText() {
  let servers;
  try {
    servers = mcpCfg.value.trim() ? JSON.parse(mcpCfg.value) : {};
  } catch (err) {
    return setCfgStatus(`MCP JSON 格式错误: ${err.message}`);
  }
  const problem = validateMcpServersConfig(servers);
  if (problem) return setCfgStatus(problem);
  const existing = parseConfig(cfgText || (await api.getConfig()) || "{}");
  const next = {
    ...existing,
    mcpServers: servers,
  };
  const text = JSON.stringify(next, null, 2);
  const result = await saveConfigText(text, "MCP 配置已保存。");
  if (result.ok) {
    capabilityCache = null;
    syncState({ capabilityCache });
  }
}

function validateMcpServersConfig(servers) {
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return "mcpServers 必须是 JSON 对象。";
  for (const [name, server] of Object.entries(servers)) {
    if (!/^[a-z0-9._:-]+$/i.test(name)) return `MCP server 名称不安全: ${name}`;
    if (!server || typeof server !== "object" || Array.isArray(server)) return `${name} 必须是对象。`;
    if (typeof server.command !== "string" || !server.command.trim()) return `${name}.command 必须是非空字符串。`;
    if (server.args && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== "string"))) return `${name}.args 必须是字符串数组。`;
    if (server.env && (typeof server.env !== "object" || Array.isArray(server.env))) return `${name}.env 必须是对象。`;
  }
  return "";
}

function parseConfig(text) {
  return parseJsonObject(text);
}

function normalizeConfig(config = {}) {
  const profiles = config.profiles && typeof config.profiles === "object" ? { ...config.profiles } : {};
  if (!Object.keys(profiles).length && (config.baseURL || config.apiKey || config.model)) {
    profiles.default = {
      name: "default",
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: config.model,
      contextWindow: config.contextWindow,
      temperature: config.temperature,
    };
  }
  const defaultProfile = config.defaultProfile || Object.keys(profiles)[0] || "default";
  return {
    ...config,
    profiles,
    defaultProfile,
    roleModels: config.roleModels && typeof config.roleModels === "object" ? config.roleModels : {},
    councilMembers: Array.isArray(config.councilMembers) ? config.councilMembers : [],
    councilSynthesizer: config.councilSynthesizer || defaultProfile,
    reasoningLevel: config.reasoningLevel || "medium",
  };
}

function hydrateQuickForm(text) {
  const current = defaultProfileFromConfig(parseConfig(text));
  selectedProvider = guessProvider(current.baseURL);
  syncState({ selectedProvider });
  setProviderActive(selectedProvider);
  quickBaseURL.value = current.baseURL || PROVIDERS[selectedProvider].baseURL;
  quickApiKey.value = current.apiKey || PROVIDERS[selectedProvider].apiKey;
  quickModel.value = current.model || PROVIDERS[selectedProvider].model;
  quickContext.value = String(current.contextWindow || PROVIDERS[selectedProvider].contextWindow);
  syncProviderFormMode();
}

function defaultProfileFromConfig(config) {
  if (config.profiles && typeof config.profiles === "object") {
    const key = config.defaultProfile || "default";
    return { ...(config.profiles[key] || config.profiles.default || {}) };
  }
  return {
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model: config.model,
    contextWindow: config.contextWindow,
    temperature: config.temperature,
  };
}

function quickProfile() {
  const preset = PROVIDERS[selectedProvider] || PROVIDERS.custom;
  const baseURL = quickBaseURL.value.trim() || preset.baseURL;
  const apiKey = quickApiKey.value.trim() || (isLocalEndpoint(baseURL) ? "sk-no-key-required" : preset.apiKey);
  return {
    name: "default",
    baseURL,
    apiKey,
    model: quickModel.value.trim() || preset.model,
    contextWindow: Number(quickContext.value) || preset.contextWindow,
    temperature: typeof preset.temperature === "number" ? preset.temperature : 0.2,
  };
}

function validateQuickProfile(profile) {
  const preset = PROVIDERS[selectedProvider] || PROVIDERS.custom;
  return validateQuickProfileFields(profile, {
    providerLabel: preset.label,
    apiOnly: providerIsApiOnly(selectedProvider),
    localEndpoint: isLocalEndpoint(profile.baseURL),
  });
}

function makeConfigFromQuick(existing) {
  const profile = quickProfile();
  const defaultKey = providerProfileKey(selectedProvider);
  const profiles = existing.profiles && typeof existing.profiles === "object"
    ? { ...existing.profiles }
    : {};
  profiles[defaultKey] = { ...(profiles[defaultKey] || {}), ...profile, name: defaultKey };
  return {
    ...existing,
    defaultProfile: defaultKey,
    profiles,
    roleModels: rewriteRoleModels(existing.roleModels, defaultKey),
    councilMembers: [defaultKey],
    councilSynthesizer: defaultKey,
    compactThreshold: typeof existing.compactThreshold === "number" ? existing.compactThreshold : 0.75,
    reasoningLevel: existing.reasoningLevel || "medium",
    sandbox: existing.sandbox === true,
    mcpServers: existing.mcpServers || {},
  };
}

function providerProfileKey(providerKey) {
  return (providerKey || "default").replace(/[^a-z0-9._-]+/gi, "-") || "default";
}

function rewriteRoleModels(roleModels, profileKey) {
  const roles = ["architect", "coder", "reviewer", "tester", "explorer"];
  const next = roleModels && typeof roleModels === "object" ? { ...roleModels } : {};
  for (const role of roles) next[role] = profileKey;
  return next;
}

function applyProvider(key, overwrite, previousKey = selectedProvider) {
  const preset = PROVIDERS[key] || PROVIDERS.custom;
  selectedProvider = key;
  syncState({ selectedProvider });
  const saved = overwrite ? savedProfileForProvider(key) : null;
  const savedApiKey = saved?.apiKey || savedApiKeyForProvider(key);
  setProviderActive(key);
  if (overwrite || !quickBaseURL.value) quickBaseURL.value = saved?.baseURL || preset.baseURL;
  if (overwrite || !quickModel.value) quickModel.value = saved?.model || preset.model;
  if (overwrite || !quickContext.value) quickContext.value = String(saved?.contextWindow || preset.contextWindow);
  const keepApiKey = overwrite
    && quickApiKey.value
    && providerCredentialGroup(previousKey) === providerCredentialGroup(key)
    && !preset.apiKey
    && !savedApiKey;
  if (overwrite && !keepApiKey) quickApiKey.value = savedApiKey || preset.apiKey || "";
  else if (!quickApiKey.value && preset.apiKey) quickApiKey.value = preset.apiKey;
  syncProviderFormMode();
  setCfgStatus("");
}

function savedProfileForProvider(key) {
  const config = normalizeConfig(parseConfig(cfg.value || cfgText));
  const profiles = config.profiles || {};
  const directKey = providerProfileKey(key);
  if (profiles[directKey]) return profiles[directKey];
  return Object.values(profiles).find((profile) => guessProvider(profile?.baseURL || "") === key);
}

function savedApiKeyForProvider(key) {
  const preset = PROVIDERS[key] || PROVIDERS.custom;
  if (!preset.credentialGroup) return "";
  const config = normalizeConfig(parseConfig(cfg.value || cfgText));
  const profiles = Object.values(config.profiles || {});
  return profiles.find((profile) => providerCredentialGroup(guessProvider(profile?.baseURL || "")) === preset.credentialGroup)?.apiKey || "";
}

function setCfgStatus(text, ok = false) {
  cfgErr.textContent = text;
  cfgErr.classList.toggle("ok", ok);
}

function setProviderActive(key) {
  providerGrid.querySelectorAll(".provider").forEach((btn) => btn.classList.toggle("active", btn.dataset.provider === key));
}

function guessProvider(baseURL = "") {
  if (baseURL.includes("deepseek.com")) return "deepseek";
  if (baseURL.includes("api.kimi.com")) return "kimi-code";
  if (baseURL.includes("moonshot.cn")) return "kimi-cn";
  if (baseURL.includes("moonshot.ai")) return "kimi";
  if (baseURL.includes("dashscope.aliyuncs.com")) return "qwen";
  if (baseURL.includes("bigmodel.cn")) return "zhipu";
  if (baseURL.includes("minimax.io")) return "minimax";
  if (baseURL.includes("siliconflow.cn")) return "siliconflow";
  if (baseURL.includes("generativelanguage.googleapis.com")) return "gemini";
  if (baseURL.includes("openrouter.ai")) return "openrouter";
  if (baseURL.includes("api.openai.com")) return "openai";
  if (baseURL.includes("127.0.0.1") || baseURL.includes("localhost")) return "ollama";
  return "custom";
}

function providerIsApiOnly(key) {
  const preset = PROVIDERS[key] || PROVIDERS.custom;
  return preset.apiOnly === true;
}

function providerCredentialGroup(key) {
  const preset = PROVIDERS[key] || PROVIDERS.custom;
  return preset.credentialGroup || key || "custom";
}

function syncProviderFormMode() {
  const preset = PROVIDERS[selectedProvider] || PROVIDERS.custom;
  const card = settings.querySelector(".settings-card");
  const apiOnly = providerIsApiOnly(selectedProvider);
  card.classList.toggle("api-key-only", apiOnly);
  quickApiKey.placeholder = preset.keyPlaceholder || "sk-...";
  providerHint.textContent = apiOnly
    ? `${preset.label} 已内置 Base URL、默认模型和上下文窗口，只需要粘贴 API Key。${preset.note ? " " + preset.note : ""}`
    : preset.note || "";
  providerHint.title = `${preset.baseURL || "custom"} · ${preset.model || "custom model"}`;
}

function isLocalEndpoint(baseURL = "") {
  return /^(http:\/\/)?(127\.0\.0\.1|localhost|\[::1\])/.test(baseURL);
}

/* ---------- slash menu ---------- */
let menuIdx = 0;
const menuVisible = () => !cmdmenu.classList.contains("hidden");
const curSlash = () => input.value.toLowerCase().match(/^\/[a-z]*/)?.[0] ?? "/";
function showMenu(filter) {
  const items = COMMANDS.filter(([n]) => n.startsWith(filter));
  if (!items.length) return hideMenu();
  menuIdx = Math.min(menuIdx, items.length - 1);
  cmdmenu.innerHTML = items.map(([n, d], i) => `<div class="item ${i === menuIdx ? "active" : ""}" data-name="${n}"><span class="name">${n}</span><span class="desc">${d}</span></div>`).join("");
  cmdmenu.querySelectorAll(".item").forEach((el) => { el.onclick = () => { input.value = el.dataset.name + " "; hideMenu(); input.focus(); }; });
  cmdmenu.classList.remove("hidden");
}
function hideMenu() { cmdmenu.classList.add("hidden"); menuIdx = 0; }

/* ---------- input ---------- */
input.addEventListener("compositionstart", () => {
  composerComposing = true;
});
input.addEventListener("compositionend", () => {
  composerComposing = false;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  if (/^\/[a-z]*$/i.test(input.value)) showMenu(input.value.toLowerCase()); else hideMenu();
});
input.addEventListener("keydown", (e) => {
  if (composerComposing || e.isComposing) return;
  if (menuVisible()) {
    const items = cmdmenu.querySelectorAll(".item");
    if (e.key === "ArrowDown") { e.preventDefault(); menuIdx = (menuIdx + 1) % items.length; showMenu(curSlash()); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); menuIdx = (menuIdx - 1 + items.length) % items.length; showMenu(curSlash()); return; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const a = cmdmenu.querySelector(".item.active"); if (a) { input.value = a.dataset.name + " "; hideMenu(); } return; }
    if (e.key === "Escape") { hideMenu(); return; }
  }
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
});
input.addEventListener("input", (e) => {
  input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 200) + "px";
  if (composerComposing || e.isComposing) return;
  if (/^\/[a-z]*$/i.test(input.value)) showMenu(input.value.toLowerCase()); else hideMenu();
});
input.addEventListener("paste", async (e) => {
  const items = Array.from(e.clipboardData?.items || []);
  const imageItem = items.find((item) => String(item.type || "").startsWith("image/"));
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  e.preventDefault();
  await attachImageFile(file);
});
composer.addEventListener("dragover", (e) => {
  const hasImage = Array.from(e.dataTransfer?.items || []).some((item) => String(item.type || "").startsWith("image/"));
  if (!hasImage) return;
  e.preventDefault();
  composer.classList.add("is-busy");
});
composer.addEventListener("dragleave", () => {
  composer.classList.toggle("is-busy", busy);
});
composer.addEventListener("drop", async (e) => {
  const files = Array.from(e.dataTransfer?.files || []).filter((file) => String(file.type || "").startsWith("image/"));
  if (!files.length) return;
  e.preventDefault();
  composer.classList.toggle("is-busy", busy);
  for (const file of files.slice(0, 4)) await attachImageFile(file);
});

setGreeting();
initAuth();
input.focus();
}
