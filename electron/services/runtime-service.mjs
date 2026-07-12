import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createRuntimeService({ getRuntime, inputQueue, askResolvers, send, jobStore = null, getCwd = null }) {
  if (typeof getRuntime !== "function") throw new Error("runtime-service requires getRuntime");
  if (!inputQueue) throw new Error("runtime-service requires inputQueue");
  if (!askResolvers) throw new Error("runtime-service requires askResolvers");
  if (typeof send !== "function") throw new Error("runtime-service requires send");

  return {
    enqueueInput(input, context = {}) {
      if (!getRuntime()) return { ok: false, error: "runtime not ready" };
      const normalized = normalizeRuntimeInput(input);
      if (!normalized.ok) return normalized;
      const { text: value, attachmentIds, executionMode } = normalized;
      const source = context.source === "steer" ? "steer" : "runtime_queue";
      let jobCenterJob = null;
      if (jobStore) {
        try {
          jobCenterJob = jobStore.createJob({
            title: summarizeRuntimeInput(value),
            source,
            trigger: source === "steer" ? "renderer.steer" : "renderer.input",
            actor: "user",
            executor: "hicode-runtime",
            cwd: typeof getCwd === "function" ? getCwd() : undefined,
            tasks: [{ title: "Run runtime input", executor: "hicode-runtime" }],
            metadata: {
              inputPreview: summarizeRuntimeInput(value),
              attachmentCount: attachmentIds.length,
              executionMode,
              ...(context.steeredFromRuntimeJobId ? { steeredFromRuntimeJobId: context.steeredFromRuntimeJobId } : {}),
            },
          });
        } catch (err) {
          send("output", `\nJob Center error: ${err?.message || String(err)}\n`);
          return { ok: false, error: "job center create failed" };
        }
      }
      const metadata = {
        ...(jobCenterJob ? { jobCenterId: jobCenterJob.id } : {}),
        source,
        executionMode,
        ...(context.steeredFromRuntimeJobId ? { steeredFromRuntimeJobId: context.steeredFromRuntimeJobId } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      };
      const runtimeJob = context.position === "next" && typeof inputQueue.enqueueNext === "function"
        ? inputQueue.enqueueNext(value, metadata)
        : inputQueue.enqueue(value, metadata);
      return { ok: true, jobId: runtimeJob.id, jobCenterId: jobCenterJob?.id };
    },

    steerInput(input) {
      const active = inputQueue.state().running;
      if (!active) return { ok: false, error: "没有正在运行的任务可调整" };
      const normalized = normalizeRuntimeInput(input);
      if (!normalized.ok) return normalized;
      const interrupted = interruptActiveRuntime(getRuntime(), askResolvers);
      if (!interrupted) return { ok: false, error: "当前任务无法中断，调整指令未排队" };
      const activeJobCenterId = active.metadata?.jobCenterId;
      if (jobStore && typeof activeJobCenterId === "string") {
        try {
          jobStore.appendJobEvent(activeJobCenterId, {
            type: "runtime.steer.requested",
            message: summarizeRuntimeInput(normalized.text),
            actor: "user",
            status: "succeeded",
            data: { runtimeJobId: active.id, executionMode: normalized.executionMode },
          });
        } catch {
          // Audit append failure must not duplicate or replay a steer request.
        }
      }
      const queued = this.enqueueInput(normalized, {
        source: "steer",
        position: "next",
        steeredFromRuntimeJobId: active.id,
      });
      return queued.ok ? { ...queued, interrupted: true, steeredFromRuntimeJobId: active.id } : queued;
    },

    answerAsk(payload = {}) {
      const { id, value } = ipcObject(payload);
      const resolver = askResolvers.get(id);
      if (!resolver) return { ok: false, error: "ask resolver not found" };
      askResolvers.delete(id);
      resolver(ipcString(value));
      return { ok: true };
    },

    interrupt() {
      if (interruptActiveRuntime(getRuntime(), askResolvers)) {
        send("output", "\n⏹ 已请求停止当前任务。\n");
        return { ok: true, interrupted: true };
      }
      if (inputQueue.state().queued.length) {
        const count = inputQueue.clearQueued();
        send("output", `\n⏹ 已清空 ${count} 条待执行任务。\n`);
        return { ok: true, cleared: count };
      }
      return { ok: true, interrupted: false };
    },
  };
}

function normalizeRuntimeInput(input) {
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return { ok: false, error: "input is empty" };
    if (text.length > 200_000) return { ok: false, error: "input is too large" };
    return { ok: true, text, attachmentIds: [], executionMode: "default" };
  }
  const payload = ipcObject(input);
  const attachmentIds = Array.isArray(payload.attachmentIds)
    ? payload.attachmentIds.filter((id) => typeof id === "string")
    : [];
  if (!Array.isArray(payload.attachmentIds) && payload.attachmentIds !== undefined) return { ok: false, error: "attachmentIds must be an array" };
  if (attachmentIds.length > 8 || attachmentIds.length !== new Set(attachmentIds).size) return { ok: false, error: "attachmentIds must contain at most 8 unique ids" };
  if (attachmentIds.some((id) => !/^att-[a-f0-9-]{36}$/.test(id))) return { ok: false, error: "attachment id is invalid" };
  const text = ipcString(payload.text).trim() || (attachmentIds.length ? "请分析这些附件。" : "");
  if (!text) return { ok: false, error: "input is empty" };
  if (text.length > 200_000) return { ok: false, error: "input is too large" };
  const executionMode = payload.executionMode === "plan"
    ? "plan"
    : payload.executionMode === undefined || payload.executionMode === "default"
      ? "default"
      : "";
  if (!executionMode) return { ok: false, error: "executionMode must be default or plan" };
  return { ok: true, text, attachmentIds, executionMode };
}

function interruptActiveRuntime(runtime, askResolvers) {
  const stopped = runtime?.abort() === true;
  let deniedAsk = false;
  for (const [, resolve] of askResolvers) {
    resolve("n");
    deniedAsk = true;
  }
  askResolvers.clear();
  return stopped || deniedAsk;
}

function summarizeRuntimeInput(input) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text || "Runtime input";
}

export function registerRuntimeIpcEvents({ ipcMain, register = null, runtime }) {
  if (!ipcMain) throw new Error("registerRuntimeIpcEvents requires ipcMain");
  if (!runtime) throw new Error("registerRuntimeIpcEvents requires runtime service");

  register?.handle("runtime:enqueue", (_event, input) => runtime.enqueueInput(input));
  register?.handle("runtime:steer", (_event, input) => runtime.steerInput(input));

  ipcMain.on("input", (_event, text) => {
    runtime.enqueueInput(text);
  });
  ipcMain.on("ask-response", (_event, payload = {}) => {
    runtime.answerAsk(payload);
  });
  ipcMain.on("interrupt", () => {
    runtime.interrupt();
  });
}
