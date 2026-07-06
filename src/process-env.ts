export const SAFE_CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SystemRoot",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

const SAFE_CHILD_ENV_KEY_SET = new Set<string>(SAFE_CHILD_ENV_KEYS);
const SENSITIVE_ENV_KEY_RE = /(^|_)(TOKEN|SECRET|PASSWORD|PASS|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL|AUTH|COOKIE)($|_)/i;

export interface SafeChildEnvOptions {
  source?: NodeJS.ProcessEnv;
  extraEnv?: Record<string, string | undefined>;
  allowlist?: string[];
  allowSensitiveExtraEnv?: boolean;
}

export function validateAllowedEnvKeys(keys: string[] = []): { ok: boolean; rejected: string[] } {
  const rejected = keys.filter((key) => !isValidEnvKey(key) || SENSITIVE_ENV_KEY_RE.test(key));
  return { ok: rejected.length === 0, rejected };
}

export function buildSafeChildEnv(options: SafeChildEnvOptions = {}): NodeJS.ProcessEnv {
  const source = options.source ?? process.env;
  const allowed = new Set([...SAFE_CHILD_ENV_KEY_SET, ...(options.allowlist || [])]);
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (isValidEnvKey(key) && !SENSITIVE_ENV_KEY_RE.test(key) && source[key] !== undefined) {
      env[key] = source[key];
    }
  }
  for (const [key, value] of Object.entries(options.extraEnv || {})) {
    if (value === undefined) continue;
    if (!isValidEnvKey(key)) throw new Error(`invalid environment variable name: ${key}`);
    if (!options.allowSensitiveExtraEnv && SENSITIVE_ENV_KEY_RE.test(key)) {
      throw new Error(`environment variable requires explicit allowlist: ${key}`);
    }
    env[key] = String(value);
  }
  return env;
}

export function redactEnvForLogs(env: NodeJS.ProcessEnv = {}): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = SENSITIVE_ENV_KEY_RE.test(key) ? "[REDACTED]" : String(value ?? "");
  }
  return redacted;
}

function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_()]*$/.test(key);
}
