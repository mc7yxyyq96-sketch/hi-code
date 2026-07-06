import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createIpcRegistrar } from "../electron/ipc/ipc-utils.mjs";
import { createSampleProjectService, registerSampleProjectIpc } from "../electron/services/sample-project-service.mjs";
import { DomainPackManager } from "../dist/domain-packs.js";
import {
  createIndustrialControlBoxSample,
  requiredIndustrialControlBoxFiles,
  INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION,
} from "../dist/industrial-control-box-sample.js";
import { IndustrialProjectStore, validateIndustrialProject } from "../dist/industrial-project.js";
import { IndustrialToolAdapterRegistry } from "../dist/industrial-tool-adapters.js";
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

function fakeIpcMain() {
  const handles = new Map();
  return {
    handles,
    handle(channel, fn) {
      handles.set(channel, fn);
    },
  };
}

function makeWorkspace(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hicode-control-box-${label}-`));
  const workspace = path.join(root, "工业 sample workspace");
  fs.mkdirSync(workspace, { recursive: true });
  return { root, workspace };
}

function missingToolRegistry() {
  return new IndustrialToolAdapterRegistry({ pathEnv: "", env: { PATH: "", HOME: os.homedir() } });
}

console.log("\n[industrial-control-box] core sample generator");
const { root, workspace } = makeWorkspace("core");
const result = createIndustrialControlBoxSample({
  workspacePath: workspace,
  registry: missingToolRegistry(),
  actor: "tester",
  runInstalledTools: false,
  overwrite: true,
});

check("sample generator returns project and release package", result.project.projectId === "industrial-control-box-demo" && fs.existsSync(result.releasePackage.manifestPath), JSON.stringify(result));
check("all required sample files exist", requiredIndustrialControlBoxFiles().every((relative) => fs.existsSync(path.join(workspace, relative))), JSON.stringify(requiredIndustrialControlBoxFiles().filter((relative) => !fs.existsSync(path.join(workspace, relative)))));
check("project.json schema is valid", validateIndustrialProject(new IndustrialProjectStore({ workspacePath: workspace }).getProject()).ok === true);
const project = new IndustrialProjectStore({ workspacePath: workspace }).getProject();
check("project enables industrial control box domains", ["software", "cad", "pcb", "plc", "electrical", "automation", "manufacturing", "documentation", "qa"].every((domain) => project.domains.includes(domain)), JSON.stringify(project.domains));
check("domain pack alias mappings are explicit", project.metadata.domainPackAliasMappings.electrical === "energy-electrical" && project.metadata.domainPackAliasMappings.documentation === "software-product", JSON.stringify(project.metadata));
check("requirements include required scenario items", /enclosure dimensions/i.test(fs.readFileSync(path.join(workspace, "industrial-control-box-demo", "requirements.md"), "utf8")) && /emergency stop/i.test(fs.readFileSync(path.join(workspace, "industrial-control-box-demo", "requirements.md"), "utf8")) && /DIN rail/i.test(fs.readFileSync(path.join(workspace, "industrial-control-box-demo", "requirements.md"), "utf8")));
const requirementsJson = JSON.parse(fs.readFileSync(path.join(workspace, "industrial-control-box-demo", "requirements.json"), "utf8"));
check("requirements.json contains acceptance criteria", requirementsJson.requirements.length >= 7 && requirementsJson.requirements.every((req) => Array.isArray(req.acceptanceCriteria) && req.acceptanceCriteria.length > 0));
check("PLC artifacts are real files", ["plc-program.st", "io-map.csv", "safety-interlocks.md", "fat-checklist.md", "sat-checklist.md"].every((file) => fs.statSync(path.join(workspace, "industrial-control-box-demo", "plc", file)).size > 20));
check("PLC safety artifact mentions emergency stop and approval", /emergency stop/i.test(fs.readFileSync(path.join(workspace, "industrial-control-box-demo", "plc", "safety-interlocks.md"), "utf8")) && /approval/i.test(fs.readFileSync(path.join(workspace, "industrial-control-box-demo", "plc", "safety-interlocks.md"), "utf8")));
check("system BOM contains required categories", ["Enclosure", "PCB", "Terminals", "Relays", "Status LEDs", "Power connector", "DIN rail mount", "Wiring"].every((item) => fs.readFileSync(path.join(workspace, "industrial-control-box-demo", "bom", "system-bom.csv"), "utf8").includes(item)));
check("CAD dry-run artifacts are generated and simulated", fs.existsSync(path.join(workspace, "industrial-control-box-demo", "cad", "freecad-run-plan.md")) && JSON.parse(fs.readFileSync(path.join(workspace, "industrial-control-box-demo", "cad", "metadata.json"), "utf8")).simulated === true);
check("PCB dry-run artifacts are generated and simulated", fs.existsSync(path.join(workspace, "industrial-control-box-demo", "pcb", "kicad-run-plan.md")) && JSON.parse(fs.readFileSync(path.join(workspace, "industrial-control-box-demo", "pcb", "expected-artifacts.json"), "utf8")).simulated === true && fs.existsSync(path.join(workspace, "industrial-control-box-demo", "pcb", "bom-template.csv")));
check("gate results are generated for sample release", ["gate-requirements-completeness", "gate-cad-artifact", "gate-pcb-artifact", "gate-plc-safety", "gate-bom-completeness", "gate-documentation", "gate-release-readiness"].every((id) => project.qualityGates.some((gate) => gate.id === id)) && project.qualityGates.some((gate) => gate.status === "simulated"));
check("release package has manifest evidence checksums artifacts docs gates", ["release-manifest.json", "evidence-report.md", "checksums.sha256"].every((file) => fs.existsSync(path.join(workspace, "releases", INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION, file))) && ["artifacts", "docs", "gates"].every((dir) => fs.existsSync(path.join(workspace, "releases", INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION, dir))));
const manifest = JSON.parse(fs.readFileSync(path.join(workspace, "releases", INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION, "release-manifest.json"), "utf8"));
check("release manifest includes sample artifacts and simulated risks", manifest.projectId === "industrial-control-box-demo" && manifest.includedArtifacts.some((artifact) => artifact.name.includes("PLC")) && manifest.knownRisks.some((risk) => /simulated|not_run/i.test(risk.message)), JSON.stringify(manifest.knownRisks.slice(0, 3)));
check("release notes visibly mark dry-run evidence", /SIMULATED \/ DRY-RUN EVIDENCE/.test(fs.readFileSync(path.join(workspace, "releases", INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION, "release-notes.md"), "utf8")));

console.log("\n[industrial-control-box] service and IPC");
const { root: serviceRoot, workspace: serviceWorkspace } = makeWorkspace("service");
const jobStore = new JobStore({
  storePath: path.join(serviceRoot, "jobs.json"),
  allowedArtifactRoots: [serviceWorkspace, serviceRoot],
  idPrefix: "sample-job",
});
const domainPackManager = new DomainPackManager({ safeRoot: path.join(serviceRoot, "domain-packs") });
const service = createSampleProjectService({
  getCwd: () => serviceWorkspace,
  jobStore,
  registry: missingToolRegistry(),
  domainPackManager,
});
const serviceResult = service.createIndustrialControlBox({ overwrite: true, actor: "tester" });
check("service creates sample through real core path", serviceResult.ok === true && fs.existsSync(serviceResult.releasePackage.manifestPath), JSON.stringify(serviceResult));
const serviceJob = jobStore.getJob(serviceResult.jobId);
check("service writes Job Center events", serviceJob?.events.some((event) => event.type === "sample.project.created") && serviceJob?.events.some((event) => event.type === "sample.release.built"), JSON.stringify(serviceJob?.events));
check("service writes Job artifacts and gates", serviceJob?.artifacts.some((artifact) => artifact.type === "release_package") && serviceJob?.gateResults.some((gate) => gate.gate === "sample.release.readiness"), JSON.stringify(serviceJob));
check("service enables sample domain packs", ["mechanical-cad", "pcb-eda", "plc-automation", "energy-electrical", "manufacturing-qa", "software-product"].every((id) => domainPackManager.getDomainPack(id)?.enabled === true));

const ipc = fakeIpcMain();
const register = createIpcRegistrar(ipc);
registerSampleProjectIpc({ register, sampleProject: service });
check("IPC exposes sample create channel", ipc.handles.has("sample:industrial-control-box:create"));
const ipcWorkspace = path.join(serviceRoot, "ipc workspace");
fs.mkdirSync(ipcWorkspace, { recursive: true });
const ipcService = createSampleProjectService({
  getCwd: () => ipcWorkspace,
  jobStore,
  registry: missingToolRegistry(),
  domainPackManager,
});
const ipc2 = fakeIpcMain();
const register2 = createIpcRegistrar(ipc2);
registerSampleProjectIpc({ register: register2, sampleProject: ipcService });
const ipcResult = await ipc2.handles.get("sample:industrial-control-box:create")({}, { sampleId: "industrial-control-box", overwrite: true });
check("IPC create calls service and persists release", ipcResult.ok === true && fs.existsSync(ipcResult.releasePackage.manifestPath), JSON.stringify(ipcResult));
const badIpc = await ipc2.handles.get("sample:industrial-control-box:create")({}, { sampleId: "unknown-sample" });
check("IPC rejects unsupported sample id", badIpc.ok === false && /unsupported sample/.test(badIpc.error), JSON.stringify(badIpc));

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(serviceRoot, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
