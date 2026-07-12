import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createElectronSecretStore,
  secureStorageStatus,
} from "../electron/services/secret-store-service.mjs";
import { mcpEnvSecretRef, modelSecretRef } from "../dist/secret-references.js";

let pass = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

function fakeSafeStorage({ available = true, backend = "gnome_libsecret" } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString(value) {
      const bytes = Buffer.from(value, "utf8");
      return Buffer.from([...bytes].map((byte, index) => byte ^ ((index * 31 + 173) & 0xff)));
    },
    decryptString(value) {
      const bytes = Buffer.from(value);
      return Buffer.from([...bytes].map((byte, index) => byte ^ ((index * 31 + 173) & 0xff))).toString("utf8");
    },
  };
}

function makeStore(root, options = {}) {
  return createElectronSecretStore({
    safeStorage: options.safeStorage || fakeSafeStorage(),
    rootDir: path.join(root, "secrets"),
    configPath: path.join(root, "config.json"),
    platform: options.platform || "linux",
    fsImpl: options.fsImpl || fs,
    now: options.now || (() => new Date("2026-07-12T12:00:00.000Z")),
    idFactory: options.idFactory || (() => "migration-test-1"),
    logger: options.logger,
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode safe storage 中文 path "));

try {
  check("secure storage rejects unavailable and Linux basic_text backends", () => {
    assert.equal(secureStorageStatus(fakeSafeStorage({ available: false }), "linux").available, false);
    assert.deepEqual(secureStorageStatus(fakeSafeStorage({ backend: "basic_text" }), "linux"), {
      available: false,
      backend: "basic_text",
      reason: "Electron basic_text is not accepted for credential storage",
    });
    assert.equal(secureStorageStatus(fakeSafeStorage(), "linux").available, true);
  });

  const logs = [];
  const root = path.join(tmp, "normal");
  fs.mkdirSync(root, { recursive: true });
  const store = makeStore(root, { logger: (event, details) => logs.push({ event, details }) });
  const persisted = store.persistConfig({
    defaultProfile: "default",
    profiles: {
      default: {
        baseURL: "https://api.example.test/v1",
        apiKey: "model-secret-one",
        model: "example",
      },
    },
    mcpServers: {
      brave: {
        command: "node",
        env: { BRAVE_API_KEY: "mcp-secret-one", LOG_LEVEL: "debug" },
      },
    },
  });

  check("config persistence replaces plaintext with secretRef records", () => {
    const configText = fs.readFileSync(store.paths.configPath, "utf8");
    const config = JSON.parse(configText);
    assert.equal(config.profiles.default.apiKey, undefined);
    assert.equal(config.profiles.default.secretRef, modelSecretRef("default"));
    assert.deepEqual(config.mcpServers.brave.env.BRAVE_API_KEY, { secretRef: mcpEnvSecretRef("brave", "BRAVE_API_KEY") });
    assert.equal(config.mcpServers.brave.env.LOG_LEVEL, "debug");
    assert.equal(configText.includes("model-secret-one"), false);
    assert.equal(configText.includes("mcp-secret-one"), false);
    assert.equal(persisted.secretWriteCount, 2);
  });

  check("encrypted vault resolves values without containing plaintext", () => {
    const vaultText = fs.readFileSync(store.paths.vaultPath, "utf8");
    assert.equal(vaultText.includes("model-secret-one"), false);
    assert.equal(vaultText.includes("mcp-secret-one"), false);
    assert.equal(store.resolve(modelSecretRef("default")), "model-secret-one");
    assert.equal(store.resolve(mcpEnvSecretRef("brave", "BRAVE_API_KEY")), "mcp-secret-one");
    assert.equal(fs.statSync(store.paths.vaultPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(store.paths.secretDir).mode & 0o777, 0o700);
  });

  check("credential status exposes references and booleans but no values", () => {
    const status = store.configCredentialStatus();
    assert.equal(status.references.length, 2);
    assert.ok(status.references.every((item) => item.configured === true));
    assert.equal(JSON.stringify(status).includes("model-secret-one"), false);
    assert.equal(JSON.stringify(status).includes("mcp-secret-one"), false);
  });

  check("rotating a credential preserves its reference and replaces encrypted content", () => {
    const config = JSON.parse(store.readConfigForRenderer());
    config.profiles.default.apiKey = "model-secret-two";
    store.persistConfig(config);
    assert.equal(store.resolve(modelSecretRef("default")), "model-secret-two");
    assert.equal(fs.readFileSync(store.paths.configPath, "utf8").includes("model-secret-two"), false);
  });

  check("logs contain counts and references only, never plaintext or ciphertext", () => {
    const text = JSON.stringify(logs);
    assert.equal(text.includes("model-secret-one"), false);
    assert.equal(text.includes("model-secret-two"), false);
    assert.equal(text.includes("mcp-secret-one"), false);
    assert.ok(logs.some((entry) => entry.event === "secret.config.persisted"));
  });

  const migrationRoot = path.join(tmp, "migration");
  fs.mkdirSync(migrationRoot, { recursive: true });
  const migrationStore = makeStore(migrationRoot);
  const legacyText = JSON.stringify({
    defaultProfile: "default",
    profiles: {
      default: { baseURL: "https://legacy.example.test/v1", apiKey: "legacy-model-secret", model: "legacy" },
    },
    mcpServers: {
      demo: { command: "node", env: { SERVICE_TOKEN: "legacy-mcp-token" } },
    },
  }, null, 2);
  fs.writeFileSync(migrationStore.paths.configPath, legacyText, { mode: 0o600 });
  const migrated = migrationStore.migrateLegacyConfig();

  check("legacy migration is atomic, encrypted, and journaled without secrets", () => {
    assert.equal(migrated.status, "migrated");
    assert.equal(migrated.findings.length, 2);
    const configText = fs.readFileSync(migrationStore.paths.configPath, "utf8");
    const vaultText = fs.readFileSync(migrationStore.paths.vaultPath, "utf8");
    const journalText = fs.readFileSync(migrationStore.paths.journalPath, "utf8");
    for (const secret of ["legacy-model-secret", "legacy-mcp-token"]) {
      assert.equal(configText.includes(secret), false);
      assert.equal(vaultText.includes(secret), false);
      assert.equal(journalText.includes(secret), false);
    }
    assert.equal(migrationStore.resolve(modelSecretRef("default")), "legacy-model-secret");
    assert.equal(migrationStore.resolve(mcpEnvSecretRef("demo", "SERVICE_TOKEN")), "legacy-mcp-token");
    assert.equal(JSON.parse(journalText).records[0].status, "completed");
  });

  check("migration rollback restores exact config bytes and prior secret entries", () => {
    const result = migrationStore.rollbackMigration(migrated.migrationId);
    assert.equal(result.status, "rolled_back");
    assert.equal(fs.readFileSync(migrationStore.paths.configPath, "utf8"), legacyText);
    assert.equal(migrationStore.has(modelSecretRef("default")), false);
    assert.equal(migrationStore.has(mcpEnvSecretRef("demo", "SERVICE_TOKEN")), false);
    assert.equal(JSON.parse(fs.readFileSync(migrationStore.paths.journalPath, "utf8")).records[0].status, "rolled_back");
    assert.throws(() => migrationStore.rollbackMigration(migrated.migrationId), /already rolled_back/);
  });

  check("unavailable storage leaves legacy bytes unchanged and renderer reads stay redacted", () => {
    const unavailableRoot = path.join(tmp, "unavailable");
    fs.mkdirSync(unavailableRoot, { recursive: true });
    const unavailable = makeStore(unavailableRoot, { safeStorage: fakeSafeStorage({ backend: "basic_text" }) });
    const original = JSON.stringify({ apiKey: "must-not-reach-renderer", baseURL: "https://api.example.test", model: "x" });
    fs.writeFileSync(unavailable.paths.configPath, original);
    assert.throws(() => unavailable.migrateLegacyConfig(), /basic_text/);
    assert.equal(fs.readFileSync(unavailable.paths.configPath, "utf8"), original);
    assert.equal(unavailable.readConfigForRenderer().includes("must-not-reach-renderer"), false);
  });

  check("config write failure restores both original config and vault", () => {
    const failureRoot = path.join(tmp, "failure");
    fs.mkdirSync(failureRoot, { recursive: true });
    const configPath = path.join(failureRoot, "config.json");
    const original = JSON.stringify({ model: "before" });
    fs.writeFileSync(configPath, original);
    let failConfigRename = true;
    const fsImpl = new Proxy(fs, {
      get(target, property) {
        if (property === "renameSync") {
          return (from, to) => {
            if (to === configPath && failConfigRename) {
              failConfigRename = false;
              const error = new Error("injected config rename failure");
              error.code = "EIO";
              throw error;
            }
            return target.renameSync(from, to);
          };
        }
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failingStore = makeStore(failureRoot, { fsImpl });
    assert.throws(() => failingStore.persistConfig({
      profiles: { default: { baseURL: "https://api.example.test", model: "after", apiKey: "transaction-secret" } },
    }), /injected config rename failure/);
    assert.equal(fs.readFileSync(configPath, "utf8"), original);
    assert.equal(fs.existsSync(failingStore.paths.vaultPath), false);
  });

  check("corrupt vault data fails closed", () => {
    const corruptRoot = path.join(tmp, "corrupt");
    const corrupt = makeStore(corruptRoot);
    fs.mkdirSync(corrupt.paths.secretDir, { recursive: true });
    fs.writeFileSync(corrupt.paths.vaultPath, JSON.stringify({ version: 1, entries: { bad: {} }, migrations: {} }));
    assert.throws(() => corrupt.resolve(modelSecretRef("default")), /secretRef|vault/);
  });

  console.log(`\n${pass} Electron secret store checks passed.`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
