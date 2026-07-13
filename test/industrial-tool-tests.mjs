import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createIpcRegistrar } from "../electron/ipc/ipc-utils.mjs";
import { createIndustrialToolService, registerIndustrialToolIpc } from "../electron/services/industrial-tool-service.mjs";
import { DomainPackManager } from "../dist/domain-packs.js";
import { IndustrialProjectStore } from "../dist/industrial-project.js";
import { IndustrialToolAdapterRegistry, builtInIndustrialToolAdapters } from "../dist/industrial-tool-adapters.js";
import { JobStore } from "../dist/job-center.js";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

function makeTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hi code 工具-"));
  const workspace = path.join(root, "项目 workspace");
  fs.mkdirSync(workspace, { recursive: true });
  return { root, workspace };
}

function makeFakeExecutable(dir, name, output = "FakeCAD 1.2.3") {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\necho "${output}"\n`, { mode: 0o755 });
  return file;
}

function makeFakeIfcPython(dir) {
  const file = path.join(dir, "python3");
  fs.writeFileSync(file, `#!/bin/sh\nif [ "$1" = "-c" ]; then\n  echo '{"ok": true, "version": "0.8.0-test"}'\n  exit 0\nfi\necho 'Python 3 test'\n`, { mode: 0o755 });
  return file;
}

function fakeAdapter(id = "fakecad") {
  return {
    id,
    name: "FakeCAD",
    vendor: "Hi Code Tests",
    kind: "open-source",
    domains: ["cad"],
    detection: {
      commands: [id],
      versionCommand: { command: id, args: ["--version"], pattern: "([0-9]+\\.[0-9]+\\.[0-9]+)" },
      setupHint: "Install FakeCAD for tests.",
    },
    capabilities: [{
      id: `${id}-dry-run`,
      name: "FakeCAD dry-run",
      description: "Generate a dry-run plan for tests.",
      domains: ["cad"],
      artifactTypes: ["cad_model", "drawing"],
      qualityGates: ["cad_validation"],
      dryRunSupported: true,
      requiresInstalledTool: false,
    }],
    networkAccess: "forbidden-by-default",
  };
}

function fakeIpcMain() {
  const handles = new Map();
  return {
    handles,
    handle(channel, fn) {
      handles.set(channel, fn);
    },
  };
}

function validPlcRequest(outputDir = ".hicode/artifacts/plc/test-dry-run") {
  return {
    controllerType: "openplc-compatible-soft-plc",
    targetRuntime: "openplc",
    scanCycleRequirement: "100ms nominal scan cycle",
    controlLogicDescription: "Generate fail-safe pump permissive draft; outputs remain disabled until approval.",
    safetyInterlocks: [
      "Emergency stop healthy input must be true before any output is considered.",
      "Manual safety engineer approval required before commissioning.",
    ],
    ioPoints: [
      { tag: "E_STOP_NC", address: "%IX0.0", direction: "input", signalType: "bool", description: "Normally closed emergency stop healthy signal" },
      { tag: "START_PB", address: "%IX0.1", direction: "input", signalType: "bool", description: "Start pushbutton" },
      { tag: "PUMP_RUN_CMD", address: "%QX0.0", direction: "output", signalType: "bool", description: "Pump run command forced false in draft" },
    ],
    outputDir,
  };
}

function validBimRequest(outputDir = ".hicode/artifacts/bim/test-dry-run") {
  return {
    ifcPath: "models/sample.ifc",
    outputDir,
    checkProperties: true,
    generateDeliveryChecklist: true,
    targetStandard: "ISO 19650 delivery checklist",
  };
}

function validSolidWorksRequest(outputDir = ".hicode/artifacts/solidworks/test-bridge") {
  return {
    bridgeType: "part",
    partName: "hicode-bridge-control-box",
    dimensions: { length: 120, width: 80, height: 36, wallThickness: 3 },
    material: "ABS",
    units: "mm",
    expectedOutputs: ["SLDPRT", "STEP", "BOM"],
    outputDir,
    bridgeScriptType: "vba",
  };
}

function validAvevaRequest(outputDir = ".hicode/artifacts/aveva/test-plan", endpoint = undefined) {
  return {
    connectionProfile: {
      profileName: "plant-data-dry-run",
      systemType: "aveva-engineering",
      endpoint,
      authMode: "system_keychain",
      projectId: "PROJECT-001",
      workspaceMapping: {
        exportRoot: ".hicode/artifacts/aveva",
        importRoot: ".hicode/artifacts/aveva/inbound",
      },
      allowedOperations: [
        "engineering_data_exchange_plan",
        "tag_list_import_export_plan",
        "equipment_list_import_export_plan",
        "piping_line_list_plan",
        "document_register_plan",
        "change_sync_plan",
      ],
      credentialRef: "system-keychain:aveva/profile/plant-data-dry-run",
    },
    projectReference: { projectId: "PROJECT-001", projectName: "Demo Plant", area: "A1", unit: "U100", revision: "P0" },
    requestedOperations: ["engineering_data_exchange_plan", "tag_list_import_export_plan", "equipment_list_import_export_plan", "document_register_plan"],
    outputDir,
    sourceFormat: "csv",
    targetFormat: "csv",
    includeTemplates: true,
  };
}

function writeSampleIfc(workspace) {
  const modelDir = path.join(workspace, "models");
  fs.mkdirSync(modelDir, { recursive: true });
  const file = path.join(modelDir, "sample.ifc");
  fs.writeFileSync(file, [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('CoordinationView'),'2;1');",
    "FILE_NAME('sample.ifc','2026-07-04T00:00:00',('Hi Code'),('Hi Code'),'Hi Code','Hi Code','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n"));
  return file;
}

console.log("\n[industrial-tools] registry");
const builtins = builtInIndustrialToolAdapters();
check("built-in adapters include open and commercial targets", ["freecad", "kicad", "openplc", "ifcopenshell", "solidworks", "aveva"].every((id) => builtins.some((adapter) => adapter.id === id)));
const freeCadBuiltin = builtins.find((adapter) => adapter.id === "freecad");
check("FreeCAD exposes Sprint 6B capabilities", ["parametric_part_generation", "enclosure_generation", "step_export", "stl_export", "basic_geometry_check", "drawing_placeholder_plan"].every((id) => freeCadBuiltin?.capabilities.some((capability) => capability.id === id)));
const kiCadBuiltin = builtins.find((adapter) => adapter.id === "kicad");
check("KiCad exposes Sprint 6C capabilities", ["project_inspection", "schematic_check", "pcb_drc", "gerber_export", "drill_export", "bom_export_plan"].every((id) => kiCadBuiltin?.capabilities.some((capability) => capability.id === id)));
const plcBuiltin = builtins.find((adapter) => adapter.id === "openplc");
check("OpenPLC exposes Sprint 6D capabilities", ["structured_text_generation", "io_map_generation", "plc_project_scaffold", "syntax_check_plan", "fat_sat_checklist", "safety_review_required"].every((id) => plcBuiltin?.capabilities.some((capability) => capability.id === id)));
const bimBuiltin = builtins.find((adapter) => adapter.id === "ifcopenshell");
check("IfcOpenShell exposes Sprint 6E capabilities", ["ifc_inspection", "element_count", "space_count", "property_extract", "clash_check_plan", "code_check_checklist", "bim_delivery_checklist"].every((id) => bimBuiltin?.capabilities.some((capability) => capability.id === id)));
const solidWorksBuiltin = builtins.find((adapter) => adapter.id === "solidworks");
check("SolidWorks exposes Sprint 6F bridge capabilities", ["part_generation_bridge", "assembly_generation_bridge", "drawing_export_bridge", "step_export_bridge", "bom_export_bridge", "macro_generation", "external_execution_required"].every((id) => solidWorksBuiltin?.capabilities.some((capability) => capability.id === id)));
const avevaBuiltin = builtins.find((adapter) => adapter.id === "aveva");
check("AVEVA exposes Sprint 6G bridge capabilities", ["engineering_data_exchange_plan", "tag_list_import_export_plan", "equipment_list_import_export_plan", "piping_line_list_plan", "document_register_plan", "change_sync_plan", "external_connector_required"].every((id) => avevaBuiltin?.capabilities.some((capability) => capability.id === id)));

