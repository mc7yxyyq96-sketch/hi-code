export function createQueueService({ inputQueue }) {
  if (!inputQueue) throw new Error("queue-service requires inputQueue");
  return {
    clearRuntimeQueue() {
      const count = inputQueue.clearQueued();
      return { ok: true, count, state: inputQueue.state() };
    },
  };
}

export function registerQueueIpc({ register, queue }) {
  if (!register) throw new Error("registerQueueIpc requires register");
  if (!queue) throw new Error("registerQueueIpc requires queue service");
  register.handle("runtime-queue:clear", () => queue.clearRuntimeQueue());
}
