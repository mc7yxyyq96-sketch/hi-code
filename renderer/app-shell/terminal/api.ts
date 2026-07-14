export interface TerminalShellDescriptor {
  executable: string;
  label: string;
  profileLoading: boolean;
}

export interface TerminalCapabilities {
  ok: boolean;
  available: boolean;
  platform: string;
  shell: TerminalShellDescriptor | null;
  supportsResize: boolean;
  profileLoading: boolean;
  maxSessionsPerWindow: number;
  reason?: string;
  setupHint?: string;
}

export interface TerminalSession {
  id: string;
  cwd: string;
  shell: TerminalShellDescriptor;
  cols: number;
  rows: number;
  startedAt: number;
  state: "running" | "closing";
}

export type TerminalEvent =
  | { type: "output"; sessionId: string; sequence: number; data: string }
  | { type: "exit"; sessionId: string; sequence: number; reason: string; exitCode: number | null; signal: number | null };

export interface TerminalApiResult {
  ok: boolean;
  error?: string;
  code?: string;
  denied?: boolean;
}

export interface TerminalCreateResult extends TerminalApiResult {
  reused?: boolean;
  session?: TerminalSession;
  snapshot?: string;
}

export interface TerminalStatusResult extends TerminalApiResult {
  active: boolean;
  session: TerminalSession | null;
  snapshot: string;
}

export interface TerminalApi {
  capabilities(): Promise<TerminalCapabilities>;
  create(size: { cols: number; rows: number }): Promise<TerminalCreateResult>;
  status(): Promise<TerminalStatusResult>;
  write(sessionId: string, data: string): Promise<TerminalApiResult>;
  resize(sessionId: string, size: { cols: number; rows: number }): Promise<TerminalApiResult>;
  close(sessionId: string, reason: string): Promise<TerminalApiResult>;
  onEvent(handler: (event: TerminalEvent) => void): () => void;
}

const MAX_EVENT_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

export interface RawTerminalBridge {
  getTerminalCapabilities?: () => Promise<unknown>;
  createTerminal?: (payload: { cols: number; rows: number }) => Promise<unknown>;
  getTerminalStatus?: () => Promise<unknown>;
  writeTerminal?: (sessionId: string, data: string) => Promise<unknown>;
  resizeTerminal?: (sessionId: string, payload: { cols: number; rows: number }) => Promise<unknown>;
  closeTerminal?: (sessionId: string, reason: string) => Promise<unknown>;
  onTerminalEvent?: (handler: (event: unknown) => void) => unknown;
}

export function createTerminalApi(raw: RawTerminalBridge | undefined): TerminalApi {
  const bridge = raw || {};
  const api: TerminalApi = {
    async capabilities() {
      const value = await call(bridge.getTerminalCapabilities, []);
      if (!isRecord(value) || value.ok !== true) return unavailable(resultError(value, "终端能力不可用"));
      return {
        ok: true,
        available: value.available === true,
        platform: text(value.platform),
        shell: normalizeShell(value.shell),
        supportsResize: value.supportsResize === true,
        profileLoading: value.profileLoading === true,
        maxSessionsPerWindow: integer(value.maxSessionsPerWindow, 1),
        reason: optionalText(value.reason),
        setupHint: optionalText(value.setupHint),
      };
    },
    async create(size) {
      const value = await call(bridge.createTerminal, [normalizeSize(size)]);
      if (!isRecord(value)) return failed("终端启动返回无效结果");
      return {
        ...normalizeResult(value, "终端启动失败"),
        reused: value.reused === true,
        session: normalizeSession(value.session) || undefined,
        snapshot: boundedUtf8Tail(value.snapshot, MAX_SNAPSHOT_BYTES),
      };
    },
    async status() {
      const value = await call(bridge.getTerminalStatus, []);
      if (!isRecord(value)) return { ...failed("终端状态不可用"), active: false, session: null, snapshot: "" };
      return {
        ...normalizeResult(value, "终端状态不可用"),
        active: value.active === true,
        session: normalizeSession(value.session),
        snapshot: boundedUtf8Tail(value.snapshot, MAX_SNAPSHOT_BYTES),
      };
    },
    async write(sessionId, data) {
      return normalizeResult(await call(bridge.writeTerminal, [sessionId, data]), "终端输入失败");
    },
    async resize(sessionId, size) {
      return normalizeResult(await call(bridge.resizeTerminal, [sessionId, normalizeSize(size)]), "终端尺寸更新失败");
    },
    async close(sessionId, reason) {
      return normalizeResult(await call(bridge.closeTerminal, [sessionId, reason]), "终端关闭失败");
    },
    onEvent(handler) {
      if (typeof bridge.onTerminalEvent !== "function") return () => {};
      const unsubscribe = bridge.onTerminalEvent((value) => {
        const event = normalizeEvent(value);
        if (event) handler(event);
      });
      return typeof unsubscribe === "function" ? unsubscribe as () => void : () => {};
    },
  };
  return Object.freeze(api);
}