const executableDir = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-fake-tool-bin-"));
makeFakeExecutable(executableDir, "fakecad");
const fakeFreeCadCmd = makeFakeExecutable(executableDir, "FreeCADCmd", "FreeCAD 0.22.1");
const fakeKiCadCli = makeFakeExecutable(executableDir, "kicad-cli", "kicad-cli 8.0.0");
const fakeIec2c = makeFakeExecutable(executableDir, "iec2c", "iec2c 1.4.0");
const fakeIfcPython = makeFakeIfcPython(executableDir);
makeFakeExecutable(executableDir, "SLDWORKS.exe", "SolidWorks 2026 test");
const registry = new IndustrialToolAdapterRegistry({ adapters: [fakeAdapter()], pathEnv: executableDir, env: { PATH: executableDir, HOME: os.homedir() } });
const detected = registry.detectAdapter("fakecad");
check("command exists detection marks installed", detected.installed === true && detected.executablePath?.endsWith("fakecad"), JSON.stringify(detected));
check("version command output is parsed", detected.version?.version === "1.2.3", JSON.stringify(detected.version));
check("capability lookup returns adapter gates", registry.getAdapterCapabilities("fakecad")[0].qualityGates.includes("cad_validation"));
check("invalid adapter config is rejected", registry.validateAdapterConfig({ id: "bad", name: "Bad" }).ok === false);
const manualFreeCadDetection = new IndustrialToolAdapterRegistry({ pathEnv: "", env: { PATH: "", HOME: os.homedir() } }).detectAdapter("freecad", { executablePath: fakeFreeCadCmd });
check("FreeCAD manual executable path is detected", manualFreeCadDetection.installed === true && manualFreeCadDetection.version?.version === "0.22.1", JSON.stringify(manualFreeCadDetection));
const manualKiCadDetection = new IndustrialToolAdapterRegistry({ pathEnv: "", env: { PATH: "", HOME: os.homedir() } }).detectAdapter("kicad", { executablePath: fakeKiCadCli });
check("KiCad manual executable path is detected", manualKiCadDetection.installed === true && manualKiCadDetection.version?.version === "8.0.0", JSON.stringify(manualKiCadDetection));
const manualPlcDetection = new IndustrialToolAdapterRegistry({ pathEnv: "", env: { PATH: "", HOME: os.homedir() } }).detectAdapter("openplc", { executablePath: fakeIec2c });
check("OpenPLC manual compiler path is detected", manualPlcDetection.installed === true && manualPlcDetection.version?.version === "1.4.0", JSON.stringify(manualPlcDetection));
const manualIfcDetection = new IndustrialToolAdapterRegistry({ pathEnv: "", env: { PATH: "", HOME: os.homedir() } }).detectAdapter("ifcopenshell", { executablePath: fakeIfcPython });
check("IfcOpenShell manual Python path is detected by module probe", manualIfcDetection.installed === true && manualIfcDetection.version?.version === "0.8.0-test", JSON.stringify(manualIfcDetection));
const unsupportedSolidWorksDetection = new IndustrialToolAdapterRegistry({ pathEnv: executableDir, env: { PATH: executableDir, HOME: os.homedir(), HICODE_HOST_PLATFORM: "darwin" } }).detectAdapter("solidworks");
check("SolidWorks non-Windows platform is unsupported", unsupportedSolidWorksDetection.installed === false && /unsupported_platform/.test(unsupportedSolidWorksDetection.reason), JSON.stringify(unsupportedSolidWorksDetection));
const windowsSolidWorksDetection = new IndustrialToolAdapterRegistry({ pathEnv: executableDir, env: { PATH: executableDir, HOME: os.homedir(), HICODE_HOST_PLATFORM: "win32" } }).detectAdapter("solidworks");
check("SolidWorks Windows detection can find local executable evidence", windowsSolidWorksDetection.installed === true && windowsSolidWorksDetection.version?.version === "unknown", JSON.stringify(windowsSolidWorksDetection));
const avevaProfileDetection = new IndustrialToolAdapterRegistry({ pathEnv: "", env: { PATH: "", HOME: os.homedir(), AVEVA_CONNECTOR_CONFIG: path.join(executableDir, "aveva-profile.json") } }).detectAdapter("aveva");
check("AVEVA profile evidence is detected without claiming live connection", avevaProfileDetection.installed === true && /No live AVEVA connection/.test(avevaProfileDetection.reason), JSON.stringify(avevaProfileDetection));

console.log("\n[industrial-tools] missing tools and dry-run");
const missingRegistry = new IndustrialToolAdapterRegistry({ pathEnv: "", env: { PATH: "", HOME: os.homedir() } });
const missing = missingRegistry.detectAdapter("kicad");
check("missing tool detection does not pretend installed", missing.installed === false && /No command/.test(missing.reason) && missing.setupHint.length > 0, JSON.stringify(missing));
const missingFreeCad = missingRegistry.detectAdapter("freecad");
check("FreeCAD missing detection returns not installed", missingFreeCad.installed === false && /FreeCAD/.test(missingFreeCad.setupHint), JSON.stringify(missingFreeCad));
const missingPlc = missingRegistry.detectAdapter("openplc");
check("OpenPLC missing detection returns not installed", missingPlc.installed === false && /OpenPLC|MATIEC/.test(missingPlc.setupHint), JSON.stringify(missingPlc));
const missingSolidWorks = missingRegistry.detectAdapter("solidworks");
check("SolidWorks missing or unsupported detection does not pretend installed", missingSolidWorks.installed === false && /unsupported_platform|not found/.test(missingSolidWorks.reason), JSON.stringify(missingSolidWorks));
const missingAveva = missingRegistry.detectAdapter("aveva");
check("AVEVA missing connection profile does not pretend installed", missingAveva.installed === false && /not configured/.test(missingAveva.reason), JSON.stringify(missingAveva));

