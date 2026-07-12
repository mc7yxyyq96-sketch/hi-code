export type PreviewState = "registered" | "loading" | "ready" | "closed" | "failed";
export type VerificationStatus = "passed" | "failed";

export interface PreviewCapabilities {
  ok: boolean;
  available: boolean;
  loopbackOnly: boolean;
  supportedSchemes: readonly string[];
  maxSelectors: number;
  reason: string;
}

export interface PreviewCheck {
  id: string;
  status: VerificationStatus;
  detail: string;
}

export interface PreviewVerification {
  verificationId: string;
  status: VerificationStatus;
  checkedAt: string;
  url: string;
  title: string;
  checks: readonly PreviewCheck[];
  screenshot: Readonly<{ path: string; bytes: number }> | null;
  evidencePath: string;
  diagnostic: string;
}

export interface PreviewRecord {
  id: string;
  url: string;
  origin: string;
  label: string;
  selectors: readonly string[];
  state: PreviewState;
  createdAt: string;
  updatedAt: string;
  currentUrl: string;
  title: string;
  error: string;
  blockedNavigation: string;
  closeReason: string;
  lastVerification: PreviewVerification | null;
}

export interface PreviewEvent {
  type: "state" | "navigation-blocked" | "verification";
  preview: PreviewRecord;
}

export interface PreviewResult {
  ok: boolean;
  error?: string;
  code?: string;
  preview?: PreviewRecord;
  previews?: readonly PreviewRecord[];
  verification?: PreviewVerification;
  reused?: boolean;
}

export interface RawPreviewBridge {
  getPreviewCapabilities?: () => Promise<unknown>;
  openPreview?: (payload: unknown) => Promise<unknown>;
  listPreviews?: () => Promise<unknown>;
  reopenPreview?: (previewId: string) => Promise<unknown>;
  reloadPreview?: (previewId: string) => Promise<unknown>;
  verifyPreview?: (previewId: string, payload: unknown) => Promise<unknown>;
  closePreview?: (previewId: string, reason: string) => Promise<unknown>;
  removePreview?: (previewId: string) => Promise<unknown>;
  onPreviewEvent?: (handler: (event: unknown) => void) => (() => void) | void;
}

export interface PreviewApi {
  capabilities(): Promise<PreviewCapabilities>;
  open(payload: { url: string; label?: string; selectors?: readonly string[] }): Promise<PreviewResult>;
  list(): Promise<PreviewResult>;
  reopen(previewId: string): Promise<PreviewResult>;
  reload(previewId: string): Promise<PreviewResult>;
  verify(previewId: string, selectors: readonly string[]): Promise<PreviewResult>;
  close(previewId: string): Promise<PreviewResult>;
  remove(previewId: string): Promise<PreviewResult>;
  onEvent(handler: (event: PreviewEvent) => void): () => void;
}

const PREVIEW_ID_RE = /^preview-[a-f0-9-]{36}$/;

export function createPreviewApi(raw?: RawPreviewBridge): PreviewApi {
  const invoke = async (method: keyof RawPreviewBridge, args: unknown[] = []): Promise<PreviewResult> => {
    const fn = raw?.[method];
    if (typeof fn !== "function") return unavailableResult();
    try {
      const value = await (fn as (...callArgs: unknown[]) => Promise<unknown>)(...args);
      return normalizeResult(value);
    } catch (error) {
      return { ok: false, error: readableError(error) };
    }
  };
  const invokeWithId = (method: keyof RawPreviewBridge, previewId: string, extra: unknown[] = []): Promise<PreviewResult> => {
    try { return invoke(method, [normalizePreviewId(previewId), ...extra]); }
    catch (error) { return Promise.resolve({ ok: false, error: readableError(error) }); }
  };

  const api: PreviewApi = {
    async capabilities() {
      if (typeof raw?.getPreviewCapabilities !== "function") return unavailableCapabilities();
      try { return normalizeCapabilities(await raw.getPreviewCapabilities()); }
      catch (error) { return { ...unavailableCapabilities(), reason: readableError(error) }; }
    },
    open: (payload) => {
      try {
        return invoke("openPreview", [{
          url: String(payload?.url || "").trim(),
          label: String(payload?.label || "").trim().slice(0, 120),
          selectors: normalizeSelectorInput(payload?.selectors),
        }]);
      } catch (error) {
        return Promise.resolve({ ok: false, error: readableError(error) });
      }
    },
    list: () => invoke("listPreviews"),
    reopen: (previewId) => invokeWithId("reopenPreview", previewId),
    reload: (previewId) => invokeWithId("reloadPreview", previewId),
    verify: (previewId, selectors) => {
      try { return invokeWithId("verifyPreview", previewId, [{ selectors: normalizeSelectorInput(selectors) }]); }
      catch (error) { return Promise.resolve({ ok: false, error: readableError(error) }); }
    },
    close: (previewId) => invokeWithId("closePreview", previewId, ["user_closed"]),
    remove: (previewId) => invokeWithId("removePreview", previewId),
    onEvent(handler) {
      if (typeof handler !== "function" || typeof raw?.onPreviewEvent !== "function") return () => {};
      const unsubscribe = raw.onPreviewEvent((value) => {
        const event = normalizeEvent(value);
        if (event) handler(event);
      });
      return typeof unsubscribe === "function" ? unsubscribe : () => {};
    },
  };
  return Object.freeze(api);
}

