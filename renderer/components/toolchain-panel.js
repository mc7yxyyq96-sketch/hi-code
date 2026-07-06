import { escapeHtml, shortPath } from "../utils/format.js";

export function mountToolchainPanel({ elements, api, toast }) {
  const state = {
    adapters: [],
    requirements: [],
    selectedId: "",
    selected: null,
    lastRun: null,
  };

  const refresh = async () => {
    elements.status.textContent = "正在检测工具链...";
    const result = await api.listToolchainAdapters();
    if (!result?.ok) {
      elements.status.textContent = result?.error || "工具链读取失败";
      return;
    }
    state.adapters = Array.isArray(result.adapters) ? result.adapters : [];
    state.requirements = Array.isArray(result.toolRequirements) ? result.toolRequirements : [];
    if (!state.adapters.some((item) => item.adapter?.id === state.selectedId)) {
      state.selectedId = state.adapters[0]?.adapter?.id || "";
    }
    state.selected = state.adapters.find((item) => item.adapter?.id === state.selectedId) || null;
    elements.status.textContent = `适配器 ${state.adapters.length} 个 · 工具要求 ${state.requirements.length} 个`;
    render(state, elements, api, toast, refresh);
  };

  elements.refresh.onclick = refresh;
  elements.list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-tool-adapter]");
    if (!row) return;
    state.selectedId = row.dataset.toolAdapter;
    state.selected = state.adapters.find((item) => item.adapter?.id === state.selectedId) || null;
    render(state, elements, api, toast, refresh);
  });
  elements.detail.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-tool-action]")?.dataset.toolAction;
    if (!action || !state.selected?.adapter?.id) return;
    const executablePath = elements.detail.querySelector("[data-tool-field='executablePath']")?.value?.trim() || "";
    const pcbRequest = readKiCadPcbRequest(elements.detail);
    const plcRequest = readPlcRequest(elements.detail);
    const bimRequest = readBimIfcRequest(elements.detail);
    const solidworksRequest = readSolidWorksRequest(elements.detail);
    const avevaRequest = readAvevaRequest(elements.detail);
    if (action === "detect") {
      const result = await api.detectToolchainAdapter(state.selected.adapter.id, executablePath ? { executablePath } : {});
      if (!result?.ok) return;
      state.selected.detection = result.detection;
      render(state, elements, api, toast, refresh);
    }
    if (action === "dry-run") {
      const task = elements.task.value.trim() || `为 ${state.selected.adapter.name} 生成 dry-run 计划`;
      const result = await api.runToolchainAdapter({
        adapterId: state.selected.adapter.id,
        task,
        mode: "dry-run",
        actor: "user",
        executablePath,
        cadRequest: state.selected.adapter.id === "freecad" ? defaultFreeCadControlBoxRequest() : undefined,
        pcbRequest: state.selected.adapter.id === "kicad" ? pcbRequest : undefined,
        plcRequest: state.selected.adapter.id === "openplc" ? plcRequest : undefined,
        bimRequest: state.selected.adapter.id === "ifcopenshell" ? bimRequest : undefined,
        solidworksRequest: state.selected.adapter.id === "solidworks" ? solidworksRequest : undefined,
        avevaRequest: state.selected.adapter.id === "aveva" ? avevaRequest : undefined,
      });
      if (!result?.ok) return;
      state.lastRun = result;
      toast?.show?.("dry-run 交付物已生成。");
      render(state, elements, api, toast, refresh);
    }
    if (action === "freecad-demo") {
      const result = await api.runToolchainAdapter({
        adapterId: "freecad",
        task: "Generate a parameterized FreeCAD control box enclosure demo",
        mode: "execute",
        actor: "user",
        userApproved: true,
        executablePath,
        cadRequest: defaultFreeCadControlBoxRequest(),
      });
      if (!result?.ok) return;
      state.lastRun = result;
      toast?.show?.("FreeCAD 控制盒任务已完成。");
      render(state, elements, api, toast, refresh);
    }
    if (action === "kicad-flow") {
      const result = await api.runToolchainAdapter({
        adapterId: "kicad",
        task: "Run KiCad ERC/DRC/Gerber/Drill flow",
        mode: "execute",
        actor: "user",
        userApproved: true,
        executablePath,
        pcbRequest,
      });
      if (!result?.ok) return;
      state.lastRun = result;
      toast?.show?.("KiCad 流程已完成。");
      render(state, elements, api, toast, refresh);
    }
    if (action === "plc-generate" || action === "plc-syntax-check") {
      const result = await api.runToolchainAdapter({
        adapterId: "openplc",
        task: action === "plc-syntax-check" ? "Run IEC 61131-3 syntax check for PLC draft" : "Generate PLC Structured Text draft and I/O map",
        mode: action === "plc-syntax-check" ? "execute" : "dry-run",
        actor: "user",
        userApproved: action === "plc-syntax-check",
        executablePath,
        plcRequest,
      });
      if (!result?.ok) return;
      state.lastRun = result;
      toast?.show?.(action === "plc-syntax-check" ? "PLC 语法检查已完成。" : "PLC 草案交付物已生成。");
      render(state, elements, api, toast, refresh);
    }
    if (action === "bim-inspect") {
      const result = await api.runToolchainAdapter({
        adapterId: "ifcopenshell",
        task: "Run BIM IFC inspection",
        mode: "execute",
        actor: "user",
        userApproved: true,
        executablePath,
        bimRequest,
      });
      if (!result?.ok) return;
      state.lastRun = result;
      toast?.show?.("BIM IFC 检查已完成。");
      render(state, elements, api, toast, refresh);
    }
    if (action === "solidworks-bridge") {
      const result = await api.runToolchainAdapter({
        adapterId: "solidworks",
        task: "Generate SolidWorks COM/API bridge package",
        mode: "dry-run",
        actor: "user",
        executablePath,
        solidworksRequest,
      });
      if (!result?.ok) return;
      state.lastRun = result;
      toast?.show?.("SolidWorks 桥接包已生成。");
      render(state, elements, api, toast, refresh);
    }
    if (action === "aveva-plan") {
      const result = await api.runToolchainAdapter({
        adapterId: "aveva",
        task: "Generate AVEVA enterprise data exchange plan",
        mode: "dry-run",
        actor: "user",
        executablePath,
        avevaRequest,
      });
      if (!result?.ok) return;
      state.lastRun = result;
      toast?.show?.("AVEVA 集成计划已生成。");
      render(state, elements, api, toast, refresh);
    }
  });
  render(state, elements, api, toast, refresh);
  return { open: refresh, refresh, stop: () => {} };
}