const { root, workspace } = makeTempWorkspace();
writeSampleIfc(workspace);
const pcbDir = path.join(workspace, "hardware", "controller");
fs.mkdirSync(pcbDir, { recursive: true });
fs.writeFileSync(path.join(pcbDir, "controller.kicad_pro"), JSON.stringify({ meta: "test" }));
fs.writeFileSync(path.join(pcbDir, "controller.kicad_sch"), "(kicad_sch test)");
fs.writeFileSync(path.join(pcbDir, "controller.kicad_pcb"), "(kicad_pcb test)");
const dryRun = missingRegistry.runAdapterTask({
  adapterId: "kicad",
  task: "Generate PCB ERC and Gerber export plan",
  mode: "dry-run",
  workspacePath: workspace,
  actor: "tester",
  pcbRequest: {
    projectPath: "hardware/controller/controller.kicad_pro",
    schematicPath: "hardware/controller/controller.kicad_sch",
    boardPath: "hardware/controller/controller.kicad_pcb",
    outputDir: ".hicode/artifacts/kicad/test-dry-run",
    exportGerber: true,
    exportDrill: true,
    runErc: true,
    runDrc: true,
    bomFormat: "csv",
  },
});
check("KiCad dry-run succeeds without installed tool", dryRun.ok === true && dryRun.simulated === true && dryRun.artifacts.length === 4 && dryRun.artifacts.every((item) => item.simulated === true), JSON.stringify(dryRun));
check("KiCad dry-run artifacts are persisted inside workspace", dryRun.artifacts.every((item) => fs.existsSync(item.path) && item.path.startsWith(workspace)), JSON.stringify(dryRun.artifacts));
const kiCadExpectedArtifactsPath = dryRun.artifacts.find((item) => item.name === "expected-artifacts.json")?.path;
const kiCadPreviewPath = dryRun.artifacts.find((item) => item.name === "command-preview.sh")?.path;
const dryRunArtifact = kiCadExpectedArtifactsPath ? JSON.parse(fs.readFileSync(kiCadExpectedArtifactsPath, "utf8")) : {};
const commandPreview = kiCadPreviewPath ? fs.readFileSync(kiCadPreviewPath, "utf8") : "";
check("KiCad dry-run artifact metadata marks simulation", dryRunArtifact.simulated === true && Array.isArray(dryRunArtifact.artifacts) && dryRunArtifact.artifacts.some((item) => item.type === "gerber" && item.simulated === true), JSON.stringify(dryRunArtifact));
check("KiCad command preview includes ERC DRC and Gerber flow", commandPreview.includes("kicad-cli") && commandPreview.includes("sch erc") && commandPreview.includes("pcb drc") && commandPreview.includes("export gerbers"), commandPreview);
check("KiCad dry-run gates are simulated", dryRun.diagnostics.some((item) => item.gateStatus === "simulated"), JSON.stringify(dryRun.diagnostics));

const missingProjectDryRun = missingRegistry.runAdapterTask({
  adapterId: "kicad",
  task: "Plan missing project inspection",
  mode: "dry-run",
  workspacePath: workspace,
  pcbRequest: {
    projectPath: "hardware/missing/missing.kicad_pro",
    outputDir: ".hicode/artifacts/kicad/missing-project",
    exportGerber: false,
    exportDrill: false,
    runErc: false,
    runDrc: false,
    bomFormat: "none",
  },
});
check("KiCad .kicad_pro missing check is reported without fake pass", missingProjectDryRun.ok === true && missingProjectDryRun.diagnostics.some((item) => item.code === "kicad.project.missing" && item.gateStatus === "simulated"), JSON.stringify(missingProjectDryRun.diagnostics));

const escapingKiCadProject = missingRegistry.runAdapterTask({
  adapterId: "kicad",
  task: "Bad project path",
  mode: "dry-run",
  workspacePath: workspace,
  pcbRequest: { projectPath: "../outside.kicad_pro", outputDir: ".hicode/artifacts/kicad/bad-project" },
});
check("KiCad project path escape is rejected", escapingKiCadProject.ok === false && /escapes workspace/.test(escapingKiCadProject.error || ""), JSON.stringify(escapingKiCadProject));

const nonArtifactKiCad = missingRegistry.runAdapterTask({
  adapterId: "kicad",
  task: "Bad KiCad output path",
  mode: "dry-run",
  workspacePath: workspace,
  pcbRequest: { outputDir: "tmp/kicad-output" },
});
check("KiCad output path must stay in project artifact directory", nonArtifactKiCad.ok === false && /\.hicode\/artifacts/.test(nonArtifactKiCad.error || ""), JSON.stringify(nonArtifactKiCad));

const plcDryRun = missingRegistry.runAdapterTask({
  adapterId: "openplc",
  task: "Generate PLC engineering draft",
  mode: "dry-run",
  workspacePath: workspace,
  actor: "tester",
  plcRequest: validPlcRequest(),
});
check("OpenPLC dry-run generates PLC engineering artifacts", plcDryRun.ok === true && plcDryRun.simulated === true && ["plc-program.st", "io-map.csv", "safety-interlocks.md", "fat-checklist.md", "sat-checklist.md", "metadata.json", "plc-compile-plan.md", "command-preview.sh", "expected-artifacts.json"].every((name) => plcDryRun.artifacts.some((artifact) => artifact.name === name && fs.existsSync(artifact.path))), JSON.stringify(plcDryRun));
const plcProgram = fs.readFileSync(plcDryRun.artifacts.find((artifact) => artifact.name === "plc-program.st")?.path || "", "utf8");
const plcIoMap = fs.readFileSync(plcDryRun.artifacts.find((artifact) => artifact.name === "io-map.csv")?.path || "", "utf8");
const plcMetadata = JSON.parse(fs.readFileSync(plcDryRun.artifacts.find((artifact) => artifact.name === "metadata.json")?.path || "", "utf8"));
const plcExpected = JSON.parse(fs.readFileSync(plcDryRun.artifacts.find((artifact) => artifact.name === "expected-artifacts.json")?.path || "", "utf8"));
check("OpenPLC ST file is fail-safe and not device-control logic", plcProgram.includes("PROGRAM PLC_PRG") && plcProgram.includes("PUMP_RUN_CMD := FALSE") && plcProgram.includes("device download"), plcProgram);
check("OpenPLC I/O map contains requested points", plcIoMap.includes("E_STOP_NC") && plcIoMap.includes("%QX0.0") && plcIoMap.includes("PUMP_RUN_CMD"), plcIoMap);
check("OpenPLC artifact metadata marks compile not_run", plcMetadata.compileStatus === "not_run" && plcMetadata.deviceDownloadPerformed === false && plcExpected.compileStatus === "not_run", JSON.stringify(plcMetadata));
check("OpenPLC compile gate is not marked passed when dry-run", plcDryRun.diagnostics.some((item) => item.code === "plc.compile.not_run" && item.gateStatus === "not_run"), JSON.stringify(plcDryRun.diagnostics));

const missingEmergencyStop = missingRegistry.runAdapterTask({
  adapterId: "openplc",
  task: "Generate PLC draft without emergency stop",
  mode: "dry-run",
  workspacePath: workspace,
  plcRequest: {
    ...validPlcRequest(".hicode/artifacts/plc/missing-estop"),
    safetyInterlocks: ["Guard door closed before motion"],
    ioPoints: [
      { tag: "START_PB", address: "%IX0.1", direction: "input", signalType: "bool" },
      { tag: "MOTOR_RUN", address: "%QX0.0", direction: "output", signalType: "bool" },
    ],
  },
});
check("OpenPLC missing emergency stop produces safety warning gate", missingEmergencyStop.ok === true && missingEmergencyStop.diagnostics.some((item) => item.code === "plc.safety.emergency_stop_missing" && item.severity === "warning"), JSON.stringify(missingEmergencyStop.diagnostics));

