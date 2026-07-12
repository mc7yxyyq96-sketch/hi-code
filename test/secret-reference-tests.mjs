import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConfig, saveModelToConfig } from "../dist/config.js";
import {
  findPlaintextConfigSecrets,
  isSensitiveEnvName,
  mcpEnvSecretRef,
  mcpSecretEnvName,
  modelSecretRef,
  prepareConfigForSecretPersistence,
  profileApiKeyEnvName,
  providerSecretRef,
  validateSecretRef,
} from "../dist/secret-references.js";

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode secret refs 中文 path "));
const configPath = path.join(tmp, "config.json");

try {
  const defaultRef = modelSecretRef("default");
  const coderRef = modelSecretRef("coder one");
  const mcpRef = mcpEnvSecretRef("brave-search", "BRAVE_API_KEY");
  const providerRef = providerSecretRef("local-model", "apiKey");

  check("model and MCP references are versioned and scope validated", () => {
    assert.equal(validateSecretRef(defaultRef, "model"), defaultRef);
    assert.equal(validateSecretRef(mcpRef, "mcp"), mcpRef);
    assert.equal(validateSecretRef(providerRef, "provider"), providerRef);
    assert.throws(() => validateSecretRef("file:///tmp/key"), /unsupported|malformed/);
    assert.throws(() => validateSecretRef(defaultRef, "mcp"), /mcp scope/);
    assert.throws(() => validateSecretRef(`${defaultRef}:extra`, "model"), /too many segments/);
  });

  check("CLI fallback environment names are deterministic and bounded", () => {
    assert.equal(profileApiKeyEnvName("coder one"), "HICODE_PROFILE_CODER_ONE_API_KEY");
    assert.equal(mcpSecretEnvName("brave-search", "BRAVE_API_KEY"), "HICODE_MCP_BRAVE_SEARCH_BRAVE_API_KEY");
  });

  check("sensitive environment names include keys, tokens, secrets, and passwords", () => {
    assert.equal(isSensitiveEnvName("BRAVE_API_KEY"), true);
    assert.equal(isSensitiveEnvName("ACCESS_TOKEN"), true);
    assert.equal(isSensitiveEnvName("CLIENT_SECRET"), true);
    assert.equal(isSensitiveEnvName("DATABASE_PASSWORD"), true);
    assert.equal(isSensitiveEnvName("LOG_LEVEL"), false);
  });

  const prepared = prepareConfigForSecretPersistence({
    defaultProfile: "default",
    profiles: {
      default: {
        name: "default",
        baseURL: "https://api.example.test/v1",
        apiKey: "sk-cloud-secret",
        model: "example-model",
      },
      local: {
        name: "local",
        baseURL: "http://127.0.0.1:11434",
        apiKey: "sk-no-key-required",
        model: "local-model",
      },
    },
    mcpServers: {
      brave: {
        command: "node",
        args: ["server.mjs"],
        env: {
          BRAVE_API_KEY: "brave-secret",
          LOG_LEVEL: "info",
        },
      },
    },
  });

  check("persistence preparation removes model plaintext and local sentinels", () => {
    const profiles = prepared.config.profiles;
    assert.equal(profiles.default.apiKey, undefined);
    assert.equal(profiles.default.secretRef, defaultRef);
    assert.equal(profiles.local.apiKey, undefined);
    assert.equal(profiles.local.secretRef, undefined);
  });

  check("persistence preparation externalizes sensitive MCP values only", () => {
    const env = prepared.config.mcpServers.brave.env;
    assert.deepEqual(env.BRAVE_API_KEY, { secretRef: mcpEnvSecretRef("brave", "BRAVE_API_KEY") });
    assert.equal(env.LOG_LEVEL, "info");
    assert.equal(prepared.writes.length, 2);
    assert.equal(findPlaintextConfigSecrets(prepared.config).length, 0);
    assert.equal(JSON.stringify(prepared.config).includes("sk-cloud-secret"), false);
    assert.equal(JSON.stringify(prepared.config).includes("brave-secret"), false);
  });

  check("credential placeholders remain editable but are not treated as secrets", () => {
    const placeholder = prepareConfigForSecretPersistence({
      mcpServers: { demo: { command: "demo", env: { DEMO_API_KEY: "填入你的 API Key" } } },
    });
    assert.equal(placeholder.config.mcpServers.demo.env.DEMO_API_KEY, "填入你的 API Key");
    assert.equal(placeholder.writes.length, 0);
    assert.deepEqual(findPlaintextConfigSecrets(placeholder.config), []);
  });

  check("conflicting values cannot target the same secret reference", () => {
    assert.throws(() => prepareConfigForSecretPersistence({
      defaultProfile: "default",
      apiKey: "first-secret",
      profiles: { default: { apiKey: "second-secret" } },
    }), /conflicting secret values/);
  });

  fs.writeFileSync(configPath, JSON.stringify({
    defaultProfile: "default",
    profiles: {
      default: { baseURL: "https://api.example.test/v1", secretRef: defaultRef, model: "cloud" },
      "coder one": { baseURL: "https://coder.example.test/v1", secretRef: coderRef, model: "coder" },
      local: { baseURL: "http://127.0.0.1:11434", model: "local", protocol: "ollama_chat" },
    },
    mcpServers: {
      brave: {
        command: "node",
        env: { BRAVE_API_KEY: { secretRef: mcpEnvSecretRef("brave", "BRAVE_API_KEY") } },
      },
    },
  }, null, 2));

  check("desktop resolver hydrates runtime-only model and MCP credentials", () => {
    const secrets = new Map([
      [defaultRef, "desktop-default-secret"],
      [coderRef, "desktop-coder-secret"],
      [mcpEnvSecretRef("brave", "BRAVE_API_KEY"), "desktop-brave-secret"],
    ]);
    const cfg = loadConfig({ configPath, env: {}, resolveSecret: (ref) => secrets.get(ref) });
    assert.equal(cfg.profiles.default.apiKey, "desktop-default-secret");
    assert.equal(cfg.profiles["coder one"].apiKey, "desktop-coder-secret");
    assert.equal(cfg.profiles.local.apiKey, "sk-no-key-required");
    assert.equal(cfg.mcpServers.brave.env.BRAVE_API_KEY, "desktop-brave-secret");
  });

  check("CLI profile-specific environment fallback needs no Electron resolver", () => {
    const cfg = loadConfig({
      configPath,
      env: {
        HICODE_API_KEY: "cli-default-secret",
        HICODE_PROFILE_CODER_ONE_API_KEY: "cli-coder-secret",
        HICODE_MCP_BRAVE_BRAVE_API_KEY: "cli-brave-secret",
      },
    });
    assert.equal(cfg.profiles.default.apiKey, "cli-default-secret");
    assert.equal(cfg.profiles["coder one"].apiKey, "cli-coder-secret");
    assert.equal(cfg.mcpServers.brave.env.BRAVE_API_KEY, "cli-brave-secret");
  });

  check("unresolved cloud references fail closed as empty runtime credentials", () => {
    const errors = [];
    const cfg = loadConfig({
      configPath,
      env: {},
      resolveSecret: () => { throw new Error("locked keychain"); },
      onSecretResolutionError: (details) => errors.push(details),
    });
    assert.equal(cfg.profiles.default.apiKey, "");
    assert.equal(cfg.mcpServers.brave.env, undefined);
    assert.ok(errors.every((entry) => !JSON.stringify(entry).includes("desktop-default-secret")));
    assert.equal(errors.length, 3);
  });

  check("legacy plaintext remains readable only for pre-migration compatibility", () => {
    fs.writeFileSync(configPath, JSON.stringify({
      baseURL: "https://legacy.example.test/v1",
      apiKey: "legacy-secret",
      model: "legacy",
    }));
    const cfg = loadConfig({ configPath, env: {} });
    assert.equal(cfg.profiles.default.apiKey, "legacy-secret");
    const desktopCfg = loadConfig({ configPath, env: {}, allowLegacyPlaintext: false });
    assert.equal(desktopCfg.profiles.default.apiKey, "");
  });

  check("CLI model selection never rewrites a plaintext credential", () => {
    fs.writeFileSync(configPath, JSON.stringify({
      defaultProfile: "default",
      profiles: { default: { baseURL: "https://api.example.test", model: "old", secretRef: defaultRef } },
    }, null, 2));
    saveModelToConfig(configPath, "new-model");
    const secureText = fs.readFileSync(configPath, "utf8");
    assert.equal(JSON.parse(secureText).profiles.default.model, "new-model");
    assert.equal(JSON.parse(secureText).profiles.default.secretRef, defaultRef);

    const legacyText = JSON.stringify({ apiKey: "must-not-be-rewritten", model: "old" }, null, 2);
    fs.writeFileSync(configPath, legacyText);
    assert.throws(() => saveModelToConfig(configPath, "new-model"), /refusing to rewrite plaintext credentials/);
    assert.equal(fs.readFileSync(configPath, "utf8"), legacyText);
  });

  check("malformed persisted references are rejected instead of treated as values", () => {
    fs.writeFileSync(configPath, JSON.stringify({
      profiles: { default: { baseURL: "https://api.example.test", model: "x", secretRef: "../../secret" } },
    }));
    assert.throws(() => loadConfig({ configPath, env: {} }), /secretRef/);
  });

  console.log(`\n${pass} secret reference checks passed.`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
