import { createRoot, type Root } from "react-dom/client";
import { AppShell } from "./AppShell.tsx";
import { LegacyPanelAdapter, type AppliedLegacyRoute, type LegacyRouteRequest } from "./legacy-panel-adapter.ts";
import { createShellStore } from "./store.ts";

export interface HiCodeAppShellBridge {
  readonly ownsNavigation: true;
  applyLegacyRoute(request: LegacyRouteRequest): AppliedLegacyRoute;
  requestRoute(routeId: string): void;
  setDrawerOpen(open: boolean): void;
}

declare global {
  interface Window {
    hicodeAppShell?: HiCodeAppShellBridge;
  }
}

let mountedRoot: Root | null = null;

export function mountHiCodeAppShell() {
  if (mountedRoot || window.hicodeAppShell) throw new Error("Hi Code App Shell is already mounted");
  const mount = document.getElementById("appShellMount");
  if (!mount) throw new Error("Hi Code App Shell mount #appShellMount is missing");

  const store = createShellStore({ activeRouteId: "home", activeNavId: "newChat" });
  const adapter = new LegacyPanelAdapter({ document, store });
  adapter.validate();

  window.hicodeAppShell = Object.freeze({
    ownsNavigation: true as const,
    applyLegacyRoute: (request: LegacyRouteRequest) => adapter.applyLegacyRoute(request),
    requestRoute: (routeId: string) => adapter.requestRoute(routeId),
    setDrawerOpen: (open: boolean) => store.setDrawerOpen(open),
  });

  mountedRoot = createRoot(mount);
  mountedRoot.render(<AppShell adapter={adapter} store={store} />);
  adapter.applyLegacyRoute({ route: "home", mainClass: "home", activeNav: "newChat" });
  mount.dataset.appShell = "react-typescript-vite";

  return Object.freeze({
    unmount() {
      mountedRoot?.unmount();
      mountedRoot = null;
      delete window.hicodeAppShell;
    },
  });
}