const invalidPlcPoint = missingRegistry.runAdapterTask({
  adapterId: "openplc",
  task: "Bad PLC point",
  mode: "dry-run",
  workspacePath: workspace,
  plcRequest: { ...validPlcRequest(".hicode/artifacts/plc/bad-point"), ioPoints: [{ tag: "1BAD", address: "%QX0.0", direction: "output", signalType: "bool" }] },
});
check("OpenPLC illegal point is rejected", invalidPlcPoint.ok === false && /safe IEC identifier/.test(invalidPlcPoint.error || ""), JSON.stringify(invalidPlcPoint));

const nonArtifactPlc = missingRegistry.runAdapterTask({
  adapterId: "openplc",
  task: "Bad PLC output path",
  mode: "dry-run",
  workspacePath: workspace,
  plcRequest: { ...validPlcRequest("tmp/plc-output") },
});
check("OpenPLC output path must stay in project artifact directory", nonArtifactPlc.ok === false && /\.hicode\/artifacts/.test(nonArtifactPlc.error || ""), JSON.stringify(nonArtifactPlc));

const fakeCompilerRegistry = new IndustrialToolAdapterRegistry({ pathEnv: executableDir, env: { PATH: executableDir, HOME: os.homedir() } });
const fakeCompileRun = fakeCompilerRegistry.runAdapterTask({
  adapterId: "openplc",
  task: "Run fake IEC compiler smoke path",
  mode: "execute",
  workspacePath: workspace,
  userApproved: true,
  plcRequest: validPlcRequest(".hicode/artifacts/plc/fake-compile"),
});
const fakeCompileMetadata = JSON.parse(fs.readFileSync(fakeCompileRun.artifacts.find((artifact) => artifact.name === "metadata.json")?.path || "", "utf8"));
check("OpenPLC installed compiler path runs approved syntax check path", fakeCompileRun.ok === true && fakeCompileMetadata.compileStatus === "passed" && fakeCompileRun.artifacts.some((artifact) => artifact.name === "plc-compile.log"), JSON.stringify(fakeCompileRun));

const forcedMissingIfcManifest = {
  ...bimBuiltin,
  detection: { ...bimBuiltin.detection, commands: [], executablePaths: [], envVars: [], configPaths: [] },
};
const missingIfcRegistry = new IndustrialToolAdapterRegistry({ adapters: [forcedMissingIfcManifest], pathEnv: "", env: { PATH: "", HOME: os.homedir() } });
const missingIfc = missingIfcRegistry.detectAdapter("ifcopenshell");
check("IfcOpenShell forced missing detection does not pretend installed", missingIfc.installed === false && /No IfcOpenShell/.test(missingIfc.reason), JSON.stringify(missingIfc));
const bimDryRun = missingIfcRegistry.runAdapterTask({
  adapterId: "ifcopenshell",
  task: "Plan IFC inspection",
  mode: "dry-run",
  workspacePath: workspace,
  actor: "tester",
  bimRequest: validBimRequest(),
});
check("IfcOpenShell missing install writes dry-run BIM artifacts", bimDryRun.ok === true && bimDryRun.simulated === true && ["ifc-check-plan.md", "expected-input.json", "expected-artifacts.json", "command-preview.sh", "metadata.json", "bim-delivery-checklist.md"].every((name) => bimDryRun.artifacts.some((artifact) => artifact.name === name && fs.existsSync(artifact.path))), JSON.stringify(bimDryRun));
const bimExpectedPath = bimDryRun.artifacts.find((artifact) => artifact.name === "expected-artifacts.json")?.path;
const bimMetadataPath = bimDryRun.artifacts.find((artifact) => artifact.name === "metadata.json")?.path;
const bimPreviewPath = bimDryRun.artifacts.find((artifact) => artifact.name === "command-preview.sh")?.path;
const bimExpected = bimExpectedPath ? JSON.parse(fs.readFileSync(bimExpectedPath, "utf8")) : {};
const bimMetadata = bimMetadataPath ? JSON.parse(fs.readFileSync(bimMetadataPath, "utf8")) : {};
const bimPreview = bimPreviewPath ? fs.readFileSync(bimPreviewPath, "utf8") : "";
check("IfcOpenShell dry-run artifact metadata marks simulation", bimExpected.simulated === true && bimMetadata.simulated === true && bimMetadata.complianceConclusion === null, JSON.stringify(bimMetadata));
check("IfcOpenShell command preview is generated", bimPreview.includes("python") && bimPreview.includes("ifcopenshell"), bimPreview);
check("IfcOpenShell dry-run gates are simulated not passed", bimDryRun.diagnostics.some((item) => item.code === "bim.ifc.dry_run" && item.gateStatus === "simulated"), JSON.stringify(bimDryRun.diagnostics));

const escapingIfc = missingIfcRegistry.runAdapterTask({
  adapterId: "ifcopenshell",
  task: "Bad IFC path",
  mode: "dry-run",
  workspacePath: workspace,
  bimRequest: { ...validBimRequest(".hicode/artifacts/bim/bad-ifc"), ifcPath: "../outside.ifc" },
});
check("IfcOpenShell illegal IFC path is rejected", escapingIfc.ok === false && /escapes workspace/.test(escapingIfc.error || ""), JSON.stringify(escapingIfc));

const missingStandard = missingIfcRegistry.runAdapterTask({
  adapterId: "ifcopenshell",
  task: "Plan IFC without target standard",
  mode: "dry-run",
  workspacePath: workspace,
  bimRequest: { ...validBimRequest(".hicode/artifacts/bim/missing-standard"), targetStandard: undefined },
});
check("IfcOpenShell missing targetStandard produces warning", missingStandard.ok === true && missingStandard.diagnostics.some((item) => item.code === "bim.ifc.target_standard.missing" && item.severity === "warning"), JSON.stringify(missingStandard.diagnostics));

const missingIfcFile = missingIfcRegistry.runAdapterTask({
  adapterId: "ifcopenshell",
  task: "Plan IFC missing file",
  mode: "dry-run",
  workspacePath: workspace,
  bimRequest: { ...validBimRequest(".hicode/artifacts/bim/missing-file"), ifcPath: "models/missing.ifc" },
});
check("IfcOpenShell missing IFC file is warning in dry-run", missingIfcFile.ok === true && missingIfcFile.diagnostics.some((item) => item.code === "bim.ifc.file.missing" && item.gateStatus === "simulated"), JSON.stringify(missingIfcFile.diagnostics));

