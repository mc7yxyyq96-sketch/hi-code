import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { JobStore } from "../dist/job-center.js";
import { IndustrialProjectStore } from "../dist/industrial-project.js";
import {
  DOMAIN_PACK_MANIFEST_FILE,
  DomainPackManager,
  builtInDomainPacks,
  validateDomainPackManifest,
} from "../dist/domain-packs.js";
import { createDomainPackService, registerDomainPackIpc } from "../electron/services/domain-pack-service.mjs";

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    fail++;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

console.log("\n[domain-packs] manifest model");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-domain-packs-"));
const packRoot = path.join(tmp, "app data", "domain packs");
const manager = new DomainPackManager({ safeRoot: packRoot });
const builtins = builtInDomainPacks();
check("built-in pack count matches Sprint 5A list", builtins.length === 10, `got ${builtins.length}`);
check("built-in manifests validate", builtins.every((manifest) => validateDomainPackManifest(manifest).ok));
check("manifest exposes required hicode.domain.json fields", builtins.every((manifest) => [
  "id",
  "name",
  "version",
  "domains",
  "description",
  "standards",
  "templates",
  "checklists",
  "toolRequirements",
  "qualityGates",
  "agentProfiles",
  "sampleProjects",
].every((field) => Object.prototype.hasOwnProperty.call(manifest, field))));

const badScript = clone(builtins[0]);
badScript.scripts = { postinstall: "rm -rf /" };
check("manifest rejects automatic scripts", validateDomainPackManifest(badScript).ok === false);
const badLocalPath = clone(builtins[0]);
badLocalPath.templates[0].path = "/etc/passwd";
check("manifest rejects absolute template paths", validateDomainPackManifest(badLocalPath).ok === false);
const badRemote = clone(builtins[0]);
badRemote.sourcePath = "/home/attacker/private-pack";
check("remote manifest rejects sourcePath injection", validateDomainPackManifest(badRemote, { remote: true }).ok === false);
const badTool = clone(builtins[0]);
badTool.toolRequirements[0].command = "solidworks.exe";
check("tool requirements cannot define commands", validateDomainPackManifest(badTool).ok === false);

console.log("\n[domain-packs] manager persistence");
const installed = manager.installDomainPack({ id: "pcb-eda" });
check("install built-in pack writes hicode.domain.json", fs.existsSync(path.join(installed.path, DOMAIN_PACK_MANIFEST_FILE)));
check("install writes template and checklist files", fs.existsSync(path.join(installed.path, "templates", "requirements.md")) && fs.existsSync(path.join(installed.path, "checklists", "release.md")));
check("listDomainPacks marks installed pack", manager.listDomainPacks().some((pack) => pack.manifest.id === "pcb-eda" && pack.installed === true));
const enabled = manager.enableDomainPack("pcb-eda");
check("enableDomainPack persists enabled state", enabled.enabled === true && manager.getDomainPack("pcb-eda")?.enabled === true);
const reloaded = new DomainPackManager({ safeRoot: packRoot });
check("enabled state survives manager reload", reloaded.getDomainPack("pcb-eda")?.enabled === true);
const disabled = reloaded.disableDomainPack("pcb-eda");
check("disableDomainPack persists disabled state", disabled.enabled === false && reloaded.getDomainPack("pcb-eda")?.enabled === false);

try {
  manager.installDomainPack({ source: "remote", sourceUrl: "http://example.com/pack.json", manifest: builtins[0], allowUnverified: true });
  check("remote install requires HTTPS", false, "expected install to throw");
} catch (error) {
  check("remote install requires HTTPS", /HTTPS/.test(error?.message || String(error)), error?.message || "");
}

try {
  manager.installDomainPack({ source: "remote", sourceUrl: "https://example.com/pack.json", manifest: badRemote, allowUnverified: true });
  check("remote install rejects local path fields", false, "expected install to throw");
} catch (error) {
  check("remote install rejects local path fields", /sourcePath|local path/.test(error?.message || String(error)), error?.message || "");
}

try {
  manager.installDomainPack({ source: "remote", sourceUrl: "https://example.com/pack.json", manifest: builtins[0] });
  check("remote install reserves hash or signature", false, "expected install to throw");
} catch (error) {
  check("remote install reserves hash or signature", /sha256|signature/.test(error?.message || String(error)), error?.message || "");
}