export function summarizeToolchainAdapters(items = []) {
  return items.reduce((summary, item) => {
    summary.total += 1;
    if (item.detection?.installed) summary.installed += 1;
    else summary.missing += 1;
    summary.capabilities += item.adapter?.capabilities?.length || 0;
    return summary;
  }, { total: 0, installed: 0, missing: 0, capabilities: 0 });
}

export function renderToolchainListMarkup(items = [], selectedId = "") {
  if (!items.length) return `<div class="toolchain-empty">暂无工具适配器。</div>`;
  return items.map((item) => {
    const adapter = item.adapter || {};
    const detection = item.detection || {};
    return `<button class="toolchain-row ${adapter.id === selectedId ? "active" : ""}" data-tool-adapter="${escapeAttr(adapter.id)}">
      <span>
        <strong>${escapeHtml(adapter.name || adapter.id)}</strong>
        <small>${escapeHtml((adapter.domains || []).join(", "))}</small>
      </span>
      <em>${escapeHtml(detection.installed ? "已安装" : "未安装")}</em>
    </button>`;
  }).join("");
}

export function renderToolchainDetailMarkup(item, requirements = [], lastRun = null) {
  if (!item) return `<div class="toolchain-empty">选择一个工具适配器查看检测结果和 dry-run 能力。未检测到真实工具时只会生成计划和预期产物，不会假装真实执行。</div>`;
  const adapter = item.adapter || {};
  const detection = item.detection || {};
  return `
    <div class="toolchain-detail-head">
      <div>
        <div class="industrial-title">${escapeHtml(adapter.name || adapter.id)}</div>
        <div class="industrial-sub">${escapeHtml(adapter.vendor || "-")} · ${escapeHtml(adapter.kind || "-")}</div>
      </div>
      <span>${escapeHtml(detection.installed ? "已安装" : "未安装")}</span>
    </div>
    <div class="toolchain-actions">
      <button data-tool-action="detect">检测</button>
      <button data-tool-action="dry-run">运行 dry-run</button>
      ${adapter.id === "freecad" ? `<button data-tool-action="freecad-demo">生成控制盒 demo</button>` : ""}
      ${adapter.id === "kicad" ? `<button data-tool-action="kicad-flow">运行 ERC/DRC/Gerber</button>` : ""}
      ${adapter.id === "openplc" ? `<button data-tool-action="plc-generate">生成 PLC 草案</button><button data-tool-action="plc-syntax-check">运行 IEC 语法检查</button>` : ""}
      ${adapter.id === "ifcopenshell" ? `<button data-tool-action="bim-inspect">运行 IFC 检查</button>` : ""}
      ${adapter.id === "solidworks" ? `<button data-tool-action="solidworks-bridge">生成桥接包</button>` : ""}
      ${adapter.id === "aveva" ? `<button data-tool-action="aveva-plan">生成集成计划</button>` : ""}
    </div>
    <div class="toolchain-config">
      <label>
        <span>${adapter.id === "freecad" ? "FreeCADCmd 路径" : adapter.id === "kicad" ? "kicad-cli 路径" : adapter.id === "openplc" ? "iec2c/openplc 路径" : adapter.id === "ifcopenshell" ? "Python/IfcOpenShell 路径" : adapter.id === "solidworks" ? "SLDWORKS.exe 路径" : adapter.id === "aveva" ? "AVEVA 连接器路径" : "可执行文件路径"}</span>
        <input data-tool-field="executablePath" spellcheck="false" placeholder="${adapter.id === "freecad" ? "/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd" : adapter.id === "kicad" ? "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli" : adapter.id === "openplc" ? "/usr/local/bin/iec2c" : adapter.id === "ifcopenshell" ? "/usr/local/bin/python3" : adapter.id === "solidworks" ? "C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe" : adapter.id === "aveva" ? "Optional approved enterprise connector path" : "Optional manual executable path"}" />
      </label>
      ${adapter.id === "freecad" ? `<small>Demo: 120 x 80 x 36 mm ABS 控制盒，3 mm 壁厚和安装孔；FreeCAD 支持时导出 FCStd/STEP/STL。</small>` : ""}
      ${adapter.id === "kicad" ? renderKiCadConfig() : ""}
      ${adapter.id === "openplc" ? renderPlcConfig() : ""}
      ${adapter.id === "ifcopenshell" ? renderBimIfcConfig() : ""}
      ${adapter.id === "solidworks" ? renderSolidWorksConfig(detection) : ""}
      ${adapter.id === "aveva" ? renderAvevaConfig(detection) : ""}
    </div>
    <div class="toolchain-detection">
      <strong>${escapeHtml(detection.reason || "尚未运行检测。")}</strong>
      <span>${escapeHtml(detection.version?.version || detection.version?.output || detection.setupHint || "")}</span>
      <span>${escapeHtml(detection.executablePath ? shortPath(detection.executablePath) : detection.setupHint || "")}</span>
    </div>
    <div class="toolchain-grid">
      <section class="industrial-panel">
        <div class="industrial-panel-title">能力</div>
        <div class="industrial-list">${renderCapabilities(adapter.capabilities || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">诊断</div>
        <div class="industrial-list">${renderDiagnostics(detection.diagnostics || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">Domain Pack / 项目工具要求</div>
        <div class="industrial-list">${renderRequirements(requirements)}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">输出交付物</div>
        <div class="industrial-list">${renderArtifacts(lastRun?.result?.artifacts || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">运行诊断</div>
        <div class="industrial-list">${renderDiagnostics(lastRun?.result?.diagnostics || [])}</div>
      </section>
    </div>
  `;
}