const solidWorksDryRun = missingRegistry.runAdapterTask({
  adapterId: "solidworks",
  task: "Generate SolidWorks bridge package",
  mode: "dry-run",
  workspacePath: workspace,
  actor: "tester",
  solidworksRequest: validSolidWorksRequest(),
});
check("SolidWorks missing install writes bridge dry-run artifacts", solidWorksDryRun.ok === true && solidWorksDryRun.simulated === true && ["solidworks-run-plan.md", "solidworks-bridge-plan.md", "macro-template.bas", "expected-artifacts.json", "manual-setup.md", "metadata.json"].every((name) => solidWorksDryRun.artifacts.some((artifact) => artifact.name === name && fs.existsSync(artifact.path))), JSON.stringify(solidWorksDryRun));
const solidWorksMacroPath = solidWorksDryRun.artifacts.find((artifact) => artifact.name === "macro-template.bas")?.path;
const solidWorksMetadataPath = solidWorksDryRun.artifacts.find((artifact) => artifact.name === "metadata.json")?.path;
const solidWorksExpectedPath = solidWorksDryRun.artifacts.find((artifact) => artifact.name === "expected-artifacts.json")?.path;
const solidWorksMacro = solidWorksMacroPath ? fs.readFileSync(solidWorksMacroPath, "utf8") : "";
const solidWorksMetadata = solidWorksMetadataPath ? JSON.parse(fs.readFileSync(solidWorksMetadataPath, "utf8")) : {};
const solidWorksExpected = solidWorksExpectedPath ? JSON.parse(fs.readFileSync(solidWorksExpectedPath, "utf8")) : {};
check("SolidWorks macro template is generated for manual bridge execution", solidWorksMacro.includes("Application.SldWorks") && solidWorksMacro.includes("Hi Code does not execute this macro automatically"), solidWorksMacro);
check("SolidWorks metadata marks simulated external requirement", solidWorksMetadata.generated === true && solidWorksMetadata.simulated === true && solidWorksMetadata.external_required === true && solidWorksExpected.artifacts?.some((artifact) => artifact.name.endsWith(".sldprt") && artifact.external_required === true && artifact.generated === false), JSON.stringify(solidWorksMetadata));
check("SolidWorks dry-run gates are not marked passed", solidWorksDryRun.diagnostics.length > 0 && !solidWorksDryRun.diagnostics.some((item) => item.gateStatus === "passed"), JSON.stringify(solidWorksDryRun.diagnostics));

const escapingSolidWorks = missingRegistry.runAdapterTask({
  adapterId: "solidworks",
  task: "Bad SolidWorks output path",
  mode: "dry-run",
  workspacePath: workspace,
  solidworksRequest: validSolidWorksRequest("../solidworks-escape"),
});
check("SolidWorks output path escape is rejected", escapingSolidWorks.ok === false && /escapes workspace/.test(escapingSolidWorks.error || ""), JSON.stringify(escapingSolidWorks));

const invalidSolidWorksDimensions = missingRegistry.runAdapterTask({
  adapterId: "solidworks",
  task: "Bad SolidWorks dimensions",
  mode: "dry-run",
  workspacePath: workspace,
  solidworksRequest: { ...validSolidWorksRequest(".hicode/artifacts/solidworks/bad-dimensions"), dimensions: { length: -1, width: 80, height: 36, wallThickness: 3 } },
});
check("SolidWorks invalid dimensions are rejected", invalidSolidWorksDimensions.ok === false && /positive number/.test(invalidSolidWorksDimensions.error || ""), JSON.stringify(invalidSolidWorksDimensions));

const avevaDryRun = missingRegistry.runAdapterTask({
  adapterId: "aveva",
  task: "Generate AVEVA data exchange plan",
  mode: "dry-run",
  workspacePath: workspace,
  actor: "tester",
  avevaRequest: validAvevaRequest(),
});
check("AVEVA unconfigured connection writes dry-run artifacts", avevaDryRun.ok === true && avevaDryRun.simulated === true && ["aveva-integration-plan.md", "data-exchange-schema.json", "tag-list-template.csv", "equipment-list-template.csv", "line-list-template.csv", "document-register-template.csv", "sync-risk-checklist.md", "metadata.json"].every((name) => avevaDryRun.artifacts.some((artifact) => artifact.name === name && fs.existsSync(artifact.path))), JSON.stringify(avevaDryRun));
const avevaMetadataPath = avevaDryRun.artifacts.find((artifact) => artifact.name === "metadata.json")?.path;
const avevaSchemaPath = avevaDryRun.artifacts.find((artifact) => artifact.name === "data-exchange-schema.json")?.path;
const avevaTagTemplatePath = avevaDryRun.artifacts.find((artifact) => artifact.name === "tag-list-template.csv")?.path;
const avevaMetadata = avevaMetadataPath ? JSON.parse(fs.readFileSync(avevaMetadataPath, "utf8")) : {};
const avevaSchema = avevaSchemaPath ? JSON.parse(fs.readFileSync(avevaSchemaPath, "utf8")) : {};
const avevaTagTemplate = avevaTagTemplatePath ? fs.readFileSync(avevaTagTemplatePath, "utf8") : "";
check("AVEVA metadata marks external required manual approval", avevaMetadata.simulated === true && avevaMetadata.external_required === true && avevaMetadata.manual_approval_required === true && avevaMetadata.plaintextCredentialsPersisted === false, JSON.stringify(avevaMetadata));
check("AVEVA data exchange schema includes engineering templates", Array.isArray(avevaSchema.tables?.tagList) && Array.isArray(avevaSchema.tables?.equipmentList) && Array.isArray(avevaSchema.tables?.pipingLineList), JSON.stringify(avevaSchema));
check("AVEVA tag list template is generated", avevaTagTemplate.includes("tag,description,system,service,unit,source_system,change_action"), avevaTagTemplate);
check("AVEVA dry-run gates are not marked passed", avevaDryRun.diagnostics.length > 0 && !avevaDryRun.diagnostics.some((item) => item.gateStatus === "passed"), JSON.stringify(avevaDryRun.diagnostics));

const avevaPlainPassword = missingRegistry.runAdapterTask({
  adapterId: "aveva",
  task: "Bad AVEVA credentials",
  mode: "dry-run",
  workspacePath: workspace,
  avevaRequest: {
    ...validAvevaRequest(".hicode/artifacts/aveva/plain-password"),
    connectionProfile: { ...validAvevaRequest().connectionProfile, password: "do-not-save" },
  },
});
check("AVEVA plaintext password is rejected", avevaPlainPassword.ok === false && /plaintext credentials/.test(avevaPlainPassword.error || ""), JSON.stringify(avevaPlainPassword));

const avevaHttpEndpoint = missingRegistry.runAdapterTask({
  adapterId: "aveva",
  task: "AVEVA HTTP endpoint warning",
  mode: "dry-run",
  workspacePath: workspace,
  avevaRequest: validAvevaRequest(".hicode/artifacts/aveva/http-warning", "http://insecure.example.local/aveva"),
});
check("AVEVA non-HTTPS endpoint produces warning", avevaHttpEndpoint.ok === true && avevaHttpEndpoint.diagnostics.some((item) => item.code === "aveva.endpoint.non_https" && item.severity === "warning"), JSON.stringify(avevaHttpEndpoint.diagnostics));

const invalidAvevaOperation = missingRegistry.runAdapterTask({
  adapterId: "aveva",
  task: "Bad AVEVA operation",
  mode: "dry-run",
  workspacePath: workspace,
  avevaRequest: {
    ...validAvevaRequest(".hicode/artifacts/aveva/bad-operation"),
    requestedOperations: ["unsafe_write_back"],
  },
});
check("AVEVA invalid allowed operation is rejected", invalidAvevaOperation.ok === false && /operation is invalid/.test(invalidAvevaOperation.error || ""), JSON.stringify(invalidAvevaOperation));

const escapingAveva = missingRegistry.runAdapterTask({
  adapterId: "aveva",
  task: "Bad AVEVA output path",
  mode: "dry-run",
  workspacePath: workspace,
  avevaRequest: validAvevaRequest("../aveva-escape"),
});
check("AVEVA output path escape is rejected", escapingAveva.ok === false && /escapes workspace/.test(escapingAveva.error || ""), JSON.stringify(escapingAveva));

