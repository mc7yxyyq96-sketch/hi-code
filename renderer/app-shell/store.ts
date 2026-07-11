export interface ShellState {
  activeRouteId: string;
  activeNavId: string;
  drawerOpen: boolean;
  compatibilityError: string;
}

export interface ShellStore {
  getSnapshot(): Readonly<ShellState>;
  subscribe(listener: () => void): () => void;
  setActiveRoute(routeId: string, navId: string): void;
  setDrawerOpen(open: boolean): void;
  setCompatibilityError(message: string): void;
}

const DEFAULT_STATE: ShellState = {
  activeRouteId: "home",
  activeNavId: "newChat",
  drawerOpen: false,
  compatibilityError: "",
};

export function createShellStore(initial: Partial<ShellState> = {}): ShellStore {
  let state: Readonly<ShellState> = Object.freeze({ ...DEFAULT_STATE, ...initial });
  const listeners = new Set<() => void>();

  const update = (patch: Partial<ShellState>) => {
    const next = { ...state, ...patch };
    if (
      next.activeRouteId === state.activeRouteId &&
      next.activeNavId === state.activeNavId &&
      next.drawerOpen === state.drawerOpen &&
      next.compatibilityError === state.compatibilityError
    ) return;
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setActiveRoute(routeId: string, navId: string) {
      update({ activeRouteId: routeId, activeNavId: navId, drawerOpen: false, compatibilityError: "" });
    },
    setDrawerOpen(open: boolean) {
      update({ drawerOpen: Boolean(open) });
    },
    setCompatibilityError(message: string) {
      update({ compatibilityError: String(message || "") });
    },
  });
}
