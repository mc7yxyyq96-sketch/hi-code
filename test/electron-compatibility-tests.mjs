import assert from "node:assert/strict";
import {
  APPROVED_NATIVE_PRODUCTION_DEPENDENCIES,
  collectNativeProductionDependencies,
  ELECTRON_COMPATIBILITY_TARGET,
  inspectElectronCompatibility,
} from "../scripts/electron-compatibility.mjs";

let pass = 0;

function check(name, action) {
  action();
  console.log(`  ✓ ${name}`);
  pass++;
}

console.log("\n[electron-compatibility] contract tests");

check("native inventory includes production build dependencies", () => {
  const native = collectNativeProductionDependencies({
    packages: {
      "": {},
      "node_modules/native-addon": { version: "1.2.3", hasInstallScript: true },
      "node_modules/pure-js": { version: "2.0.0" },
    },
  });
  assert.deepEqual(native, [{
    name: "native-addon",
    version: "1.2.3",
    lockPath: "node_modules/native-addon",
    signals: ["install-script"],
  }]);
});

check("native inventory excludes development-only build dependencies", () => {
  const native = collectNativeProductionDependencies({
    packages: {
      "": {},
      "node_modules/dev-native": { version: "4.0.0", dev: true, gypfile: true, hasInstallScript: true },
    },
  });
  assert.deepEqual(native, []);
});

check("target records the supported stable major", () => {
  assert.equal(ELECTRON_COMPATIBILITY_TARGET.electron, "43.1.0");
  assert.ok(ELECTRON_COMPATIBILITY_TARGET.supportedStableMajorsAtDecision.includes(43));
});

const report = inspectElectronCompatibility(process.cwd());
for (const entry of report.checks) {
  check(entry.id, () => assert.equal(entry.passed, true, entry.detail));
}
check("current production graph contains only the reviewed PTY native module", () => {
  assert.deepEqual(
    report.nativeProductionDependencies.map(({ name, version, signals }) => ({ name, version, signals })),
    APPROVED_NATIVE_PRODUCTION_DEPENDENCIES,
  );
});
check("complete compatibility report passes", () => {
  assert.equal(report.allPassed, true);
});

console.log(`\n=== ${pass} passed, 0 failed ===`);