function render(state, elements) {
  const summary = summarizeToolchainAdapters(state.adapters);
  elements.summary.innerHTML = [
    ["适配器", summary.total],
    ["已安装", summary.installed],
    ["缺失", summary.missing],
    ["能力", summary.capabilities],
    ["工具要求", state.requirements.length],
  ].map(([label, value]) => `<div class="job-stat"><b>${value}</b><span>${label}</span></div>`).join("");
  elements.list.innerHTML = renderToolchainListMarkup(state.adapters, state.selectedId);
  elements.detail.innerHTML = renderToolchainDetailMarkup(state.selected, state.requirements, state.lastRun);
}

function renderCapabilities(items) {
  if (!items.length) return `<div class="industrial-muted">暂无能力声明。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml([item.artifactTypes?.join(", "), item.qualityGates?.join(", ")].filter(Boolean).join(" · "))}</span></div>`).join("");
}

function renderDiagnostics(items) {
  if (!items.length) return `<div class="industrial-muted">暂无诊断。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.severity || "info")}</strong><span>${escapeHtml(item.message)}</span></div>`).join("");
}

function renderRequirements(items) {
  if (!items.length) return `<div class="industrial-muted">暂无声明的工具要求。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml([item.source, item.packId, (item.domains || []).join(", ")].filter(Boolean).join(" · "))}</span></div>`).join("");
}

