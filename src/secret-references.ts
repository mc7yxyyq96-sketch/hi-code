export const SECRET_REFERENCE_PREFIX = "hicode-secret:v1";

export type SecretReferenceScope = "model" | "mcp" | "provider";

export interface SecretReferenceRecord {
  secretRef: string;
}

export interface SecretWrite {
  ref: string;
  value: string;
  location: string;
  scope: SecretReferenceScope;
}

export interface PreparedSecretConfig {
  config: Record<string, unknown>;
  writes: SecretWrite[];
  changed: boolean;
}

export interface EncryptedSecretVaultEntry {
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedSecretMigrationRecord {
  ciphertext: string;
  createdAt: string;
  status: "completed" | "rolled_back";
  rolledBackAt?: string;
}

export interface EncryptedSecretVault {
  version: 1;
  entries: Record<string, EncryptedSecretVaultEntry>;
  migrations: Record<string, EncryptedSecretMigrationRecord>;
}

export interface SecretMigrationJournalRecord {
  id: string;
  version: 1;
  status: "completed" | "rolled_back";
  createdAt: string;
  rolledBackAt?: string;
  findingCount: number;
  refs: string[];
  originalSha256: string;
  migratedSha256: string;
}

const SECRET_REFERENCE_PATTERN = /^hicode-secret:v1:(model|mcp|provider):([A-Za-z0-9_-]{1,342})(?::([A-Za-z0-9_-]{1,342}))?$/;
const SENSITIVE_ENV_PATTERN = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSCODE|PRIVATE_?KEY|CLIENT_?SECRET)(?:$|_)/i;
const MAX_SECRET_VALUE_LENGTH = 128 * 1024;

export function modelSecretRef(profileKey: string): string {
  return `${SECRET_REFERENCE_PREFIX}:model:${encodeSegment(profileKey, "profile key")}`;
}

export function mcpEnvSecretRef(serverName: string, envName: string): string {
  return `${SECRET_REFERENCE_PREFIX}:mcp:${encodeSegment(serverName, "MCP server name")}:${encodeSegment(envName, "MCP environment name")}`;
}

export function providerSecretRef(providerId: string, fieldName: string): string {
  return `${SECRET_REFERENCE_PREFIX}:provider:${encodeSegment(providerId, "provider id")}:${encodeSegment(fieldName, "provider secret field")}`;
}

export function validateSecretRef(value: unknown, expectedScope?: SecretReferenceScope): string {
  if (typeof value !== "string" || value.length > 1024 || /[\0\r\n]/.test(value)) {
    throw new Error("secretRef must be a bounded string");
  }
  const match = SECRET_REFERENCE_PATTERN.exec(value);
  if (!match) throw new Error("secretRef uses an unsupported or malformed scheme");
  if (expectedScope && match[1] !== expectedScope) throw new Error(`secretRef must use the ${expectedScope} scope`);
  if (match[1] === "model" && match[3]) throw new Error("model secretRef has too many segments");
  if ((match[1] === "mcp" || match[1] === "provider") && !match[3]) throw new Error(`${match[1]} secretRef is missing a field segment`);
  decodeSegment(match[2], "secretRef segment");
  if (match[3]) decodeSegment(match[3], "secretRef segment");
  return value;
}

export function isSecretReferenceRecord(value: unknown): value is SecretReferenceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "secretRef") return false;
  try {
    validateSecretRef((value as SecretReferenceRecord).secretRef);
    return true;
  } catch {
    return false;
  }
}

export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_PATTERN.test(String(name || ""));
}

export function profileApiKeyEnvName(profileKey: string): string {
  const normalized = String(profileKey || "default")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 80) || "DEFAULT";
  return `HICODE_PROFILE_${normalized}_API_KEY`;
}

export function mcpSecretEnvName(serverName: string, envName: string): string {
  const server = String(serverName || "server")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 64) || "SERVER";
  const env = String(envName || "SECRET")
    .replace(/[^a-z0-9_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 80) || "SECRET";
  return `HICODE_MCP_${server}_${env}`;
}

/**
 * Converts supported persisted credential fields into opaque references.
 * Secret writes are returned separately so callers can commit the secure store
 * and config file as one transaction. The returned config never contains a
 * plaintext model key or sensitive MCP environment value.
 */