const freeCadDryRun = missingRegistry.runAdapterTask({
  adapterId: "freecad",
  task: "Generate control box enclosure",
  mode: "dry-run",
  workspacePath: workspace,
  cadRequest: {
    partType: "control_box_enclosure",
    dimensions: { length: 120, width: 80, height: 36, wallThickness: 3, lidThickness: 3, mountHoleDiameter: 4, mountHoleOffset: 12 },
    material: "ABS",
    units: "mm",
    exportFormats: ["FCStd", "STEP", "STL"],
    outputDir: ".hicode/artifacts/freecad/test-dry-run",
  },
});
check("FreeCAD missing install writes dry-run plan files", freeCadDryRun.ok === true && freeCadDryRun.simulated === true && freeCadDryRun.artifacts.length === 3 && freeCadDryRun.artifacts.every((item) => fs.existsSync(item.path)), JSON.stringify(freeCadDryRun));
const freeCadExpectedArtifactsPath = freeCadDryRun.artifacts.find((item) => item.name === "expected-artifacts.json")?.path;
const freeCadExpectedArtifacts = freeCadExpectedArtifactsPath ? JSON.parse(fs.readFileSync(freeCadExpectedArtifactsPath, "utf8")) : {};
check("FreeCAD dry-run artifact metadata marks simulation", freeCadExpectedArtifacts.simulated === true && freeCadExpectedArtifacts.artifacts.some((item) => item.name === "control-box-enclosure.FCStd" && item.simulated === true), JSON.stringify(freeCadExpectedArtifacts));

const invalidFreeCad = missingRegistry.runAdapterTask({
  adapterId: "freecad",
  task: "Bad enclosure",
  mode: "dry-run",
  workspacePath: workspace,
  cadRequest: { dimensions: { length: -1 } },
});
check("FreeCAD invalid dimensions are rejected", invalidFreeCad.ok === false && /positive number|too small/.test(invalidFreeCad.error || ""), JSON.stringify(invalidFreeCad));

const escapingFreeCad = missingRegistry.runAdapterTask({
  adapterId: "freecad",
  task: "Bad output path",
  mode: "dry-run",
  workspacePath: workspace,
  cadRequest: { outputDir: "../escape" },
});
check("FreeCAD output path escape is rejected", escapingFreeCad.ok === false && /escapes workspace/.test(escapingFreeCad.error || ""), JSON.stringify(escapingFreeCad));

const nonArtifactFreeCad = missingRegistry.runAdapterTask({
  adapterId: "freecad",
  task: "Bad artifact root",
  mode: "dry-run",
  workspacePath: workspace,
  cadRequest: { outputDir: "tmp/freecad-output" },
});
check("FreeCAD output path must stay in project artifact directory", nonArtifactFreeCad.ok === false && /\.hicode\/artifacts/.test(nonArtifactFreeCad.error || ""), JSON.stringify(nonArtifactFreeCad));

try {
  missingRegistry.runAdapterTask({ adapterId: "kicad", task: "bad", mode: "dry-run", workspacePath: workspace, artifactDir: "../escape" });
  check("artifactDir path escape is rejected", false);
} catch (error) {
  check("artifactDir path escape is rejected", /escapes workspace/.test(error.message), error.message);
}
try {
  missingRegistry.runAdapterTask({ adapterId: "kicad", task: "bad", mode: "dry-run", workspacePath: workspace, inputArtifacts: ["../outside.step"] });
  check("input artifact path escape is rejected", false);
} catch (error) {
  check("input artifact path escape is rejected", /escapes workspace/.test(error.message), error.message);
}
const missingExecute = missingRegistry.runAdapterTask({ adapterId: "kicad", task: "Run DRC", mode: "execute", workspacePath: workspace });
check("missing installed tool can only dry-run", missingExecute.ok === false && /only dry-run/.test(missingExecute.error || ""), JSON.stringify(missingExecute));
const noApprovalExecute = registry.runAdapterTask({ adapterId: "fakecad", task: "Run CAD validation", mode: "execute", workspacePath: workspace });
check("installed tool execution requires explicit approval", noApprovalExecute.ok === false && /explicit user approval/.test(noApprovalExecute.error || ""), JSON.stringify(noApprovalExecute));
const sprintBlockedExecute = registry.runAdapterTask({ adapterId: "fakecad", task: "Run CAD validation", mode: "execute", workspacePath: workspace, userApproved: true });
check("generic non-specialized adapters still block real execution after approval", sprintBlockedExecute.ok === false && /unavailable for this adapter in Sprint 6G/.test(sprintBlockedExecute.error || ""), JSON.stringify(sprintBlockedExecute));