function normalizeCapabilities(value: unknown): PreviewCapabilities {
  const data = objectValue(value);
  return {
    ok: data.ok !== false,
    available: data.available === true,
    loopbackOnly: data.loopbackOnly !== false,
    supportedSchemes: stringList(data.supportedSchemes, 4, 16),
    maxSelectors: boundedInteger(data.maxSelectors, 1, 12, 12),
    reason: boundedString(data.reason, 512),
  };
}

function normalizeResult(value: unknown): PreviewResult {
  const data = objectValue(value);
  const preview = normalizeRecord(data.preview);
  const previews = Array.isArray(data.previews) ? data.previews.map(normalizeRecord).filter((item): item is PreviewRecord => Boolean(item)).slice(0, 8) : undefined;
  const verification = normalizeVerification(data.verification);
  return {
    ok: data.ok === true,
    error: boundedString(data.error, 2048) || undefined,
    code: boundedString(data.code, 128) || undefined,
    preview: preview || undefined,
    previews,
    verification: verification || undefined,
    reused: data.reused === true,
  };
}

function normalizeRecord(value: unknown): PreviewRecord | null {
  const data = objectValue(value);
  const id = boundedString(data.id, 64);
  if (!PREVIEW_ID_RE.test(id)) return null;
  const state = ["registered", "loading", "ready", "closed", "failed"].includes(String(data.state)) ? data.state as PreviewState : "failed";
  return Object.freeze({
    id,
    url: boundedString(data.url, 2048),
    origin: boundedString(data.origin, 512),
    label: boundedString(data.label, 120),
    selectors: stringList(data.selectors, 12, 256),
    state,
    createdAt: boundedString(data.createdAt, 64),
    updatedAt: boundedString(data.updatedAt, 64),
    currentUrl: boundedString(data.currentUrl, 2048),
    title: boundedString(data.title, 160),
    error: boundedString(data.error, 2048),
    blockedNavigation: boundedString(data.blockedNavigation, 2048),
    closeReason: boundedString(data.closeReason, 64),
    lastVerification: normalizeVerification(data.lastVerification),
  });
}

function normalizeVerification(value: unknown): PreviewVerification | null {
  const data = objectValue(value);
  const verificationId = boundedString(data.verificationId, 96);
  if (!verificationId) return null;
  const status: VerificationStatus = data.status === "passed" ? "passed" : "failed";
  const checks = Array.isArray(data.checks) ? data.checks.slice(0, 32).map((value) => {
    const check = objectValue(value);
    return Object.freeze({
      id: boundedString(check.id, 320),
      status: check.status === "passed" ? "passed" as const : "failed" as const,
      detail: boundedString(check.detail, 512),
    });
  }) : [];
  const screenshotValue = objectValue(data.screenshot);
  const screenshot = boundedString(screenshotValue.path, 4096)
    ? Object.freeze({ path: boundedString(screenshotValue.path, 4096), bytes: boundedInteger(screenshotValue.bytes, 0, 16 * 1024 * 1024, 0) })
    : null;
  return Object.freeze({
    verificationId,
    status,
    checkedAt: boundedString(data.checkedAt, 64),
    url: boundedString(data.url, 2048),
    title: boundedString(data.title, 160),
    checks,
    screenshot,
    evidencePath: boundedString(data.evidencePath, 4096),
    diagnostic: boundedString(data.diagnostic, 2048),
  });
}

function normalizeEvent(value: unknown): PreviewEvent | null {
  const data = objectValue(value);
  if (!["state", "navigation-blocked", "verification"].includes(String(data.type))) return null;
  const preview = normalizeRecord(data.preview);
  return preview ? { type: data.type as PreviewEvent["type"], preview } : null;
}

function normalizePreviewId(value: string) {
  const id = String(value || "").trim();
  if (!PREVIEW_ID_RE.test(id)) throw new Error("预览 ID 无效");
  return id;
}

function normalizeSelectorInput(value: readonly string[] | undefined) {
  if (!Array.isArray(value)) return [];
  const selectors = value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12);
  if (selectors.some((selector) => selector.length > 256 || /[\u0000-\u001f\u007f]/.test(selector))) throw new Error("验证选择器无效");
  return [...new Set(selectors)];
}

function unavailableCapabilities(): PreviewCapabilities {
  return {
    ok: true,
    available: false,
    loopbackOnly: true,
    supportedSchemes: [],
    maxSelectors: 12,
    reason: "浏览器预览模式不提供隔离的应用预览窗口，请使用 Hi Code 桌面版。",
  };
}

function unavailableResult(): PreviewResult {
  return { ok: false, code: "preview_unavailable", error: unavailableCapabilities().reason };
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function stringList(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => item.slice(0, maxLength)).slice(0, maxItems) : [];
}

function boundedString(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.round(numeric))) : fallback;
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error || "应用预览操作失败");
}