export function prepareConfigForSecretPersistence(input: unknown): PreparedSecretConfig {
  const config = cloneJsonObject(input);
  const writesByRef = new Map<string, SecretWrite>();
  let changed = false;

  const addWrite = (write: SecretWrite) => {
    const previous = writesByRef.get(write.ref);
    if (previous && previous.value !== write.value) {
      throw new Error(`conflicting secret values target ${write.ref}`);
    }
    writesByRef.set(write.ref, write);
  };

  if (Object.prototype.hasOwnProperty.call(config, "apiKey")) {
    const result = externalizeModelValue(config, String(config.defaultProfile || "default"), "apiKey", "secretRef", "apiKey");
    changed = result.changed || changed;
    if (result.write) addWrite(result.write);
  } else if (Object.prototype.hasOwnProperty.call(config, "secretRef")) {
    config.secretRef = validateSecretRef(config.secretRef, "model");
  }

  if (config.profiles !== undefined) {
    if (!isRecord(config.profiles)) throw new Error("profiles must be an object");
    for (const [profileKey, rawProfile] of Object.entries(config.profiles)) {
      if (!isRecord(rawProfile)) throw new Error(`model profile ${profileKey} must be an object`);
      if (Object.prototype.hasOwnProperty.call(rawProfile, "apiKey")) {
        const result = externalizeModelValue(rawProfile, profileKey, "apiKey", "secretRef", `profiles.${profileKey}.apiKey`);
        changed = result.changed || changed;
        if (result.write) addWrite(result.write);
      } else if (Object.prototype.hasOwnProperty.call(rawProfile, "secretRef")) {
        rawProfile.secretRef = validateSecretRef(rawProfile.secretRef, "model");
      }
    }
  }

  if (config.mcpServers !== undefined) {
    if (!isRecord(config.mcpServers)) throw new Error("mcpServers must be an object");
    for (const [serverName, rawServer] of Object.entries(config.mcpServers)) {
      if (!isRecord(rawServer)) throw new Error(`MCP server ${serverName} must be an object`);
      if (rawServer.env === undefined) continue;
      if (!isRecord(rawServer.env)) throw new Error(`MCP server ${serverName}.env must be an object`);
      for (const [envName, rawValue] of Object.entries(rawServer.env)) {
        if (!isSensitiveEnvName(envName)) continue;
        const location = `mcpServers.${serverName}.env.${envName}`;
        if (isSecretReferenceRecord(rawValue)) {
          rawValue.secretRef = validateSecretRef(rawValue.secretRef, "mcp");
          continue;
        }
        if (typeof rawValue !== "string") throw new Error(`${location} must be a string or secretRef`);
        if (isCredentialPlaceholder(rawValue)) continue;
        const value = normalizeSecretValue(rawValue, location);
        const ref = mcpEnvSecretRef(serverName, envName);
        rawServer.env[envName] = { secretRef: ref };
        addWrite({ ref, value, location, scope: "mcp" });
        changed = true;
      }
    }
  }

  const remaining = findPlaintextConfigSecrets(config);
  if (remaining.length) throw new Error(`plaintext credentials remain in config: ${remaining.join(", ")}`);
  return { config, writes: [...writesByRef.values()], changed };
}

export function findPlaintextConfigSecrets(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const findings: string[] = [];
  if (typeof input.apiKey === "string" && !isCredentialPlaceholder(input.apiKey)) findings.push("apiKey");
  if (isRecord(input.profiles)) {
    for (const [profileKey, profile] of Object.entries(input.profiles)) {
      if (isRecord(profile) && typeof profile.apiKey === "string" && !isCredentialPlaceholder(profile.apiKey)) {
        findings.push(`profiles.${profileKey}.apiKey`);
      }
    }
  }
  if (isRecord(input.mcpServers)) {
    for (const [serverName, server] of Object.entries(input.mcpServers)) {
      if (!isRecord(server) || !isRecord(server.env)) continue;
      for (const [envName, value] of Object.entries(server.env)) {
        if (isSensitiveEnvName(envName) && typeof value === "string" && !isCredentialPlaceholder(value)) {
          findings.push(`mcpServers.${serverName}.env.${envName}`);
        }
      }
    }
  }
  return findings;
}

export function isCredentialPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text === "sk-no-key-required") return true;
  return /^(?:<[^>]+>|\$\{[^}]+\}|(?:replace|insert|enter|your)[-_ ]|(?:填入|填写|请输入|替换为))/i.test(text);
}

function externalizeModelValue(
  target: Record<string, unknown>,
  profileKey: string,
  valueKey: string,
  referenceKey: string,
  location: string,
): { changed: boolean; write?: SecretWrite } {
  const raw = target[valueKey];
  if (raw !== undefined && typeof raw !== "string") throw new Error(`${location} must be a string`);
  if (isCredentialPlaceholder(raw)) {
    delete target[valueKey];
    return { changed: true };
  }
  const value = normalizeSecretValue(raw, location);
  const existingRef = target[referenceKey] === undefined
    ? undefined
    : validateSecretRef(target[referenceKey], "model");
  const ref = existingRef || modelSecretRef(profileKey);
  target[referenceKey] = ref;
  delete target[valueKey];
  return {
    changed: true,
    write: { ref, value, location, scope: "model" },
  };
}

function normalizeSecretValue(value: unknown, location: string): string {
  if (typeof value !== "string") throw new Error(`${location} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${location} is empty`);
  if (normalized.length > MAX_SECRET_VALUE_LENGTH) throw new Error(`${location} exceeds the secret size limit`);
  if (normalized.includes("\0")) throw new Error(`${location} contains an invalid null byte`);
  return normalized;
}

function cloneJsonObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("config must be a JSON object");
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    if (!isRecord(cloned)) throw new Error("config must be a JSON object");
    return cloned;
  } catch (error) {
    throw new Error(`config must be JSON serializable: ${(error as Error).message}`);
  }
}

function encodeSegment(value: string, label: string): string {
  const text = String(value || "").trim();
  if (!text || text.length > 256 || /[\0\r\n]/.test(text)) throw new Error(`${label} is invalid`);
  return Buffer.from(text, "utf8").toString("base64url");
}

function decodeSegment(value: string, label: string): string {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (!decoded || decoded.length > 256 || Buffer.from(decoded, "utf8").toString("base64url") !== value) {
      throw new Error(`${label} is invalid`);
    }
    return decoded;
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
