#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const versionPath = path.join(root, "VERSION");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = String(pkg.version || "").trim();
const failures = [];

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  failures.push(`package.json version is not semver-like: ${version || "(empty)"}`);
}

const versionFile = fs.existsSync(versionPath) ? fs.readFileSync(versionPath, "utf8").trim() : "";
if (versionFile !== version) {
  fs.writeFileSync(versionPath, `${version}\n`);
}

const main = read("electron/main.mjs");
const appInfo = read("electron/services/app-info-service.mjs");
const html = read("renderer/index.html");
const bootstrap = read("renderer/app/bootstrap.js");

expect(main.includes("version: app.getVersion()"), "main ready event must send app.getVersion()");
expect(main.includes("getVersion: () => app.getVersion()"), "app info service must read Electron app.getVersion()");
expect(appInfo.includes("version: getVersion()"), "app info payload must expose getVersion()");
expect(html.includes('id="appVersion"') && html.includes('id="aboutVersion"'), "renderer must contain version targets");
expect(bootstrap.includes("appVersionEl.textContent") && bootstrap.includes("aboutVersion.textContent"), "renderer must update visible version labels");
expect(JSON.stringify(pkg.build?.files || []).includes("package.json"), "packaged app must include package.json for Electron app metadata");

if (failures.length) {
  console.error("[version] sync check failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[version] ${version} synchronized across package metadata, Electron app info, and renderer labels`);

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}
