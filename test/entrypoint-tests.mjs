import fs from "node:fs";
import path from "node:path";

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

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const handoff = fs.readFileSync(path.join(root, "docs", "HANDOFF-v0.5.0.md"), "utf8");
const baseline = fs.readFileSync(path.join(root, "docs", "engineering-baseline.md"), "utf8");

console.log("\n[entrypoints] production entrypoint guard");
check("package main points to electron/main.mjs", pkg.main === "electron/main.mjs", pkg.main);
check("electron main exists", fs.existsSync(path.join(root, "electron", "main.mjs")));
check("preload exists", fs.existsSync(path.join(root, "electron", "preload.cjs")));
check("renderer html exists", fs.existsSync(path.join(root, "renderer", "index.html")));
check("renderer js exists", fs.existsSync(path.join(root, "renderer", "renderer.js")));
check("root main.mjs moved out of active root", !fs.existsSync(path.join(root, "main.mjs")));
check("root renderer.js moved out of active root", !fs.existsSync(path.join(root, "renderer.js")));
check("root index.html moved out of active root", !fs.existsSync(path.join(root, "index.html")));
check("legacy v0.4 folder keeps old entrypoints", fs.existsSync(path.join(root, "legacy", "v0.4", "main.mjs")));
check("README documents true Electron main", readme.includes("electron/main.mjs"));
check("handoff documents true renderer entry", handoff.includes("renderer/index.html"));
check("engineering baseline forbids root legacy entrypoints", baseline.includes("Do not edit or reintroduce root-level `main.mjs`, `renderer.js`, or `index.html`"));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