console.log("\n[domain-packs] project and Job Center integration");
const workspace = path.join(tmp, "workspace with space");
fs.mkdirSync(workspace, { recursive: true });
const projectStore = new IndustrialProjectStore({ workspacePath: workspace });
projectStore.createProject({
  projectId: "domain-pack-demo",
  name: "Domain Pack Demo",
  type: "industrial_workbench",
  domains: ["software", "pcb", "electrical", "qa"],
  requirements: [{ id: "REQ-1", title: "PCB release shall be traceable", domain: "pcb" }],
});
const serviceManager = new DomainPackManager({ safeRoot: path.join(tmp, "service-packs") });
const jobStore = new JobStore({
  storePath: path.join(tmp, "jobs", "job-center.json"),
  allowedArtifactRoots: [tmp],
  idPrefix: "domain-pack-job",
});
const service = createDomainPackService({
  manager: serviceManager,
  getCwd: () => workspace,
  jobStore,
});
const serviceInstall = service.installDomainPack({ id: "pcb-eda", actor: "tester" });
check("service installs pack", serviceInstall.ok === true && serviceInstall.pack.installed === true);
const serviceEnable = service.enableDomainPack("pcb-eda", { actor: "tester" });
check("service enables pack and returns project", serviceEnable.ok === true && serviceEnable.project?.metadata?.domainPacks?.enabled?.includes("pcb-eda"));
const associatedProject = projectStore.getProject();
check("enabled pack adds standards to project", associatedProject.standards.some((standard) => standard.metadata?.domainPackId === "pcb-eda"));
check("enabled pack adds quality gates to project", associatedProject.qualityGates.some((gate) => gate.metadata?.domainPackId === "pcb-eda" && gate.type === "pcb_drc"));
check("enabled pack stores templates and checklists metadata", associatedProject.metadata?.domainPacks?.templates?.some((item) => item.packId === "pcb-eda") && associatedProject.metadata?.domainPacks?.checklists?.some((item) => item.packId === "pcb-eda"));
check("pack operation writes project event", associatedProject.events.some((event) => event.type === "domain-pack.enabled"));
const enableJob = jobStore.getJob(serviceEnable.jobId || "");
check("pack operation writes Job Center event", enableJob?.events.some((event) => event.type === "domain-pack.enabled"));
check("pack operation records manifest and project artifacts", enableJob?.artifacts.some((artifact) => artifact.type === "domain-pack-manifest") && enableJob?.artifacts.some((artifact) => artifact.type === "industrial-project"));
const recommended = service.recommendDomainPacks();
check("service recommends packs from project domains", recommended.ok === true && recommended.packs.some((pack) => pack.manifest.id === "pcb-eda"));
const serviceDisable = service.disableDomainPack("pcb-eda", { actor: "tester" });
check("service disables pack and updates project metadata", serviceDisable.ok === true && !serviceDisable.project?.metadata?.domainPacks?.enabled?.includes("pcb-eda"));

console.log("\n[domain-packs] IPC/API");
const handlers = new Map();
registerDomainPackIpc({
  register: {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  },
  domainPack: service,
});
for (const channel of ["domain-pack:list", "domain-pack:get", "domain-pack:validate", "domain-pack:install", "domain-pack:update", "domain-pack:enable", "domain-pack:disable", "domain-pack:uninstall", "domain-pack:recommend"]) {
  check(`registerDomainPackIpc exposes ${channel}`, handlers.has(channel));
}
const ipcList = await handlers.get("domain-pack:list")({});
check("IPC list returns packs", ipcList.ok === true && ipcList.packs.length >= 10);
const ipcGet = await handlers.get("domain-pack:get")({}, "pcb-eda");
check("IPC get returns selected pack", ipcGet.ok === true && ipcGet.pack.manifest.id === "pcb-eda");
const ipcValidate = await handlers.get("domain-pack:validate")({}, { manifest: builtins[0] });
check("IPC validate returns schema result", ipcValidate.ok === true && ipcValidate.manifest.id === builtins[0].id);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
