import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createRuntimeService({ getRuntime, inputQueue, askResolvers, send, jobStore = null, getCwd = null }) {
  if (typeof getRuntime !== "function") throw new Error("runtime-service requires getRuntime");
  if (!inputQueue) throw new Error("runtime-service requires inputQueue");
  if (!askResolvers) throw new Error("runtime-service requires askResolvers");
  if (typeof send !== "function") throw new Error("runtime-service requires send");

  return {
    enqueueInput(input) {
      if (!getRuntime()) return { ok: false, error: "runtime not ready" };
      const normalized = normalizeRuntimeInput(input);
      if (!normalized.ok) return normalized;
      const { text: value, attachmentIds } = normalized;
      let jobCenterJob = null;
      if (jobStore) {
        try {
          jobCenterJob = jobStore.createJob({
            title: summarizeRuntimeInput(value),
            source: "runtime_queue",
            trigger: "renderer.input",
            actor: "user",
            executor: "hicode-runtime",
            cwd: typeof getCwd === "function" ? getCwd() : undefined,
            tasks: [{ title: "Run runtime input", executor: "hicode-runtime" }],
            metadata: { inputPreview: summarizeRuntimeInput(value), attachmentCount: attachmentIds.length },
          });
        } catch (err) {
          send("output", `\nJob Center error: ${err?.message || String(err)}\n`);
          return { ok: false, error: "job center create failed" };
        }
      }
      const metadata = {
        ...(jobCenterJob ? { jobCenterId: jobCenterJob.id } : {}),
        source: "runtime_queue",
        ...(attachmentIds.length ? { attachmentIds } : {}),
      };
      const runtimeJob = inputQueue.enqueue(value, metadata);
      return { ok: true, jobId: runtimeJob.id, jobCenterId: jobCenterJob?.id };
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
      const runtime = getRuntime();
      const stopped = runtime?.abort();
      let deniedAsk = false;
      for (const [, resolve] of askResolvers) {
        resolve("n");
        deniedAsk = true;
      }
      askResolvers.clear();
      if (stopped || deniedAsk) {
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
    return { ok: true, text, attachmentIds: [] };
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
  return { ok: true, text, attachmentIds };
}

function summarizeRuntimeInput(input) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text || "Runtime input";
}

export function registerRuntimeIpcEvents({ ipcMain, runtime }) {
  if (!ipcMain) throw new Error("registerRuntimeIpcEvents requires ipcMain");
  if (!runtime) throw new Error("registerRuntimeIpcEvents requires runtime service");

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