function renderArtifacts(items) {
  if (!items.length) return `<div class="industrial-muted">暂无 dry-run 交付物。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(`${item.simulated ? "模拟" : "真实"} · ${shortPath(item.path)}`)}</span></div>`).join("");
}

function defaultFreeCadControlBoxRequest() {
  return {
    partType: "control_box_enclosure",
    dimensions: {
      length: 120,
      width: 80,
      height: 36,
      wallThickness: 3,
      lidThickness: 3,
      mountHoleDiameter: 4,
      mountHoleOffset: 12,
    },
    material: "ABS",
    units: "mm",
    constraints: [
      "开口控制盒外壳",
      "四个底部安装孔",
      "独立盖板设计计划",
    ],
    exportFormats: ["FCStd", "STEP", "STL"],
    outputDir: ".hicode/artifacts/freecad/control-box-demo",
  };
}

function renderKiCadConfig() {
  return `
    <label>
      <span>KiCad 项目</span>
      <input data-tool-field="kicadProjectPath" spellcheck="false" placeholder="hardware/controller/controller.kicad_pro 或项目目录" />
    </label>
    <label>
      <span>原理图</span>
      <input data-tool-field="kicadSchematicPath" spellcheck="false" placeholder="hardware/controller/controller.kicad_sch" />
    </label>
    <label>
      <span>PCB 板文件</span>
      <input data-tool-field="kicadBoardPath" spellcheck="false" placeholder="hardware/controller/controller.kicad_pcb" />
    </label>
    <small>流程：项目识别、可选 ERC/DRC、Gerber 导出、钻孔文件导出和 BOM 导出计划。输出会限制在 .hicode/artifacts/kicad。</small>
  `;
}

function readKiCadPcbRequest(root) {
  const value = (field) => root.querySelector(`[data-tool-field='${field}']`)?.value?.trim() || "";
  return {
    projectPath: value("kicadProjectPath") || ".",
    schematicPath: value("kicadSchematicPath") || undefined,
    boardPath: value("kicadBoardPath") || undefined,
    outputDir: ".hicode/artifacts/kicad/toolchain-flow",
    exportGerber: true,
    exportDrill: true,
    runErc: true,
    runDrc: true,
    bomFormat: "csv",
  };
}

function renderPlcConfig() {
  return `
    <label>
      <span>控制器</span>
      <input data-tool-field="plcControllerType" spellcheck="false" value="openplc-compatible-soft-plc" />
    </label>
    <label>
      <span>目标运行时</span>
      <input data-tool-field="plcTargetRuntime" spellcheck="false" value="openplc" />
    </label>
    <label>
      <span>扫描周期</span>
      <input data-tool-field="plcScanCycle" spellcheck="false" value="100ms nominal scan cycle; validate on target hardware" />
    </label>
    <label>
      <span>控制意图</span>
      <textarea data-tool-field="plcControlLogic" spellcheck="false">仅生成失效安全的 Structured Text 草案；所有输出在控制工程师审批最终逻辑前保持非激活。</textarea>
    </label>
    <label>
      <span>安全联锁</span>
      <textarea data-tool-field="plcSafetyInterlocks" spellcheck="false">急停健康输入必须为真，任何输出才允许进入调试考虑。
现场测试前必须完成人工安全评审和上锁挂牌流程。</textarea>
    </label>
    <label>
      <span>I/O 点位 CSV</span>
      <textarea data-tool-field="plcIoPoints" spellcheck="false">E_STOP_NC,%IX0.0,input,bool,常闭急停健康信号
RESET_PB,%IX0.1,input,bool,操作员复位按钮
RUN_PERMIT,%QX0.0,output,bool,运行许可输出在草案中保持 false</textarea>
    </label>
    <small>输出：plc-program.st、io-map.csv、安全联锁说明、FAT/SAT checklist、metadata 和编译计划。不会下载到任何设备。</small>
  `;
}

