import fs from "node:fs";
import path from "node:path";

export const PATCH_ARENA_SCHEMA_VERSION = 1;

export const ARENA_RUN_STATUSES = ["queued", "running", "ready", "failed", "cancelled", "merged"] as const;
export const ARENA_CANDIDATE_STATUSES = ["queued", "running", "ready", "rejected", "merged", "failed"] as const;
export const ARENA_GATE_STATUSES = ["passed", "failed", "warning", "skipped"] as const;

export type ArenaRunStatus = (typeof ARENA_RUN_STATUSES)[number];
export type ArenaCandidateStatus = (typeof ARENA_CANDIDATE_STATUSES)[number];
export type CandidateGateStatus = (typeof ARENA_GATE_STATUSES)[number];

export interface CandidatePatch {
  path: string;
  changedFiles: string[];
  summary: string;
  size?: number;
  sha256?: string;
}

export interface CandidateScore {
  total: number;
  gatesPassed: number;
  gatesFailed: number;
  riskyFiles: number;
  securitySensitiveFiles: number;
  skeletonFindings?: number;
  skeletonBlocking?: number;
  changedFiles: number;
  notes: string[];
}

export interface CandidateGateResult {
  id: string;
  gate: string;
  status: CandidateGateStatus;
  message: string;
  command?: string;
  exitCode?: number;
  durationMs?: number;
  createdAt: number;
  artifactPath?: string;
  metadata?: Record<string, unknown>;
}

export interface ArenaCandidate {
  id: string;
  runId: string;
  providerId: string;
  providerName?: string;
  status: ArenaCandidateStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  jobId?: string;
  workspace?: Record<string, unknown>;
  patch?: CandidatePatch;
  score?: CandidateScore;
  gateResults: CandidateGateResult[];
  artifacts: Array<{ type: string; path: string; name: string; size?: number }>;
  logs: string[];
  summary?: string;
  error?: string;
  riskNotes: string[];
  metadata?: Record<string, unknown>;
}

export interface MergeDecision {
  id: string;
  runId: string;
  candidateId: string;
  decision: "accepted" | "rejected" | "merged";
  actor: string;
  reason?: string;
  createdAt: number;
  patchPath?: string;
  result?: {
    ok: boolean;
    output?: string;
    error?: string;
  };
}

export interface ArenaRun {
  schemaVersion: typeof PATCH_ARENA_SCHEMA_VERSION;
  id: string;
  title: string;
  task: string;
  status: ArenaRunStatus;
  providerIds: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  actor: string;
  sourcePath: string;
  jobId?: string;
  candidates: ArenaCandidate[];
  decisions: MergeDecision[];
  artifacts: Array<{ type: string; path: string; name: string; size?: number }>;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface PatchArenaStoreFile {
  schemaVersion: typeof PATCH_ARENA_SCHEMA_VERSION;
  runs: ArenaRun[];
}

export interface PatchArenaStoreOptions {
  storePath: string;
  idPrefix?: string;
}

export class PatchArenaStore {
  private readonly storePath: string;
  private readonly idPrefix: string;
  private runs = new Map<string, ArenaRun>();

  constructor(options: PatchArenaStoreOptions) {
    if (!options?.storePath) throw new Error("PatchArenaStore requires storePath");
    this.storePath = options.storePath;
    this.idPrefix = options.idPrefix || "arena";
    this.load();
  }

  createRun(input: {
    task: string;
    title?: string;
    providerIds: string[];
    actor?: string;
    sourcePath: string;
    jobId?: string;
    metadata?: Record<string, unknown>;
    now?: number;
  }): ArenaRun {
    const now = safeNow(input.now);
    const task = requiredString(input.task, "task");
    const run: ArenaRun = {
      schemaVersion: PATCH_ARENA_SCHEMA_VERSION,
      id: newId(this.idPrefix),
      title: cleanString(input.title) || summarize(task),
      task,
      status: "queued",
      providerIds: stringArray(input.providerIds),
      createdAt: now,
      updatedAt: now,
      actor: cleanString(input.actor) || "user",
      sourcePath: requiredString(input.sourcePath, "sourcePath"),
      jobId: cleanString(input.jobId) || undefined,
      candidates: [],
      decisions: [],
      artifacts: [],
      metadata: sanitizeMetadata(input.metadata),
    };
    this.runs.set(run.id, run);
    this.persist();
    return clone(run);
  }

  getRun(id: string): ArenaRun | null {
    const run = this.runs.get(requiredString(id, "runId"));
    return run ? clone(run) : null;
  }

  listRuns(limit = 50): ArenaRun[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(0, limit))
      .map(clone);
  }

  updateRun(id: string, patch: Partial<ArenaRun> & { now?: number }): ArenaRun {
    const run = this.requireRun(id);
    const now = safeNow(patch.now);
    if (patch.status !== undefined) run.status = assertRunStatus(patch.status);
    if (patch.title !== undefined) run.title = requiredString(patch.title, "title");
    if (patch.error !== undefined) run.error = cleanString(patch.error) || undefined;
    if (patch.startedAt !== undefined) run.startedAt = optionalNumber(patch.startedAt);
    if (patch.endedAt !== undefined) run.endedAt = optionalNumber(patch.endedAt);
    if (patch.metadata !== undefined) run.metadata = sanitizeMetadata(patch.metadata);
    run.updatedAt = now;
    this.persist();
    return clone(run);
  }

