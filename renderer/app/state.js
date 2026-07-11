const initialState = {
  busy: false,
  activeAssistantMessageId: null,
  agentRaw: "",
  yolo: false,
  cwd: "",
  inChat: false,
  currentModel: { model: "", baseURL: "", capabilities: null },
  queuedInputs: [],
  runtimeQueueState: { running: null, queued: [] },
  cfgText: "",
  selectedProvider: "deepseek",
  authMode: "login",
  currentCapability: "",
  capabilityCache: null,
  storeCache: null,
  storeCacheKey: "",
  storeKind: "all",
  storeCategory: "all",
  storeQuery: "",
  storeMessage: "",
  storeSearchTimer: null,
  storeRequestSeq: 0,
  storePage: 1,
  pendingStoreInstall: null,
  toolEvents: [],
  recoverableTasks: [],
  diffs: [],
  selectedDiffId: null,
  showArchivedDiffs: false,
  runState: null,
  runTimer: null,
  runHideTimer: null,
  gitState: null,
  selectedGitPath: "",
  selectedGitStaged: false,
  storeSearchComposing: false,
  composerComposing: false,
  allSessions: [],
  fileDir: "",
  menuIdx: 0,
};

const state = { ...initialState };
const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  if (!patch || typeof patch !== "object") return state;
  const previous = { ...state };
  Object.assign(state, patch);
  for (const listener of listeners) listener(state, previous);
  return state;
}

export function subscribe(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetState() {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, { ...initialState, queuedInputs: [], runtimeQueueState: { running: null, queued: [] } });
  for (const listener of listeners) listener(state, {});
  return state;
}