const realFreeCadWorkspace = path.join(root, "real-freecad-workspace");
fs.mkdirSync(realFreeCadWorkspace, { recursive: true });
const realFreeCadRegistry = new IndustrialToolAdapterRegistry();
const realFreeCadDetection = realFreeCadRegistry.detectAdapter("freecad");
if (!realFreeCadDetection.installed) {
  console.log(`  - skipped real FreeCAD execution: ${realFreeCadDetection.reason}`);
  check("real FreeCAD execution test skipped with reason when FreeCAD is absent", true);
} else {
  const realFreeCadRun = realFreeCadRegistry.runAdapterTask({
    adapterId: "freecad",
    task: "Generate real control box enclosure",
    mode: "execute",
    workspacePath: realFreeCadWorkspace,
    userApproved: true,
    cadRequest: { outputDir: ".hicode/artifacts/freecad/real-execution-test", exportFormats: ["FCStd"] },
  });
  check("real FreeCAD execution generates metadata when FreeCAD is installed", realFreeCadRun.ok === true && realFreeCadRun.artifacts.some((item) => item.name === "metadata.json" && fs.existsSync(item.path)), JSON.stringify(realFreeCadRun));
}
const realKiCadWorkspace = path.join(root, "real-kicad-workspace");
fs.mkdirSync(path.join(realKiCadWorkspace, "pcb"), { recursive: true });
fs.writeFileSync(path.join(realKiCadWorkspace, "pcb", "demo.kicad_pro"), JSON.stringify({ meta: "test" }));
fs.writeFileSync(path.join(realKiCadWorkspace, "pcb", "demo.kicad_sch"), "(kicad_sch test)");
fs.writeFileSync(path.join(realKiCadWorkspace, "pcb", "demo.kicad_pcb"), "(kicad_pcb test)");
const realKiCadRegistry = new IndustrialToolAdapterRegistry();
const realKiCadDetection = realKiCadRegistry.detectAdapter("kicad");
if (!realKiCadDetection.installed) {
  console.log(`  - skipped real KiCad execution: ${realKiCadDetection.reason}`);
  check("real KiCad execution test skipped with reason when KiCad is absent", true);
} else {
  const realKiCadRun = realKiCadRegistry.runAdapterTask({
    adapterId: "kicad",
    task: "Run real KiCad CLI smoke flow",
    mode: "execute",
    workspacePath: realKiCadWorkspace,
    userApproved: true,
    pcbRequest: {
      projectPath: "pcb/demo.kicad_pro",
      schematicPath: "pcb/demo.kicad_sch",
      boardPath: "pcb/demo.kicad_pcb",
      outputDir: ".hicode/artifacts/kicad/real-execution-test",
      exportGerber: true,
      exportDrill: true,
      runErc: true,
      runDrc: true,
      bomFormat: "csv",
    },
  });
  check("real KiCad execution records metadata/logs when KiCad is installed", realKiCadRun.artifacts.some((item) => item.name === "metadata.json" && fs.existsSync(item.path)) && realKiCadRun.artifacts.some((item) => item.name === "kicad-cli.log" && fs.existsSync(item.path)), JSON.stringify(realKiCadRun));
}
const realPlcWorkspace = path.join(root, "real-plc-workspace");
fs.mkdirSync(realPlcWorkspace, { recursive: true });
const realPlcRegistry = new IndustrialToolAdapterRegistry();
const realPlcDetection = realPlcRegistry.detectAdapter("openplc");
if (!realPlcDetection.installed) {
  console.log(`  - skipped real OpenPLC/IEC execution: ${realPlcDetection.reason}`);
  check("real OpenPLC execution test skipped with reason when compiler is absent", true);
} else {
  const realPlcRun = realPlcRegistry.runAdapterTask({
    adapterId: "openplc",
    task: "Run real IEC compiler smoke flow",
    mode: "execute",
    workspacePath: realPlcWorkspace,
    userApproved: true,
    plcRequest: validPlcRequest(".hicode/artifacts/plc/real-execution-test"),
  });
  check("real OpenPLC execution records metadata when tool is installed", realPlcRun.artifacts.some((item) => item.name === "metadata.json" && fs.existsSync(item.path)) && JSON.parse(fs.readFileSync(realPlcRun.artifacts.find((item) => item.name === "metadata.json")?.path || "", "utf8")).deviceDownloadPerformed === false, JSON.stringify(realPlcRun));
}
const realBimWorkspace = path.join(root, "real-bim-workspace");
fs.mkdirSync(realBimWorkspace, { recursive: true });
writeSampleIfc(realBimWorkspace);
const realBimRegistry = new IndustrialToolAdapterRegistry();
const realBimDetection = realBimRegistry.detectAdapter("ifcopenshell");
if (!realBimDetection.installed || !/python/i.test(realBimDetection.executablePath || "")) {
  console.log(`  - skipped real IfcOpenShell execution: ${realBimDetection.reason}`);
  check("real IfcOpenShell execution test skipped with reason when Python module is absent", true);
} else {
  const realBimRun = realBimRegistry.runAdapterTask({
    adapterId: "ifcopenshell",
    task: "Run real IFC inspection smoke flow",
    mode: "execute",
    workspacePath: realBimWorkspace,
    userApproved: true,
    bimRequest: validBimRequest(".hicode/artifacts/bim/real-execution-test"),
  });
  check("real IfcOpenShell execution records report and summary when module is installed", realBimRun.ok === true && realBimRun.artifacts.some((item) => item.name === "bim-inspection-report.json" && fs.existsSync(item.path)) && realBimRun.artifacts.some((item) => item.name === "bim-summary.md" && fs.existsSync(item.path)), JSON.stringify(realBimRun));
}
const realSolidWorksDetection = new IndustrialToolAdapterRegistry().detectAdapter("solidworks");
if (!realSolidWorksDetection.installed) {
  console.log(`  - skipped real SolidWorks bridge execution: ${realSolidWorksDetection.reason}`);
  check("real SolidWorks execution remains external and skipped without licensed Windows bridge", true);
} else {
  const realSolidWorksExecute = new IndustrialToolAdapterRegistry().runAdapterTask({
    adapterId: "solidworks",
    task: "Attempt SolidWorks bridge execution",
    mode: "execute",
    workspacePath: realBimWorkspace,
    userApproved: true,
    solidworksRequest: validSolidWorksRequest(".hicode/artifacts/solidworks/real-bridge-test"),
  });
  check("real SolidWorks bridge execution is reserved for external manual run", realSolidWorksExecute.ok === false && /external_required/.test(realSolidWorksExecute.error || ""), JSON.stringify(realSolidWorksExecute));
}
const realAvevaDetection = new IndustrialToolAdapterRegistry().detectAdapter("aveva");
if (!realAvevaDetection.installed) {
  console.log(`  - skipped real AVEVA connector execution: ${realAvevaDetection.reason}`);
  check("real AVEVA execution remains external and skipped without enterprise connector", true);
} else {
  const realAvevaExecute = new IndustrialToolAdapterRegistry().runAdapterTask({
    adapterId: "aveva",
    task: "Attempt AVEVA connector execution",
    mode: "execute",
    workspacePath: realBimWorkspace,
    userApproved: true,
    avevaRequest: validAvevaRequest(".hicode/artifacts/aveva/real-connector-test"),
  });
  check("real AVEVA connector execution is reserved for external approved connector", realAvevaExecute.ok === false && /external_required/.test(realAvevaExecute.error || ""), JSON.stringify(realAvevaExecute));
}