  addCandidate(runId: string, input: Omit<Partial<ArenaCandidate>, "id" | "runId" | "createdAt" | "updatedAt"> & { providerId: string }): ArenaCandidate {
    const run = this.requireRun(runId);
    const now = Date.now();
    const candidate: ArenaCandidate = {
      id: newId("candidate"),
      runId: run.id,
      providerId: requiredString(input.providerId, "providerId"),
      providerName: cleanString(input.providerName) || undefined,
      status: assertCandidateStatus(input.status || "queued"),
      createdAt: now,
      updatedAt: now,
      startedAt: optionalNumber(input.startedAt),
      endedAt: optionalNumber(input.endedAt),
      jobId: cleanString(input.jobId) || undefined,
      workspace: sanitizeMetadata(input.workspace),
      patch: input.patch,
      score: input.score,
      gateResults: Array.isArray(input.gateResults) ? input.gateResults : [],
      artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
      logs: Array.isArray(input.logs) ? input.logs.map(String) : [],
      summary: cleanString(input.summary) || undefined,
      error: cleanString(input.error) || undefined,
      riskNotes: Array.isArray(input.riskNotes) ? input.riskNotes.map(String) : [],
      metadata: sanitizeMetadata(input.metadata),
    };
    run.candidates.push(candidate);
    run.updatedAt = now;
    this.persist();
    return clone(candidate);
  }

  updateCandidate(runId: string, candidateId: string, patch: Partial<ArenaCandidate>): ArenaCandidate {
    const run = this.requireRun(runId);
    const candidate = this.requireCandidate(run, candidateId);
    if (patch.status !== undefined) candidate.status = assertCandidateStatus(patch.status);
    if (patch.providerName !== undefined) candidate.providerName = cleanString(patch.providerName) || undefined;
    if (patch.startedAt !== undefined) candidate.startedAt = optionalNumber(patch.startedAt);
    if (patch.endedAt !== undefined) candidate.endedAt = optionalNumber(patch.endedAt);
    if (patch.workspace !== undefined) candidate.workspace = sanitizeMetadata(patch.workspace);
    if (patch.patch !== undefined) candidate.patch = patch.patch;
    if (patch.score !== undefined) candidate.score = patch.score;
    if (patch.gateResults !== undefined) candidate.gateResults = patch.gateResults;
    if (patch.artifacts !== undefined) candidate.artifacts = patch.artifacts;
    if (patch.logs !== undefined) candidate.logs = patch.logs.map(String);
    if (patch.summary !== undefined) candidate.summary = cleanString(patch.summary) || undefined;
    if (patch.error !== undefined) candidate.error = cleanString(patch.error) || undefined;
    if (patch.riskNotes !== undefined) candidate.riskNotes = patch.riskNotes.map(String);
    if (patch.metadata !== undefined) candidate.metadata = sanitizeMetadata(patch.metadata);
    candidate.updatedAt = Date.now();
    run.updatedAt = candidate.updatedAt;
    this.persist();
    return clone(candidate);
  }

  addDecision(runId: string, input: Omit<Partial<MergeDecision>, "id" | "runId" | "createdAt"> & { candidateId: string; decision: MergeDecision["decision"] }): MergeDecision {
    const run = this.requireRun(runId);
    const decision: MergeDecision = {
      id: newId("decision"),
      runId: run.id,
      candidateId: requiredString(input.candidateId, "candidateId"),
      decision: input.decision,
      actor: cleanString(input.actor) || "user",
      reason: cleanString(input.reason) || undefined,
      createdAt: Date.now(),
      patchPath: cleanString(input.patchPath) || undefined,
      result: input.result,
    };
    run.decisions.push(decision);
    run.updatedAt = decision.createdAt;
    this.persist();
    return clone(decision);
  }

  private requireRun(id: string): ArenaRun {
    const run = this.runs.get(requiredString(id, "runId"));
    if (!run) throw new Error("arena run not found");
    return run;
  }

  private requireCandidate(run: ArenaRun, id: string): ArenaCandidate {
    const candidate = run.candidates.find((item) => item.id === requiredString(id, "candidateId"));
    if (!candidate) throw new Error("arena candidate not found");
    return candidate;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as Partial<PatchArenaStoreFile>;
      for (const run of Array.isArray(parsed.runs) ? parsed.runs : []) {
        if (isArenaRun(run)) this.runs.set(run.id, run);
      }
    } catch {
      this.runs.clear();
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true, mode: 0o700 });
    const file: PatchArenaStoreFile = {
      schemaVersion: PATCH_ARENA_SCHEMA_VERSION,
      runs: Array.from(this.runs.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    };
    fs.writeFileSync(this.storePath, JSON.stringify(file, null, 2), { mode: 0o600 });
    try { fs.chmodSync(this.storePath, 0o600); } catch {}
  }
}

function isArenaRun(value: unknown): value is ArenaRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<ArenaRun>;
  return typeof run.id === "string"
    && typeof run.task === "string"
    && typeof run.status === "string"
    && Array.isArray(run.candidates)
    && Array.isArray(run.decisions);
}

function assertRunStatus(status: unknown): ArenaRunStatus {
  if (typeof status === "string" && ARENA_RUN_STATUSES.includes(status as ArenaRunStatus)) return status as ArenaRunStatus;
  throw new Error("invalid arena run status");
}

function assertCandidateStatus(status: unknown): ArenaCandidateStatus {
  if (typeof status === "string" && ARENA_CANDIDATE_STATUSES.includes(status as ArenaCandidateStatus)) return status as ArenaCandidateStatus;
  throw new Error("invalid arena candidate status");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function safeNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarize(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean || "Patch Arena run";
}
