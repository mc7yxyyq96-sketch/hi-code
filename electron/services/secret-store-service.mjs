import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  findPlaintextConfigSecrets,
  prepareConfigForSecretPersistence,
  validateSecretRef,
} from "../../dist/secret-references.js";

const VAULT_VERSION = 1;
const MIGRATION_VERSION = 1;
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const MAX_VAULT_BYTES = 8 * 1024 * 1024;

export function createElectronSecretStore({
  safeStorage,
  rootDir,
  configPath,
  platform = process.platform,
  fsImpl = fs,
  now = () => new Date(),
  idFactory = () => `migration-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
  logger = null,
}) {
  if (!safeStorage) throw new Error("secret-store requires Electron safeStorage");
  if (!path.isAbsolute(rootDir || "")) throw new Error("secret-store rootDir must be absolute");
  if (!path.isAbsolute(configPath || "")) throw new Error("secret-store configPath must be absolute");

  const secretDir = path.resolve(rootDir);
  const vaultPath = path.join(secretDir, "vault.json");
  const journalPath = path.join(secretDir, "migration-journal.json");

  const status = () => secureStorageStatus(safeStorage, platform);

  const readVault = () => readVaultFile(fsImpl, vaultPath);
  const writeVault = (vault) => atomicWritePrivate(fsImpl, vaultPath, JSON.stringify(validateVault(vault), null, 2) + "\n");
  const readJournal = () => readJournalFile(fsImpl, journalPath);
  const writeJournal = (journal) => atomicWritePrivate(fsImpl, journalPath, JSON.stringify(validateJournal(journal), null, 2) + "\n");

  function requireSecureStorage() {
    const current = status();
    if (!current.available) {
      const error = new Error(current.reason || "operating-system secure storage is unavailable");
      Object.assign(error, { code: "secure_storage_unavailable", backend: current.backend });
      throw error;
    }
    return current;
  }

  function encrypt(value) {
    requireSecureStorage();
    const encrypted = safeStorage.encryptString(String(value));
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("safeStorage returned an invalid encrypted value");
    return encrypted.toString("base64");
  }

  function decrypt(ciphertext) {
    requireSecureStorage();
    if (typeof ciphertext !== "string" || !ciphertext || ciphertext.length > MAX_VAULT_BYTES) {
      throw new Error("encrypted secret record is invalid");
    }
    try {
      return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
    } catch {
      throw new Error("operating-system secure storage could not decrypt this value");
    }
  }

  function resolve(secretRef) {
    const ref = validateSecretRef(secretRef);
    const record = readVault().entries[ref];
    if (!record) return undefined;
    const value = decrypt(record.ciphertext);
    return value || undefined;
  }

  function has(secretRef) {
    const ref = validateSecretRef(secretRef);
    return Boolean(readVault().entries[ref]);
  }

  function persistSecretWrites(writes) {
    if (!Array.isArray(writes)) throw new Error("secret writes must be an array");
    if (!writes.length) return { ok: true, count: 0, commit() {}, rollback() {} };
    const previousVault = readOptionalFile(fsImpl, vaultPath, MAX_VAULT_BYTES);
    const vault = readVault();
    applySecretWrites(vault, writes, encrypt, now);
    writeVault(vault);
    let active = true;
    log("secret.values.persisted", { secretWriteCount: writes.length });
    return {
      ok: true,
      count: writes.length,
      commit() {
        active = false;
      },
      rollback() {
        if (!active) return;
        restoreOptionalFile(fsImpl, vaultPath, previousVault);
        active = false;
        log("secret.values.rolled_back", { secretWriteCount: writes.length });
      },
    };
  }

  function persistConfig(input) {
    const prepared = prepareConfigForSecretPersistence(input);
    const configText = serializeConfig(prepared.config);
    const previousConfig = readOptionalFile(fsImpl, configPath, MAX_CONFIG_BYTES);
    const previousVault = readOptionalFile(fsImpl, vaultPath, MAX_VAULT_BYTES);

    try {
      if (prepared.writes.length) {
        const vault = readVault();
        applySecretWrites(vault, prepared.writes, encrypt, now);
        writeVault(vault);
      }
      atomicWritePrivate(fsImpl, configPath, configText);
      log("secret.config.persisted", {
        secretWriteCount: prepared.writes.length,
        referenceCount: listSecretReferences(prepared.config).length,
      });
      return {
        ok: true,
        text: configText,
        config: prepared.config,
        secretWriteCount: prepared.writes.length,
        references: listSecretReferences(prepared.config),
      };
    } catch (error) {
      restoreOptionalFile(fsImpl, vaultPath, previousVault);
      restoreOptionalFile(fsImpl, configPath, previousConfig);
      log("secret.config.persist_failed", { code: error?.code || "secret_config_write_failed" });
      throw error;
    }
  }

  function readConfigForRenderer() {
    const raw = readOptionalFile(fsImpl, configPath, MAX_CONFIG_BYTES);
    if (!raw) return "";
    const parsed = parseConfigText(raw.toString("utf8"));
    const prepared = prepareConfigForSecretPersistence(parsed);
    return serializeConfig(prepared.config);
  }

  function migrateLegacyConfig() {
    const original = readOptionalFile(fsImpl, configPath, MAX_CONFIG_BYTES);
    if (!original) return { ok: true, status: "not_needed", findings: [] };
    const originalText = original.toString("utf8");
    const parsed = parseConfigText(originalText);
    const findings = findPlaintextConfigSecrets(parsed);
    const prepared = prepareConfigForSecretPersistence(parsed);
    if (!prepared.changed) return { ok: true, status: "not_needed", findings: [] };

    if (!prepared.writes.length) {
      atomicWritePrivate(fsImpl, configPath, serializeConfig(prepared.config));
      return { ok: true, status: "sanitized", findings: [], migrationId: null };
    }

    requireSecureStorage();
    const migrationId = validateMigrationId(idFactory());
    const previousVault = readOptionalFile(fsImpl, vaultPath, MAX_VAULT_BYTES);
    const previousJournal = readOptionalFile(fsImpl, journalPath, MAX_VAULT_BYTES);
    const vault = readVault();
    const priorEntries = {};
    for (const write of prepared.writes) priorEntries[write.ref] = vault.entries[write.ref] || null;
    const snapshot = {
      version: MIGRATION_VERSION,
      configText: originalText,
      priorEntries,
    };
    const createdAt = now().toISOString();
    vault.migrations[migrationId] = {
      ciphertext: encrypt(JSON.stringify(snapshot)),
      createdAt,
      status: "completed",
    };
    applySecretWrites(vault, prepared.writes, encrypt, now);
    const migratedText = serializeConfig(prepared.config);
    const journal = readJournal();
    journal.records.push({
      id: migrationId,
      version: MIGRATION_VERSION,
      status: "completed",
      createdAt,
      findingCount: findings.length,
      refs: prepared.writes.map((write) => write.ref),
      originalSha256: sha256(originalText),
      migratedSha256: sha256(migratedText),
    });

    try {
      writeVault(vault);
      atomicWritePrivate(fsImpl, configPath, migratedText);
      writeJournal(journal);
      log("secret.migration.completed", { migrationId, findingCount: findings.length, refCount: prepared.writes.length });
      return { ok: true, status: "migrated", migrationId, findings };
    } catch (error) {
      restoreOptionalFile(fsImpl, journalPath, previousJournal);
      restoreOptionalFile(fsImpl, configPath, original);
      restoreOptionalFile(fsImpl, vaultPath, previousVault);
      log("secret.migration.failed", { migrationId, code: error?.code || "secret_migration_failed" });
      throw error;
    }
  }

  function rollbackMigration(migrationId) {
    requireSecureStorage();
    const id = validateMigrationId(migrationId);
    const previousConfig = readOptionalFile(fsImpl, configPath, MAX_CONFIG_BYTES);
    const previousVault = readOptionalFile(fsImpl, vaultPath, MAX_VAULT_BYTES);
    const previousJournal = readOptionalFile(fsImpl, journalPath, MAX_VAULT_BYTES);
    const vault = readVault();
    const record = vault.migrations[id];
    if (!record) throw new Error("migration snapshot not found");
    if (record.status !== "completed") throw new Error(`migration is already ${record.status}`);
    const snapshot = validateMigrationSnapshot(JSON.parse(decrypt(record.ciphertext)));
    const journal = readJournal();
    const journalRecord = journal.records.find((item) => item.id === id);
    if (!journalRecord || journalRecord.status !== "completed") throw new Error("migration journal is missing or not completed");

    for (const [ref, prior] of Object.entries(snapshot.priorEntries)) {
      validateSecretRef(ref);
      if (prior === null) delete vault.entries[ref];
      else vault.entries[ref] = validateVaultEntry(prior);
    }
    const rolledBackAt = now().toISOString();
    record.status = "rolled_back";
    record.rolledBackAt = rolledBackAt;
    journalRecord.status = "rolled_back";
    journalRecord.rolledBackAt = rolledBackAt;

    try {
      writeVault(vault);
      atomicWritePrivate(fsImpl, configPath, snapshot.configText);
      writeJournal(journal);
      log("secret.migration.rolled_back", { migrationId: id });
      return { ok: true, status: "rolled_back", migrationId: id };
    } catch (error) {
      restoreOptionalFile(fsImpl, journalPath, previousJournal);
      restoreOptionalFile(fsImpl, configPath, previousConfig);
      restoreOptionalFile(fsImpl, vaultPath, previousVault);
      log("secret.migration.rollback_failed", { migrationId: id, code: error?.code || "secret_rollback_failed" });
      throw error;
    }
  }

  function configCredentialStatus() {
    const text = readConfigForRenderer();
    if (!text) return { ok: true, secureStorage: status(), references: [] };
    const parsed = parseConfigText(text);
    const vault = readVault();
    return {
      ok: true,
      secureStorage: status(),
      references: listSecretReferences(parsed).map((item) => ({
        ...item,
        configured: Boolean(vault.entries[item.secretRef]),
      })),
    };
  }

  function log(event, details) {
    if (typeof logger === "function") logger(event, details);
  }

  return {
    status,
    resolve,
    has,
    persistSecretWrites,
    persistConfig,
    readConfigForRenderer,
    migrateLegacyConfig,
    rollbackMigration,
    configCredentialStatus,
    paths: Object.freeze({ secretDir, vaultPath, journalPath, configPath }),
  };
}

export function secureStorageStatus(safeStorage, platform = process.platform) {
  let available = false;
  try {
    available = safeStorage.isEncryptionAvailable() === true;
  } catch {
    available = false;
  }
  let backend = "unknown";
  if (platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function") {
    try {
      backend = String(safeStorage.getSelectedStorageBackend() || "unknown");
    } catch {
      backend = "unknown";
    }
  } else if (platform === "darwin") backend = "keychain";
  else if (platform === "win32") backend = "dpapi";

  if (!available) return { available: false, backend, reason: "operating-system secure storage is unavailable" };
  if (platform === "linux" && backend === "basic_text") {
    return { available: false, backend, reason: "Electron basic_text is not accepted for credential storage" };
  }
  return { available: true, backend, reason: "" };
}

function applySecretWrites(vault, writes, encrypt, now) {
  for (const write of writes) {
    const ref = validateSecretRef(write.ref, write.scope);
    if (typeof write.value !== "string" || !write.value) throw new Error(`secret write ${write.location} is empty`);
    const previous = vault.entries[ref];
    const timestamp = now().toISOString();
    vault.entries[ref] = {
      ciphertext: encrypt(write.value),
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp,
    };
  }
}

function listSecretReferences(config) {
  const references = [];
  if (typeof config?.secretRef === "string") references.push({ location: "secretRef", secretRef: validateSecretRef(config.secretRef, "model"), scope: "model" });
  if (config?.profiles && typeof config.profiles === "object" && !Array.isArray(config.profiles)) {
    for (const [profileKey, profile] of Object.entries(config.profiles)) {
      if (profile && typeof profile === "object" && !Array.isArray(profile) && typeof profile.secretRef === "string") {
        references.push({ location: `profiles.${profileKey}.secretRef`, secretRef: validateSecretRef(profile.secretRef, "model"), scope: "model" });
      }
    }
  }
  if (config?.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)) {
    for (const [serverName, server] of Object.entries(config.mcpServers)) {
      if (!server || typeof server !== "object" || Array.isArray(server) || !server.env || typeof server.env !== "object" || Array.isArray(server.env)) continue;
      for (const [envName, value] of Object.entries(server.env)) {
        if (value && typeof value === "object" && !Array.isArray(value) && typeof value.secretRef === "string") {
          references.push({ location: `mcpServers.${serverName}.env.${envName}`, secretRef: validateSecretRef(value.secretRef, "mcp"), scope: "mcp" });
        }
      }
    }
  }
  return references;
}

function serializeConfig(config) {
  const text = JSON.stringify(config, null, 2) + "\n";
  if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) throw new Error("config exceeds the size limit");
  return text;
}

function parseConfigText(text) {
  if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) throw new Error("config exceeds the size limit");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("config must be a JSON object");
  return parsed;
}

function readVaultFile(fsImpl, file) {
  const raw = readOptionalFile(fsImpl, file, MAX_VAULT_BYTES);
  if (!raw) return { version: VAULT_VERSION, entries: {}, migrations: {} };
  return validateVault(JSON.parse(raw.toString("utf8")));
}

function validateVault(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== VAULT_VERSION) throw new Error("secret vault schema is invalid");
  if (!value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) throw new Error("secret vault entries are invalid");
  if (!value.migrations || typeof value.migrations !== "object" || Array.isArray(value.migrations)) throw new Error("secret vault migrations are invalid");
  for (const [ref, entry] of Object.entries(value.entries)) {
    validateSecretRef(ref);
    value.entries[ref] = validateVaultEntry(entry);
  }
  for (const [id, migration] of Object.entries(value.migrations)) {
    validateMigrationId(id);
    if (!migration || typeof migration !== "object" || Array.isArray(migration) || typeof migration.ciphertext !== "string") throw new Error("secret migration record is invalid");
    if (!['completed', 'rolled_back'].includes(migration.status)) throw new Error("secret migration status is invalid");
  }
  return value;
}

function validateVaultEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("secret vault entry is invalid");
  if (typeof entry.ciphertext !== "string" || !entry.ciphertext) throw new Error("secret vault ciphertext is invalid");
  if (typeof entry.createdAt !== "string" || typeof entry.updatedAt !== "string") throw new Error("secret vault timestamps are invalid");
  return { ciphertext: entry.ciphertext, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
}

function readJournalFile(fsImpl, file) {
  const raw = readOptionalFile(fsImpl, file, MAX_VAULT_BYTES);
  if (!raw) return { version: MIGRATION_VERSION, records: [] };
  return validateJournal(JSON.parse(raw.toString("utf8")));
}

function validateJournal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== MIGRATION_VERSION || !Array.isArray(value.records)) {
    throw new Error("secret migration journal schema is invalid");
  }
  for (const record of value.records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("secret migration journal record is invalid");
    validateMigrationId(record.id);
    if (!['completed', 'rolled_back'].includes(record.status)) throw new Error("secret migration journal status is invalid");
    if (!Array.isArray(record.refs)) throw new Error("secret migration journal refs are invalid");
    record.refs.forEach((ref) => validateSecretRef(ref));
  }
  return value;
}

function validateMigrationSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== MIGRATION_VERSION) throw new Error("migration snapshot is invalid");
  if (typeof value.configText !== "string" || Buffer.byteLength(value.configText, "utf8") > MAX_CONFIG_BYTES) throw new Error("migration config snapshot is invalid");
  if (!value.priorEntries || typeof value.priorEntries !== "object" || Array.isArray(value.priorEntries)) throw new Error("migration entry snapshot is invalid");
  return value;
}

function validateMigrationId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id)) throw new Error("migration id is invalid");
  return id;
}

function readOptionalFile(fsImpl, file, maxBytes) {
  try {
    const stat = fsImpl.statSync(file);
    if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a file`);
    if (stat.size > maxBytes) throw new Error(`${path.basename(file)} exceeds the size limit`);
    return fsImpl.readFileSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function restoreOptionalFile(fsImpl, file, data) {
  if (data === null) {
    try { fsImpl.rmSync(file, { force: true }); } catch {}
    return;
  }
  atomicWritePrivate(fsImpl, file, data);
}

function atomicWritePrivate(fsImpl, file, data) {
  const directory = path.dirname(file);
  fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fsImpl.chmodSync(directory, 0o700); } catch {}
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fsImpl.openSync(temporary, "wx", 0o600);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    fsImpl.writeFileSync(fd, buffer);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = undefined;
    fsImpl.renameSync(temporary, file);
    try { fsImpl.chmodSync(file, 0o600); } catch {}
  } catch (error) {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch {}
    }
    try { fsImpl.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