console.log("\n[industrial-tools] service, job center, project, domain pack");
const appData = path.join(root, "app-data");
const projectStore = new IndustrialProjectStore({ workspacePath: workspace });
projectStore.createProject({
  name: "PCB PLC Controller",
  type: "industrial_product",
  domains: ["pcb", "plc", "automation", "electrical", "bim", "architecture", "solidworks", "mechanical", "cad", "process_chemical", "energy", "manufacturing"],
  toolchain: [
    { id: "tool-kicad", name: "KiCad", type: "eda", domains: ["pcb"], dryRun: true },
    { id: "tool-openplc", name: "OpenPLC / IEC 61131-3", type: "plc", domains: ["plc", "automation"], dryRun: true },
    { id: "tool-ifc", name: "IfcOpenShell / IFC", type: "bim", domains: ["bim", "architecture"], dryRun: true },
    { id: "tool-solidworks", name: "SolidWorks Bridge", type: "cad", domains: ["solidworks", "mechanical", "cad"], dryRun: true },
    { id: "tool-aveva", name: "AVEVA Engineering Bridge", type: "industrial-data-platform", domains: ["process_chemical", "energy", "manufacturing"], dryRun: true },
  ],
});
const domainPackManager = new DomainPackManager({ safeRoot: path.join(appData, "domain-packs") });
domainPackManager.installDomainPack({ id: "pcb-eda" });
domainPackManager.enableDomainPack("pcb-eda");
const jobStore = new JobStore({ storePath: path.join(appData, "jobs", "jobs.json"), allowedArtifactRoots: [workspace] });
const service = createIndustrialToolService({
  registry: missingRegistry,
  getCwd: () => workspace,
  jobStore,
  domainPackManager,
  authorize: async () => "allow",
});
const listed = service.listAdapters();
check("service lists adapters and project/domain-pack requirements", listed.ok === true && listed.toolRequirements.some((item) => item.source === "project" && item.name === "KiCad") && listed.toolRequirements.some((item) => item.source === "project" && item.name === "OpenPLC / IEC 61131-3") && listed.toolRequirements.some((item) => item.source === "project" && item.name === "IfcOpenShell / IFC") && listed.toolRequirements.some((item) => item.source === "project" && item.name === "SolidWorks Bridge") && listed.toolRequirements.some((item) => item.source === "project" && item.name === "AVEVA Engineering Bridge") && listed.toolRequirements.some((item) => item.source === "domain-pack" && item.name === "EDA tool"), JSON.stringify(listed.toolRequirements));
const listJob = jobStore.getJob(listed.jobId);
check("tool detection writes JobEvents and GateResults", listJob?.events.some((event) => event.type === "industrial-tool.detected") && listJob?.gateResults.length > 0, JSON.stringify(listJob));
const serviceRun = await service.runAdapterTask({ adapterId: "kicad", task: "Plan Gerber export", mode: "dry-run", actor: "tester" });
check("service dry-run writes Job artifact", serviceRun.ok === true && jobStore.getJob(serviceRun.jobId)?.artifacts.some((artifact) => artifact.metadata?.simulated === true), JSON.stringify(jobStore.getJob(serviceRun.jobId)));
check("service dry-run writes diagnostic gate", jobStore.getJob(serviceRun.jobId)?.gateResults.some((gate) => gate.metadata?.adapterId === "kicad"));
const plcServiceRun = await service.runAdapterTask({ adapterId: "openplc", task: "Generate PLC draft", mode: "dry-run", actor: "tester", plcRequest: validPlcRequest(".hicode/artifacts/plc/service-dry-run") });
check("service OpenPLC dry-run writes Job artifact", plcServiceRun.ok === true && jobStore.getJob(plcServiceRun.jobId)?.artifacts.some((artifact) => artifact.name === "plc-program.st"), JSON.stringify(jobStore.getJob(plcServiceRun.jobId)));
check("service OpenPLC dry-run writes skipped compile gate", jobStore.getJob(plcServiceRun.jobId)?.gateResults.some((gate) => gate.metadata?.adapterId === "openplc" && gate.status === "skipped"));
const bimServiceRun = await service.runAdapterTask({ adapterId: "ifcopenshell", task: "Plan IFC inspection", mode: "dry-run", actor: "tester", bimRequest: validBimRequest(".hicode/artifacts/bim/service-dry-run") });
check("service IfcOpenShell dry-run writes Job artifact", bimServiceRun.ok === true && jobStore.getJob(bimServiceRun.jobId)?.artifacts.some((artifact) => artifact.name === "ifc-check-plan.md"), JSON.stringify(jobStore.getJob(bimServiceRun.jobId)));
check("service IfcOpenShell dry-run writes skipped BIM gate", jobStore.getJob(bimServiceRun.jobId)?.gateResults.some((gate) => gate.metadata?.adapterId === "ifcopenshell" && gate.status === "skipped"));
const solidWorksServiceRun = await service.runAdapterTask({ adapterId: "solidworks", task: "Generate SolidWorks bridge", mode: "dry-run", actor: "tester", solidworksRequest: validSolidWorksRequest(".hicode/artifacts/solidworks/service-bridge") });
check("service SolidWorks bridge dry-run writes Job artifact", solidWorksServiceRun.ok === true && jobStore.getJob(solidWorksServiceRun.jobId)?.artifacts.some((artifact) => artifact.name === "macro-template.bas"), JSON.stringify(jobStore.getJob(solidWorksServiceRun.jobId)));
check("service SolidWorks bridge dry-run writes skipped authorization gate", jobStore.getJob(solidWorksServiceRun.jobId)?.gateResults.some((gate) => gate.metadata?.adapterId === "solidworks" && gate.status === "skipped"));
const avevaServiceRun = await service.runAdapterTask({ adapterId: "aveva", task: "Generate AVEVA integration plan", mode: "dry-run", actor: "tester", avevaRequest: validAvevaRequest(".hicode/artifacts/aveva/service-plan") });
check("service AVEVA dry-run writes Job artifact", avevaServiceRun.ok === true && jobStore.getJob(avevaServiceRun.jobId)?.artifacts.some((artifact) => artifact.name === "tag-list-template.csv"), JSON.stringify(jobStore.getJob(avevaServiceRun.jobId)));
check("service AVEVA dry-run writes skipped approval gate", jobStore.getJob(avevaServiceRun.jobId)?.gateResults.some((gate) => gate.metadata?.adapterId === "aveva" && gate.status === "skipped"));

let industrialAuthorizationRequests = 0;
const deniedIndustrialService = createIndustrialToolService({
  registry: fakeCompilerRegistry,
  getCwd: () => workspace,
  jobStore,
  domainPackManager,
  authorize: async () => { industrialAuthorizationRequests += 1; return "deny"; },
});
const deniedIndustrialRun = await deniedIndustrialService.runAdapterTask({
  adapterId: "openplc",
  task: "Attempt approved compile",
  mode: "execute",
  userApproved: true,
  plcRequest: validPlcRequest(".hicode/artifacts/plc/denied-service-run"),
});
check("industrial execute cannot forge Renderer approval", industrialAuthorizationRequests === 1 && deniedIndustrialRun.ok === false && /approval/i.test(deniedIndustrialRun.error || deniedIndustrialRun.result?.error || ""));

console.log("\n[industrial-tools] IPC");
const ipc = fakeIpcMain();
const logs = [];
registerIndustrialToolIpc({
  register: createIpcRegistrar(ipc, { logger: (event, payload) => logs.push({ event, payload }) }),
  industrialTool: service,
});
const ipcList = await ipc.handles.get("toolchain:list")({});
check("IPC list returns adapters", ipcList.ok === true && Array.isArray(ipcList.adapters));
const ipcRun = await ipc.handles.get("toolchain:run")({}, { adapterId: "kicad", task: "Plan checks", mode: "dry-run" });
check("IPC run calls real service path", ipcRun.ok === true && ipcRun.result.simulated === true);
const ipcPlcRun = await ipc.handles.get("toolchain:run")({}, { adapterId: "openplc", task: "Generate PLC draft", mode: "dry-run", plcRequest: validPlcRequest(".hicode/artifacts/plc/ipc-dry-run") });
check("IPC OpenPLC run calls real service path", ipcPlcRun.ok === true && ipcPlcRun.result.artifacts.some((artifact) => artifact.name === "io-map.csv"));
const ipcBimRun = await ipc.handles.get("toolchain:run")({}, { adapterId: "ifcopenshell", task: "Plan IFC inspection", mode: "dry-run", bimRequest: validBimRequest(".hicode/artifacts/bim/ipc-dry-run") });
check("IPC IfcOpenShell run calls real service path", ipcBimRun.ok === true && ipcBimRun.result.artifacts.some((artifact) => artifact.name === "command-preview.sh"));
const ipcSolidWorksRun = await ipc.handles.get("toolchain:run")({}, { adapterId: "solidworks", task: "Generate SolidWorks bridge", mode: "dry-run", solidworksRequest: validSolidWorksRequest(".hicode/artifacts/solidworks/ipc-bridge") });
check("IPC SolidWorks run calls real service path", ipcSolidWorksRun.ok === true && ipcSolidWorksRun.result.artifacts.some((artifact) => artifact.name === "macro-template.bas"));
const ipcAvevaRun = await ipc.handles.get("toolchain:run")({}, { adapterId: "aveva", task: "Generate AVEVA plan", mode: "dry-run", avevaRequest: validAvevaRequest(".hicode/artifacts/aveva/ipc-plan") });
check("IPC AVEVA run calls real service path", ipcAvevaRun.ok === true && ipcAvevaRun.result.artifacts.some((artifact) => artifact.name === "data-exchange-schema.json"));

fs.rmSync(executableDir, { recursive: true, force: true });
fs.rmSync(root, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
