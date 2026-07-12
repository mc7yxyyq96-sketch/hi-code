import fs from "node:fs";
import path from "node:path";

export type RuntimeJobStatus = "queued" | "running" | "done" | "error" | "canceled";

export interface RuntimeJob<T = string> {
  id: string;
  input: T;
  status: RuntimeJobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeJobQueueState<T = string> {
  running: RuntimeJob<T> | null;
  queued: RuntimeJob<T>[];
  history: RuntimeJob<T>[];
}

type JobHandler<T> = (job: RuntimeJob<T>) => Promise<void> | void;
type StateObserver<T> = (state: RuntimeJobQueueState<T>) => void;
type ErrorObserver<T> = (error: unknown, job: RuntimeJob<T>) => void;

export interface RuntimeJobQueueOptions {
  /** Number of completed/error/canceled jobs kept for Task Center style UI. */
  historyLimit?: number;
  /** Optional JSON file used to restore recent job history after app restart. */
  storePath?: string;
}

export class RuntimeJobQueue<T = string> {
  private nextId = 0;
  private queue: RuntimeJob<T>[] = [];
  private running: RuntimeJob<T> | null = null;
  private history: RuntimeJob<T>[] = [];
  private draining = false;
  private idleResolvers: Array<() => void> = [];
  private readonly historyLimit: number;
  private readonly storePath?: string;

  constructor(
    private readonly handler: JobHandler<T>,
    private readonly onState?: StateObserver<T>,
    private readonly onError?: ErrorObserver<T>,
    options: RuntimeJobQueueOptions = {},
  ) {
    this.historyLimit = Math.max(0, options.historyLimit ?? 50);
    this.storePath = options.storePath;
    this.history = this.loadHistory();
  }

  enqueue(input: T, metadata?: Record<string, unknown>): RuntimeJob<T> {
    return this.enqueueAt(input, metadata, "tail");
  }

  /** Queue work immediately after the active job without preempting it. */
  enqueueNext(input: T, metadata?: Record<string, unknown>): RuntimeJob<T> {
    return this.enqueueAt(input, metadata, "next");
  }

  private enqueueAt(input: T, metadata: Record<string, unknown> | undefined, position: "tail" | "next"): RuntimeJob<T> {
    const job: RuntimeJob<T> = {
      id: `job-${Date.now().toString(36)}-${++this.nextId}`,
      input,
      status: "queued",
      queuedAt: Date.now(),
      metadata,
    };
    if (position === "next") this.queue.unshift(job);
    else this.queue.push(job);
    this.emitState();
    void this.drain();
    return { ...job };
  }

  clearQueued(): number {
    const canceledAt = Date.now();
    const canceled = this.queue.map((job) => ({
      ...job,
      status: "canceled" as const,
      finishedAt: canceledAt,
      error: "cleared before running",
    }));
    const count = canceled.length;
    this.queue = [];
    this.recordHistory(canceled);
    this.emitState();
    this.resolveIdleIfNeeded();
    return count;
  }

  /** Mark the active job as user-interrupted without pretending the handler failed. */
  interruptRunning(reason = "interrupted by user"): RuntimeJob<T> | null {
    if (!this.running || this.running.status !== "running") return null;
    this.running.status = "canceled";
    this.running.error = reason;
    this.running.metadata = { ...(this.running.metadata || {}), interrupted: true };
    this.emitState();
    return { ...this.running, metadata: { ...this.running.metadata } };
  }

  state(): RuntimeJobQueueState<T> {
    return {
      running: this.running ? { ...this.running } : null,
      queued: this.queue.map((job) => ({ ...job })),
      history: this.history.map((job) => ({ ...job })),
    };
  }

  idle(): Promise<void> {
    if (!this.draining && !this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        this.running = job;
        job.status = "running";
        job.startedAt = Date.now();
        this.emitState();

        try {
          await this.handler(job);
          if (!isCanceledJob(job)) job.status = "done";
        } catch (error) {
          if (!isCanceledJob(job)) {
            job.status = "error";
            job.error = error instanceof Error ? error.message : String(error);
            this.onError?.(error, job);
          }
        } finally {
          job.finishedAt = Date.now();
          this.running = null;
          this.recordHistory([job]);
          this.emitState();
        }
      }
    } finally {
      this.draining = false;
      this.resolveIdleIfNeeded();
    }
  }

  private emitState(): void {
    this.onState?.(this.state());
  }

  private recordHistory(jobs: RuntimeJob<T>[]): void {
    if (!jobs.length || this.historyLimit <= 0) return;
    this.history = [...jobs.map((job) => ({ ...job })), ...this.history].slice(0, this.historyLimit);
    this.persistHistory();
  }

  private loadHistory(): RuntimeJob<T>[] {
    if (!this.storePath || this.historyLimit <= 0) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8"));
      const history = Array.isArray(parsed?.history) ? parsed.history : [];
      return history
        .filter((job: Partial<RuntimeJob<T>>) => job && typeof job.id === "string" && typeof job.status === "string")
        .slice(0, this.historyLimit);
    } catch {
      return [];
    }
  }

  private persistHistory(): void {
    if (!this.storePath) return;
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.storePath, JSON.stringify({ history: this.history }, null, 2), { mode: 0o600 });
    } catch {
      /* persistence should never break job execution */
    }
  }

  private resolveIdleIfNeeded(): void {
    if (this.draining || this.running || this.queue.length) return;
    const resolvers = this.idleResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}

function isCanceledJob<T>(job: RuntimeJob<T>): boolean {
  return job.status === "canceled";
}
