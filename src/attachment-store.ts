import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ATTACHMENT_STORE_SCHEMA_VERSION = 1;

export type AttachmentKind = "image" | "pdf" | "text" | "file";

export interface AttachmentRecord {
  schemaVersion: typeof ATTACHMENT_STORE_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  sha256: string;
  blobKey: string;
  createdAt: number;
}

export interface AttachmentReferencePart {
  type: "attachment_ref";
  attachment: Pick<AttachmentRecord, "id" | "name" | "kind" | "mimeType" | "size" | "sha256">;
}

export interface PutAttachmentInput {
  sessionId: string;
  name: string;
  data: Uint8Array;
  mimeType?: string;
}

export interface AttachmentReadResult {
  record: AttachmentRecord;
  data: Buffer;
}

export interface AttachmentReader {
  get(id: string): AttachmentRecord | undefined;
  read(id: string): AttachmentReadResult;
}

export class AttachmentStoreError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AttachmentStoreError";
    this.code = code;
    this.details = details;
  }
}

const SIZE_LIMITS: Record<AttachmentKind, number> = {
  image: 8 * 1024 * 1024,
  text: 2 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
  file: 20 * 1024 * 1024,
};

export class FileAttachmentStore implements AttachmentReader {
  readonly root: string;
  readonly recordsRoot: string;
  readonly blobsRoot: string;

  constructor(root: string) {
    this.root = path.resolve(requiredText(root, "attachment store root"));
    this.recordsRoot = path.join(this.root, "records");
    this.blobsRoot = path.join(this.root, "blobs");
    ensureDirectory(this.root);
    ensureDirectory(this.recordsRoot);
    ensureDirectory(this.blobsRoot);
  }

  putBuffer(input: PutAttachmentInput): AttachmentRecord {
    const sessionId = validateSessionId(input.sessionId);
    const name = safeAttachmentName(input.name);
    const data = Buffer.from(input.data || []);
    if (data.length === 0) throw new AttachmentStoreError("attachment_empty", "Attachment is empty.");

    const detected = detectAttachment(data);
    const limit = SIZE_LIMITS[detected.kind];
    if (data.length > limit) {
      throw new AttachmentStoreError(
        "attachment_too_large",
        `${displayKind(detected.kind)} attachment exceeds the ${formatBytes(limit)} limit.`,
        { kind: detected.kind, size: data.length, limit },
      );
    }

    const sha256 = digest(data);
    const blobKey = sha256;
    const id = `att-${crypto.randomUUID()}`;
    const record: AttachmentRecord = {
      schemaVersion: ATTACHMENT_STORE_SCHEMA_VERSION,
      id,
      sessionId,
      name,
      kind: detected.kind,
      mimeType: detected.mimeType,
      size: data.length,
      sha256,
      blobKey,
      createdAt: Date.now(),
    };

    const blobPath = this.blobPath(blobKey);
    if (fs.existsSync(blobPath)) {
      const existing = readRegularFile(blobPath, "attachment_integrity_failed");
      if (digest(existing) !== sha256) {
        throw new AttachmentStoreError("attachment_integrity_failed", "Stored attachment content failed its integrity check.", { id });
      }
    } else {
      atomicWrite(blobPath, data);
    }
    atomicWrite(this.recordPath(id), Buffer.from(JSON.stringify(record, null, 2) + "\n", "utf8"));
    return cloneRecord(record);
  }

  get(id: string): AttachmentRecord | undefined {
    const safeId = validateAttachmentId(id);
    const file = this.recordPath(safeId);
    if (!fs.existsSync(file)) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(readRegularFile(file, "attachment_metadata_invalid").toString("utf8"));
    } catch (error) {
      if (error instanceof AttachmentStoreError) throw error;
      throw new AttachmentStoreError("attachment_metadata_invalid", "Attachment metadata is unreadable.", { id: safeId });
    }
    const record = validateRecord(value);
    if (record.id !== safeId) {
      throw new AttachmentStoreError("attachment_metadata_invalid", "Attachment metadata identity does not match its record.", { id: safeId });
    }
    return cloneRecord(record);
  }

  list(sessionId?: string): AttachmentRecord[] {
    const safeSession = sessionId === undefined ? undefined : validateSessionId(sessionId);
    const records: AttachmentRecord[] = [];
    for (const name of fs.readdirSync(this.recordsRoot).filter((item) => item.endsWith(".json")).sort()) {
      const record = this.get(name.slice(0, -5));
      if (record && (safeSession === undefined || record.sessionId === safeSession)) records.push(record);
    }
    return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  read(id: string): AttachmentReadResult {
    const record = this.get(id);
    if (!record) throw new AttachmentStoreError("attachment_not_found", "Attachment no longer exists.", { id: String(id || "") });
    const data = readRegularFile(this.blobPath(record.blobKey), "attachment_not_found");
    if (data.length !== record.size || digest(data) !== record.sha256) {
      throw new AttachmentStoreError("attachment_integrity_failed", `Attachment ${record.name} failed its integrity check.`, { id: record.id });
    }
    return { record, data };
  }

  remove(id: string): boolean {
    const record = this.get(id);
    if (!record) return false;
    fs.unlinkSync(this.recordPath(record.id));
    const referenced = this.list().some((item) => item.blobKey === record.blobKey);
    if (!referenced) fs.rmSync(this.blobPath(record.blobKey), { force: true });
    return true;
  }

  removeSession(sessionId: string): number {
    const records = this.list(validateSessionId(sessionId));
    for (const record of records) this.remove(record.id);
    return records.length;
  }

  private recordPath(id: string): string {
    return safeChild(this.recordsRoot, `${validateAttachmentId(id)}.json`);
  }

  private blobPath(blobKey: string): string {
    if (!/^[a-f0-9]{64}$/.test(blobKey)) throw new AttachmentStoreError("attachment_metadata_invalid", "Attachment blob key is invalid.");
    return safeChild(this.blobsRoot, blobKey);
  }
}

