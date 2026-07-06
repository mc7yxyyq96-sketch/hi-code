import fs from "node:fs";
import path from "node:path";

export const JOB_CENTER_SCHEMA_VERSION = 1;

export const JOB_STATUSES = [
  "queued",
  "running",
  "paused",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type TaskStatus = JobStatus;
export type TaskStepStatus = JobStatus;
export const GATE_STATUSES = [
  "passed",
  "failed",
  "warning",
  "skipped",
  "simulated",
  "not_run",
  "requires_approval",
] as const;

export type GateStatus = (typeof GATE_STATUSES)[number];
export type ApprovalStatus = "requested" | "approved" | "denied" | "expired";

export interface TaskStep {
  id: string;
  title: string;
  status: TaskStepStatus;
  executor?: string;
  command?: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  artifacts: string[];
  gateResults: string[];
  metadata?: Record<string, unknown>;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  description?: string;
  assignee?: string;
  executor?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  steps: TaskStep[];
  artifacts: string[];
  gateResults: string[];
  metadata?: Record<string, unknown>;
}

export interface Artifact {
  id: string;
  type: string;
  path: string;
  name?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  createdAt: number;
  producedBy?: {
    taskId?: string;
    stepId?: string;
    executor?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface GateResult {
  id: string;
  gate: string;
  status: GateStatus;
  createdAt: number;
  message?: string;
  score?: number;
  taskId?: string;
  stepId?: string;
  artifacts: string[];
  metadata?: Record<string, unknown>;
}

export interface ApprovalRecord {
  id: string;
  status: ApprovalStatus;
  requestedAt: number;
  decidedAt?: number;
  requestedBy?: string;
  decidedBy?: string;
  scope?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface JobEvent {
  id: string;
  jobId: string;
  type: string;
  message: string;
  createdAt: number;
  actor?: string;
  taskId?: string;
  stepId?: string;
  status?: JobStatus | TaskStatus | TaskStepStatus | GateStatus | ApprovalStatus;
  data?: Record<string, unknown>;
}

export interface Job {
  schemaVersion: typeof JOB_CENTER_SCHEMA_VERSION;
  id: string;
  title: string;
  status: JobStatus;
  source: string;
  trigger: string;
  actor: string;
  executor: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  description?: string;
  cwd?: string;
  error?: string;
  retryCount: number;
  tasks: Task[];
  artifacts: Artifact[];
  events: JobEvent[];
  gateResults: GateResult[];
  approvals: ApprovalRecord[];
  metadata?: Record<string, unknown>;
}

export interface CreateJobInput {
  title: string;
  source?: string;
  trigger?: string;
  actor?: string;
  executor?: string;
  description?: string;
  cwd?: string;
  tasks?: Array<Partial<Task> & { title: string }>;
  metadata?: Record<string, unknown>;
  now?: number;
}

export interface UpdateJobInput {
  status?: JobStatus;
  title?: string;
  description?: string;
  executor?: string;
  actor?: string;
  cwd?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  now?: number;
}

export interface JobEventInput {
  type: string;
  message: string;
  actor?: string;
  taskId?: string;
  stepId?: string;
  status?: JobEvent["status"];
  data?: Record<string, unknown>;
  now?: number;
}

export interface ArtifactInput {
  type: string;
  path: string;
  name?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  producedBy?: Artifact["producedBy"];
  metadata?: Record<string, unknown>;
  now?: number;
}

export interface GateResultInput {
  gate: string;
  status: GateStatus;
  message?: string;
  score?: number;
  taskId?: string;
  stepId?: string;
  artifacts?: string[];
  metadata?: Record<string, unknown>;
  now?: number;
}

export interface ApprovalRecordInput {
  status: ApprovalStatus;
  requestedBy?: string;
  decidedBy?: string;
  scope?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  now?: number;
}

export interface JobListOptions {
  status?: JobStatus;
  source?: string;
  limit?: number;
}

export interface JobCenterStoreFile {
  schemaVersion: typeof JOB_CENTER_SCHEMA_VERSION;
  jobs: Job[];
}

type ArtifactRoot = string | (() => string | undefined | null);

export interface JobStoreOptions {
  storePath: string;
  allowedArtifactRoots?: ArtifactRoot[];
  idPrefix?: string;
}

const TERMINAL_STATUSES = new Set<JobStatus>(["succeeded", "failed", "cancelled"]);
const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["running", "paused", "cancelled"],
  running: ["waiting_approval", "paused", "succeeded", "failed", "cancelled"],
  paused: ["queued", "cancelled"],
  waiting_approval: ["running", "paused", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export class JobStore {
  private readonly storePath: string;
  private readonly allowedArtifactRoots: ArtifactRoot[];
  private readonly idPrefix: string;
  private jobs = new Map<string, Job>();

  constructor(options: JobStoreOptions) {
    if (!options?.storePath) throw new Error("JobStore requires storePath");
    this.storePath = options.storePath;
    this.allowedArtifactRoots = options.allowedArtifactRoots || [];
    this.idPrefix = options.idPrefix || "job";
    this.load();
  }

  createJob(input: CreateJobInput): Job {
    const now = safeNow(input.now);
    const title = requiredString(input.title, "title");
    const job: Job = {
      schemaVersion: JOB_CENTER_SCHEMA_VERSION,
      id: newId(this.idPrefix),
      title,
      status: "queued",
      source: cleanString(input.source) || "manual",
      trigger: cleanString(input.trigger) || "manual",
      actor: cleanString(input.actor) || "user",
      executor: cleanString(input.executor) || "hicode",
      createdAt: now,
      updatedAt: now,
      description: cleanString(input.description) || undefined,
      cwd: cleanString(input.cwd) || undefined,
      retryCount: 0,
      tasks: (input.tasks || []).map((task, index) => normalizeTask(task, now, index)),
      artifacts: [],
      events: [],
      gateResults: [],
      approvals: [],
      metadata: sanitizeMetadata(input.metadata),
    };
    job.events.push({
      id: newId("evt"),
      jobId: job.id,
      type: "job.created",
      message: `Job created from ${job.source}`,
      createdAt: now,
      actor: job.actor,
      status: job.status,
      data: { source: job.source, trigger: job.trigger, executor: job.executor },
    });
    this.jobs.set(job.id, job);
    this.persist();
    return cloneJob(job);
  }

  getJob(id: string): Job | null {
    const job = this.jobs.get(requiredString(id, "jobId"));
    return job ? cloneJob(job) : null;
  }

  listJobs(options: JobListOptions = {}): Job[] {
    let jobs = Array.from(this.jobs.values());
    if (options.status) {
      assertJobStatus(options.status);
      jobs = jobs.filter((job) => job.status === options.status);
    }
    if (options.source) jobs = jobs.filter((job) => job.source === options.source);
    jobs.sort((a, b) => b.updatedAt - a.updatedAt);
    const limit = Number.isFinite(options.limit) ? Math.max(0, Number(options.limit)) : jobs.length;
    return jobs.slice(0, limit).map(cloneJob);
  }

  updateJob(id: string, patch: UpdateJobInput): Job {
    const job = this.requireJob(id);
    const now = safeNow(patch.now);
    if (patch.status && patch.status !== job.status) {
      this.transitionJob(job, patch.status, now, patch.error);
    }
    if (patch.title !== undefined) job.title = requiredString(patch.title, "title");
    if (patch.description !== undefined) job.description = cleanString(patch.description) || undefined;
    if (patch.executor !== undefined) job.executor = cleanString(patch.executor) || job.executor;
    if (patch.actor !== undefined) job.actor = cleanString(patch.actor) || job.actor;
    if (patch.cwd !== undefined) job.cwd = cleanString(patch.cwd) || undefined;
    if (patch.error !== undefined) job.error = cleanString(patch.error) || undefined;
    if (patch.metadata !== undefined) job.metadata = sanitizeMetadata(patch.metadata);
    job.updatedAt = now;
    this.persist();
    return cloneJob(job);
  }

  appendJobEvent(id: string, input: JobEventInput): JobEvent {
    const job = this.requireJob(id);
    const now = safeNow(input.now);
    const event = normalizeEvent(job.id, input, now);
    job.events.push(event);
    job.updatedAt = now;
    this.persist();
    return clone(event);
  }

  addArtifact(id: string, input: ArtifactInput): Artifact {
    const job = this.requireJob(id);
    const now = safeNow(input.now);
    const artifact = normalizeArtifact(input, now, this.allowedArtifactRoots);
    job.artifacts.push(artifact);
    if (artifact.producedBy?.taskId) {
      const task = job.tasks.find((item) => item.id === artifact.producedBy?.taskId);
      if (task && !task.artifacts.includes(artifact.id)) task.artifacts.push(artifact.id);
    }
    if (artifact.producedBy?.stepId) {
      const step = findStep(job, artifact.producedBy.stepId);
      if (step && !step.artifacts.includes(artifact.id)) step.artifacts.push(artifact.id);
    }
    job.events.push({
      id: newId("evt"),
      jobId: job.id,
      type: "artifact.added",
      message: `Artifact added: ${artifact.path}`,
      createdAt: now,
      actor: artifact.producedBy?.executor,
      taskId: artifact.producedBy?.taskId,
      stepId: artifact.producedBy?.stepId,
      data: { artifactId: artifact.id, path: artifact.path, type: artifact.type },
    });
    job.updatedAt = now;
    this.persist();
    return clone(artifact);
  }

  addGateResult(id: string, input: GateResultInput): GateResult {
    const job = this.requireJob(id);
    const now = safeNow(input.now);
    const result = normalizeGateResult(input, now);
    job.gateResults.push(result);
    if (result.taskId) {
      const task = job.tasks.find((item) => item.id === result.taskId);
      if (task && !task.gateResults.includes(result.id)) task.gateResults.push(result.id);
    }
    if (result.stepId) {
      const step = findStep(job, result.stepId);
      if (step && !step.gateResults.includes(result.id)) step.gateResults.push(result.id);
    }
    job.events.push({
      id: newId("evt"),
      jobId: job.id,
      type: "gate.result",
      message: `${result.gate}: ${result.status}`,
      createdAt: now,
      taskId: result.taskId,
      stepId: result.stepId,
      status: result.status,
      data: { gateResultId: result.id, gate: result.gate, artifacts: result.artifacts },
    });
    job.updatedAt = now;
    this.persist();
    return clone(result);
  }

  addApprovalRecord(id: string, input: ApprovalRecordInput): ApprovalRecord {
    const job = this.requireJob(id);
    const now = safeNow(input.now);
    const approval = normalizeApprovalRecord(input, now);
    job.approvals.push(approval);
    job.events.push({
      id: newId("evt"),
      jobId: job.id,
      type: "approval.recorded",
      message: `${approval.scope || "approval"}: ${approval.status}`,
      createdAt: now,
      actor: approval.decidedBy || approval.requestedBy,
      status: approval.status,
      data: { approvalId: approval.id, scope: approval.scope, reason: approval.reason },
    });
    job.updatedAt = now;
    this.persist();
    return clone(approval);
  }

  cancelJob(id: string, reason = "cancelled", actor = "user"): Job {
    const job = this.updateJob(id, { status: "cancelled", error: reason });
    this.appendJobEvent(id, {
      type: "job.cancelled",
      message: cleanString(reason) || "cancelled",
      actor,
      status: "cancelled",
    });
    return this.getJob(job.id)!;
  }

  retryJob(id: string, actor = "user"): Job {
    const job = this.requireJob(id);
    if (!["failed", "cancelled"].includes(job.status)) {
      throw new Error(`cannot retry job from ${job.status}`);
    }
    const now = Date.now();
    job.status = "queued";
    job.startedAt = undefined;
    job.endedAt = undefined;
    job.error = undefined;
    job.retryCount += 1;
    job.updatedAt = now;
    job.events.push({
      id: newId("evt"),
      jobId: job.id,
      type: "job.retry",
      message: "Job queued for retry",
      createdAt: now,
      actor,
      status: "queued",
      data: { retryCount: job.retryCount },
    });
    this.persist();
    return cloneJob(job);
  }

  pauseJob(id: string, actor = "user"): Job {
    const job = this.updateJob(id, { status: "paused" });
    this.appendJobEvent(id, {
      type: "job.paused",
      message: "Job paused",
      actor,
      status: "paused",
    });
    return this.getJob(job.id)!;
  }

  resumeJob(id: string, actor = "user"): Job {
    const job = this.updateJob(id, { status: "queued" });
    this.appendJobEvent(id, {
      type: "job.resumed",
      message: "Job resumed",
      actor,
      status: "queued",
    });
    return this.getJob(job.id)!;
  }

  private requireJob(id: string): Job {
    const job = this.jobs.get(requiredString(id, "jobId"));
    if (!job) throw new Error("job not found");
    return job;
  }

  private transitionJob(job: Job, nextStatus: JobStatus, now: number, error?: string): void {
    assertJobStatus(nextStatus);
    if (TERMINAL_STATUSES.has(job.status)) throw new Error(`cannot transition terminal job from ${job.status}`);
    const allowed = JOB_TRANSITIONS[job.status] || [];
    if (!allowed.includes(nextStatus)) throw new Error(`illegal job status transition ${job.status} -> ${nextStatus}`);
    const previous = job.status;
    job.status = nextStatus;
    if (nextStatus === "running" && !job.startedAt) job.startedAt = now;
    if (TERMINAL_STATUSES.has(nextStatus)) job.endedAt = now;
    if (nextStatus === "failed" || nextStatus === "cancelled") job.error = cleanString(error) || job.error;
    if (nextStatus === "succeeded") job.error = undefined;
    job.events.push({
      id: newId("evt"),
      jobId: job.id,
      type: "job.status",
      message: `${previous} -> ${nextStatus}`,
      createdAt: now,
      actor: job.executor,
      status: nextStatus,
      data: { previousStatus: previous, nextStatus },
    });
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as Partial<JobCenterStoreFile>;
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      for (const job of jobs) {
        if (isValidJob(job)) this.jobs.set(job.id, normalizeLoadedJob(job));
      }
    } catch {
      this.jobs.clear();
    }
  }

  private persist(): void {
    const data: JobCenterStoreFile = {
      schemaVersion: JOB_CENTER_SCHEMA_VERSION,
      jobs: Array.from(this.jobs.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    };
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(this.storePath, 0o600);
    } catch {
      /* best-effort on filesystems without chmod support */
    }
  }
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

export function assertJobStatus(value: unknown): asserts value is JobStatus {
  if (!isJobStatus(value)) throw new Error("invalid job status");
}

function normalizeTask(input: Partial<Task> & { title: string }, now: number, index: number): Task {
  const status = input.status || "queued";
  assertJobStatus(status);
  return {
    id: cleanString(input.id) || newId(`task-${index + 1}`),
    title: requiredString(input.title, "task.title"),
    status,
    description: cleanString(input.description) || undefined,
    assignee: cleanString(input.assignee) || undefined,
    executor: cleanString(input.executor) || undefined,
    createdAt: numberOr(input.createdAt, now),
    startedAt: optionalNumber(input.startedAt),
    endedAt: optionalNumber(input.endedAt),
    error: cleanString(input.error) || undefined,
    steps: Array.isArray(input.steps) ? input.steps.map((step, stepIndex) => normalizeStep(step, now, stepIndex)) : [],
    artifacts: stringArray(input.artifacts),
    gateResults: stringArray(input.gateResults),
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeStep(input: Partial<TaskStep>, now: number, index: number): TaskStep {
  const status = input.status || "queued";
  assertJobStatus(status);
  return {
    id: cleanString(input.id) || newId(`step-${index + 1}`),
    title: requiredString(input.title || `Step ${index + 1}`, "step.title"),
    status,
    executor: cleanString(input.executor) || undefined,
    command: cleanString(input.command) || undefined,
    startedAt: optionalNumber(input.startedAt),
    endedAt: optionalNumber(input.endedAt),
    error: cleanString(input.error) || undefined,
    artifacts: stringArray(input.artifacts),
    gateResults: stringArray(input.gateResults),
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeEvent(jobId: string, input: JobEventInput, now: number): JobEvent {
  return {
    id: newId("evt"),
    jobId,
    type: requiredString(input.type, "event.type"),
    message: requiredString(input.message, "event.message"),
    createdAt: now,
    actor: cleanString(input.actor) || undefined,
    taskId: cleanString(input.taskId) || undefined,
    stepId: cleanString(input.stepId) || undefined,
    status: input.status,
    data: sanitizeMetadata(input.data),
  };
}

function normalizeArtifact(input: ArtifactInput, now: number, roots: ArtifactRoot[]): Artifact {
  const artifactPath = requiredString(input.path, "artifact.path");
  assertArtifactPath(artifactPath, roots);
  return {
    id: newId("artifact"),
    type: requiredString(input.type, "artifact.type"),
    path: artifactPath,
    name: cleanString(input.name) || path.basename(artifactPath),
    mimeType: cleanString(input.mimeType) || undefined,
    size: optionalNumber(input.size),
    sha256: validateSha256(input.sha256),
    createdAt: now,
    producedBy: input.producedBy && typeof input.producedBy === "object" ? {
      taskId: cleanString(input.producedBy.taskId) || undefined,
      stepId: cleanString(input.producedBy.stepId) || undefined,
      executor: cleanString(input.producedBy.executor) || undefined,
    } : undefined,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeGateResult(input: GateResultInput, now: number): GateResult {
  if (!(GATE_STATUSES as readonly string[]).includes(input.status)) throw new Error("invalid gate status");
  return {
    id: newId("gate"),
    gate: requiredString(input.gate, "gate"),
    status: input.status,
    createdAt: now,
    message: cleanString(input.message) || undefined,
    score: optionalNumber(input.score),
    taskId: cleanString(input.taskId) || undefined,
    stepId: cleanString(input.stepId) || undefined,
    artifacts: stringArray(input.artifacts),
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeApprovalRecord(input: ApprovalRecordInput, now: number): ApprovalRecord {
  if (!["requested", "approved", "denied", "expired"].includes(input.status)) throw new Error("invalid approval status");
  const decided = input.status === "approved" || input.status === "denied" || input.status === "expired";
  return {
    id: newId("approval"),
    status: input.status,
    requestedAt: now,
    decidedAt: decided ? now : undefined,
    requestedBy: cleanString(input.requestedBy) || undefined,
    decidedBy: cleanString(input.decidedBy) || undefined,
    scope: cleanString(input.scope) || undefined,
    reason: cleanString(input.reason) || undefined,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function assertArtifactPath(artifactPath: string, roots: ArtifactRoot[]): void {
  if (!path.isAbsolute(artifactPath) || roots.length === 0) return;
  const target = realOrResolve(artifactPath);
  const allowed = roots
    .map((root) => typeof root === "function" ? root() : root)
    .filter((root): root is string => typeof root === "string" && root.length > 0)
    .map((root) => realOrResolve(root));
  if (!allowed.some((root) => pathInside(root, target))) {
    throw new Error("artifact path escapes allowed roots");
  }
}

function pathInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function realOrResolve(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isValidJob(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<Job>;
  return typeof job.id === "string"
    && typeof job.title === "string"
    && isJobStatus(job.status)
    && Array.isArray(job.events)
    && Array.isArray(job.artifacts)
    && Array.isArray(job.gateResults)
    && Array.isArray(job.tasks);
}

function findStep(job: Job, stepId: string): TaskStep | undefined {
  for (const task of job.tasks) {
    const step = task.steps.find((item) => item.id === stepId);
    if (step) return step;
  }
  return undefined;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneJob(job: Job): Job {
  return clone(job);
}

function normalizeLoadedJob(job: Job): Job {
  const normalized = cloneJob(job);
  normalized.approvals = Array.isArray(normalized.approvals) ? normalized.approvals : [];
  return normalized;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredString(value: unknown, field: string): string {
  const text = cleanString(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return optionalNumber(value) ?? fallback;
}

function safeNow(value: unknown): number {
  return optionalNumber(value) ?? Date.now();
}

function validateSha256(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = cleanString(value);
  if (!/^[a-fA-F0-9]{64}$/.test(text)) throw new Error("artifact sha256 must be 64 hex characters");
  return text.toLowerCase();
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