function readPlcRequest(root) {
  const value = (field) => root.querySelector(`[data-tool-field='${field}']`)?.value?.trim() || "";
  const ioText = value("plcIoPoints");
  return {
    controllerType: value("plcControllerType") || "openplc-compatible-soft-plc",
    targetRuntime: value("plcTargetRuntime") || "openplc",
    scanCycleRequirement: value("plcScanCycle") || "100ms nominal scan cycle; validate on target hardware",
    controlLogicDescription: value("plcControlLogic") || "生成失效安全 PLC 草案。",
    safetyInterlocks: value("plcSafetyInterlocks").split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    ioPoints: parsePlcIoPoints(ioText),
    outputDir: ".hicode/artifacts/plc/openplc-toolchain-draft",
  };
}

function parsePlcIoPoints(text) {
  return (text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [tag = "", address = "", direction = "", signalType = "bool", ...description] = line.split(",").map((part) => part.trim());
    return { tag, address, direction, signalType, description: description.join(", ") };
  });
}

function renderBimIfcConfig() {
  return `
    <label>
      <span>IFC 文件</span>
      <input data-tool-field="bimIfcPath" spellcheck="false" placeholder="models/building.ifc" />
    </label>
    <label>
      <span>目标标准</span>
      <input data-tool-field="bimTargetStandard" spellcheck="false" placeholder="ISO 19650 delivery checklist 或项目 BIM 标准" />
    </label>
    <label class="toolchain-inline">
      <input type="checkbox" data-tool-field="bimCheckProperties" checked />
      <span>提取基础属性</span>
    </label>
    <label class="toolchain-inline">
      <input type="checkbox" data-tool-field="bimDeliveryChecklist" checked />
      <span>生成交付 checklist</span>
    </label>
    <small>输出限制在 .hicode/artifacts/bim。不会自动给出法规符合结论；当地建筑规范审查始终是人工门禁。</small>
  `;
}

function readBimIfcRequest(root) {
  const value = (field) => root.querySelector(`[data-tool-field='${field}']`)?.value?.trim() || "";
  const checked = (field) => root.querySelector(`[data-tool-field='${field}']`)?.checked !== false;
  return {
    ifcPath: value("bimIfcPath") || undefined,
    outputDir: ".hicode/artifacts/bim/ifc-toolchain-inspection",
    checkProperties: checked("bimCheckProperties"),
    generateDeliveryChecklist: checked("bimDeliveryChecklist"),
    targetStandard: value("bimTargetStandard") || undefined,
  };
}

function renderSolidWorksConfig(detection = {}) {
  const platformText = detection.diagnostics?.some?.((item) => item.code === "solidworks.unsupported_platform") ? "unsupported_platform" : "Windows COM/API bridge";
  return `
    <label>
      <span>零件名称</span>
      <input data-tool-field="solidworksPartName" spellcheck="false" value="hicode-bridge-control-box" />
    </label>
    <div class="toolchain-inline">
      <label>
        <span>长度 mm</span>
        <input data-tool-field="solidworksLength" type="number" min="10" value="120" />
      </label>
      <label>
        <span>宽度 mm</span>
        <input data-tool-field="solidworksWidth" type="number" min="10" value="80" />
      </label>
      <label>
        <span>高度 mm</span>
        <input data-tool-field="solidworksHeight" type="number" min="5" value="36" />
      </label>
      <label>
        <span>壁厚 mm</span>
        <input data-tool-field="solidworksWall" type="number" min="0.1" value="3" />
      </label>
    </div>
    <label>
      <span>材料</span>
      <input data-tool-field="solidworksMaterial" spellcheck="false" value="ABS" />
    </label>
    <label>
      <span>预期输出</span>
      <input data-tool-field="solidworksOutputs" spellcheck="false" value="SLDPRT,STEP,BOM" />
    </label>
    <small>平台：${escapeHtml(platformText)}。这里只生成 macro-template.bas 和桥接文档；原生 .sldprt/.sldasm/.slddrw 仍标记 external_required，需要 Windows 授权 SolidWorks 和人工授权。</small>
  `;
}