export function attachmentReference(record: AttachmentRecord): AttachmentReferencePart {
  const value = validateRecord(record);
  return {
    type: "attachment_ref",
    attachment: {
      id: value.id,
      name: value.name,
      kind: value.kind,
      mimeType: value.mimeType,
      size: value.size,
      sha256: value.sha256,
    },
  };
}

function detectAttachment(data: Buffer): { kind: AttachmentKind; mimeType: string } {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", mimeType: "image/png" };
  if (startsWith(data, [0xff, 0xd8, 0xff])) return { kind: "image", mimeType: "image/jpeg" };
  if (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a") return { kind: "image", mimeType: "image/gif" };
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return { kind: "image", mimeType: "image/webp" };
  if (data.subarray(0, 5).toString("ascii") === "%PDF-") return { kind: "pdf", mimeType: "application/pdf" };
  if (isUtf8Text(data)) return { kind: "text", mimeType: "text/plain; charset=utf-8" };
  return { kind: "file", mimeType: "application/octet-stream" };
}

function isUtf8Text(data: Buffer): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

function startsWith(data: Buffer, bytes: number[]): boolean {
  return data.length >= bytes.length && bytes.every((value, index) => data[index] === value);
}

function validateRecord(value: unknown): AttachmentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AttachmentStoreError("attachment_metadata_invalid", "Attachment metadata is invalid.");
  const record = value as Partial<AttachmentRecord>;
  const kind = record.kind;
  if (
    record.schemaVersion !== ATTACHMENT_STORE_SCHEMA_VERSION ||
    !record.id || validateAttachmentId(record.id) !== record.id ||
    !record.sessionId || validateSessionId(record.sessionId) !== record.sessionId ||
    !record.name || safeAttachmentName(record.name) !== record.name ||
    (kind !== "image" && kind !== "pdf" && kind !== "text" && kind !== "file") ||
    typeof record.mimeType !== "string" || record.mimeType.length < 3 || record.mimeType.length > 120 ||
    !Number.isInteger(record.size) || Number(record.size) <= 0 || Number(record.size) > SIZE_LIMITS[kind] ||
    typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256) ||
    record.blobKey !== record.sha256 ||
    !Number.isFinite(record.createdAt) || Number(record.createdAt) <= 0
  ) {
    throw new AttachmentStoreError("attachment_metadata_invalid", "Attachment metadata failed validation.");
  }
  return record as AttachmentRecord;
}

function validateAttachmentId(id: string): string {
  const value = String(id || "").trim();
  if (!/^att-[a-f0-9-]{36}$/.test(value)) throw new AttachmentStoreError("attachment_id_invalid", "Attachment id is invalid.");
  return value;
}

function validateSessionId(sessionId: string): string {
  const value = String(sessionId || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,140}$/.test(value)) throw new AttachmentStoreError("attachment_session_invalid", "Attachment session id is invalid.");
  return value;
}

function safeAttachmentName(name: string): string {
  const value = requiredText(name, "attachment name").split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "";
  if (!value || value === "." || value === "..") throw new AttachmentStoreError("attachment_name_invalid", "Attachment name is invalid.");
  return value.slice(0, 180);
}

function safeChild(root: string, name: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, name);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new AttachmentStoreError("attachment_path_invalid", "Attachment storage path escaped its root.");
  return target;
}

function ensureDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
}

function atomicWrite(file: string, data: Buffer): void {
  const directory = path.dirname(file);
  ensureDirectory(directory);
  const temporary = safeChild(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, data, { mode: 0o600, flag: "wx" });
    if (process.platform !== "win32") fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function readRegularFile(file: string, missingCode: string): Buffer {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new AttachmentStoreError(missingCode, "Attachment storage entry is missing.");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new AttachmentStoreError("attachment_path_invalid", "Attachment storage entry is not a regular file.");
  return fs.readFileSync(file);
}

function digest(data: Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function cloneRecord(record: AttachmentRecord): AttachmentRecord {
  return { ...record };
}

function requiredText(value: string, label: string): string {
  const text = String(value || "").trim();
  if (!text) throw new AttachmentStoreError("attachment_validation_failed", `${label} is required.`);
  return text;
}

function displayKind(kind: AttachmentKind): string {
  return kind === "pdf" ? "PDF" : kind[0].toUpperCase() + kind.slice(1);
}

function formatBytes(value: number): string {
  return `${Math.round(value / (1024 * 1024))} MiB`;
}