async function call(fn: ((...args: never[]) => Promise<unknown>) | undefined, args: unknown[]) {
  if (typeof fn !== "function") return failed("当前桌面版本不提供集成终端");
  try {
    return await fn(...args as never[]);
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error || "终端操作失败"));
  }
}

function normalizeResult(value: unknown, fallback: string): TerminalApiResult {
  if (!isRecord(value)) return failed(fallback);
  return {
    ok: value.ok === true,
    error: value.ok === true ? undefined : resultError(value, fallback),
    code: optionalText(value.code),
    denied: value.denied === true,
  };
}

function normalizeSession(value: unknown): TerminalSession | null {
  if (!isRecord(value) || !/^terminal-[a-f0-9-]{36}$/.test(text(value.id))) return null;
  const shell = normalizeShell(value.shell);
  if (!shell) return null;
  return {
    id: text(value.id),
    cwd: boundedText(value.cwd, 4096),
    shell,
    cols: integer(value.cols, 100),
    rows: integer(value.rows, 28),
    startedAt: integer(value.startedAt, Date.now()),
    state: value.state === "closing" ? "closing" : "running",
  };
}

function normalizeShell(value: unknown): TerminalShellDescriptor | null {
  if (!isRecord(value) || !boundedText(value.executable, 4096) || !boundedText(value.label, 128)) return null;
  return { executable: boundedText(value.executable, 4096), label: boundedText(value.label, 128), profileLoading: value.profileLoading === true };
}

function normalizeEvent(value: unknown): TerminalEvent | null {
  if (!isRecord(value) || !/^terminal-[a-f0-9-]{36}$/.test(text(value.sessionId)) || integer(value.sequence, 0) < 1) return null;
  if (value.type === "output" && typeof value.data === "string" && utf8Length(value.data) <= MAX_EVENT_BYTES) {
    return { type: "output", sessionId: text(value.sessionId), sequence: integer(value.sequence, 0), data: value.data };
  }
  if (value.type === "exit") {
    return {
      type: "exit",
      sessionId: text(value.sessionId),
      sequence: integer(value.sequence, 0),
      reason: text(value.reason) || "closed",
      exitCode: nullableInteger(value.exitCode),
      signal: nullableInteger(value.signal),
    };
  }
  return null;
}

function normalizeSize(value: { cols: number; rows: number }) {
  return {
    cols: Math.max(20, Math.min(400, Math.round(Number(value?.cols) || 100))),
    rows: Math.max(5, Math.min(200, Math.round(Number(value?.rows) || 28))),
  };
}

function unavailable(reason: string): TerminalCapabilities {
  return { ok: true, available: false, platform: "", shell: null, supportsResize: false, profileLoading: false, maxSessionsPerWindow: 1, reason };
}

function failed(error: string): TerminalApiResult {
  return { ok: false, error };
}

function resultError(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.error === "string" && value.error.trim() ? value.error : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function boundedText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength ? value : "";
}

function optionalText(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function integer(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function nullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function boundedUtf8Tail(value: unknown, maxBytes: number) {
  if (typeof value !== "string" || !value) return "";
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  let start = encoded.byteLength - maxBytes;
  while (start < encoded.byteLength && (encoded[start] & 0xc0) === 0x80) start += 1;
  return new TextDecoder().decode(encoded.subarray(start));
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