function readSolidWorksRequest(root) {
  const value = (field) => root.querySelector(`[data-tool-field='${field}']`)?.value?.trim() || "";
  const number = (field, fallback) => {
    const parsed = Number(value(field));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    bridgeType: "part",
    partName: value("solidworksPartName") || "hicode-bridge-control-box",
    dimensions: {
      length: number("solidworksLength", 120),
      width: number("solidworksWidth", 80),
      height: number("solidworksHeight", 36),
      wallThickness: number("solidworksWall", 3),
    },
    material: value("solidworksMaterial") || "ABS",
    units: "mm",
    expectedOutputs: value("solidworksOutputs").split(",").map((item) => item.trim()).filter(Boolean),
    outputDir: ".hicode/artifacts/solidworks/bridge-package",
    bridgeScriptType: "vba",
  };
}

function renderAvevaConfig(detection = {}) {
  const status = detection.installed ? "profile evidence only" : "not configured";
  return `
    <label>
      <span>配置名称</span>
      <input data-tool-field="avevaProfileName" spellcheck="false" value="plant-data-dry-run" />
    </label>
    <label>
      <span>系统类型</span>
      <select data-tool-field="avevaSystemType">
        <option value="aveva-engineering">AVEVA Engineering</option>
        <option value="aveva-e3d">AVEVA E3D</option>
        <option value="aveva-net">AVEVA NET</option>
        <option value="aveva-pi">AVEVA PI</option>
        <option value="aveva-enterprise-data-platform">Enterprise Data Platform</option>
        <option value="manual-external">Manual external</option>
      </select>
    </label>
    <label>
      <span>Endpoint</span>
      <input data-tool-field="avevaEndpoint" spellcheck="false" placeholder="https://enterprise-approved-connector.example" />
    </label>
    <label>
      <span>认证方式</span>
      <select data-tool-field="avevaAuthMode">
        <option value="sso">SSO</option>
        <option value="system_keychain">System keychain</option>
        <option value="service_account_reference">Service account reference</option>
        <option value="manual_external">Manual external</option>
      </select>
    </label>
    <label>
      <span>项目 ID</span>
      <input data-tool-field="avevaProjectId" spellcheck="false" placeholder="PROJECT-ID" />
    </label>
    <label>
      <span>允许操作</span>
      <textarea data-tool-field="avevaAllowedOperations" spellcheck="false">engineering_data_exchange_plan
tag_list_import_export_plan
equipment_list_import_export_plan
piping_line_list_plan
document_register_plan
change_sync_plan</textarea>
    </label>
    <label>
      <span>工作区映射</span>
      <textarea data-tool-field="avevaWorkspaceMapping" spellcheck="false">exportRoot=.hicode/artifacts/aveva
importRoot=.hicode/artifacts/aveva/inbound</textarea>
    </label>
    <small>状态：${escapeHtml(status === "profile evidence only" ? "仅配置证据" : "未配置")}。不要输入密码或 token。AVEVA dry-run 只生成 schema、CSV 模板、metadata 和人工审批 checklist；真实企业连接器执行仍标记 external_required。</small>
  `;
}

function readAvevaRequest(root) {
  const value = (field) => root.querySelector(`[data-tool-field='${field}']`)?.value?.trim() || "";
  const operations = value("avevaAllowedOperations").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  const mapping = {};
  for (const line of value("avevaWorkspaceMapping").split(/\r?\n/)) {
    const [key, ...rest] = line.split("=");
    if (key?.trim() && rest.join("=").trim()) mapping[key.trim()] = rest.join("=").trim();
  }
  return {
    connectionProfile: {
      profileName: value("avevaProfileName") || "plant-data-dry-run",
      systemType: value("avevaSystemType") || "aveva-engineering",
      endpoint: value("avevaEndpoint") || undefined,
      authMode: value("avevaAuthMode") || "manual_external",
      projectId: value("avevaProjectId") || undefined,
      workspaceMapping: mapping,
      allowedOperations: operations,
    },
    projectReference: { projectId: value("avevaProjectId") || undefined },
    requestedOperations: operations,
    outputDir: ".hicode/artifacts/aveva/integration-plan",
    sourceFormat: "csv",
    targetFormat: "csv",
    includeTemplates: true,
  };
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
