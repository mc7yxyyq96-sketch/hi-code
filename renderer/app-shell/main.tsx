import { createRoot, type Root } from "react-dom/client";
import { AppShell } from "./AppShell.tsx";
import { LegacyPanelAdapter, type AppliedLegacyRoute, type LegacyRouteRequest } from "./legacy-panel-adapter.ts";
import { createShellStore } from "./store.ts";
import { createWorkspaceBridge, WorkspaceController, type WorkspaceBridge } from "./workspace/controller.ts";
import { createWorkspaceStore } from "./workspace/store.ts";
import { WorkspacePortals } from "./workspace/WorkspacePortals.tsx";
import type { CodeEditorFactory } from "./editor/code-editor.ts";
import { buildRevisionRequest } from "./workspace/review.ts";
import { createTerminalApi, type RawTerminalBridge } from "./terminal/api.ts";
import { TerminalPortal } from "./terminal/TerminalPortal.tsx";
import { createPreviewApi, type RawPreviewBridge } from "./preview/api.ts";
import { PreviewPortal } from "./preview/PreviewPortal.tsx";
import { HICODE_DESIGN_SYSTEM } from "./design-system.ts";

export interface HiCodeAppShellBridge {
  readonly ownsNavigation: true;
  applyLegacyRoute(request: LegacyRouteRequest): AppliedLegacyRoute;
  requestRoute(routeId: string): void;
  setDrawerOpen(open: boolean): void;
  readonly workspace: WorkspaceBridge;
  readonly editor: Readonly<{ load(): Promise<CodeEditorFactory> }>;
  readonly review: Readonly<{ buildRevisionRequest: typeof buildRevisionRequest }>;
  readonly terminal: Readonly<{ focus(): void }>;
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
  const workspaceStore = createWorkspaceStore();
  const workspaceController = new WorkspaceController(workspaceStore);
  const workspace = createWorkspaceBridge(workspaceStore, workspaceController);
  let editorFactoryPromise: Promise<CodeEditorFactory> | null = null;
  const editor = Object.freeze({
    load() {
      editorFactoryPromise ||= import("./editor/code-editor.ts").then((module) => module.createCodeEditorFactory());
      return editorFactoryPromise;
    },
  });
  const terminalApi = createTerminalApi((window as Window & { hicode?: RawTerminalBridge }).hicode);
  const previewApi = createPreviewApi((window as Window & { hicode?: RawPreviewBridge }).hicode);

  window.hicodeAppShell = Object.freeze({
    ownsNavigation: true as const,
    applyLegacyRoute: (request: LegacyRouteRequest) => adapter.applyLegacyRoute(request),
    requestRoute: (routeId: string) => adapter.requestRoute(routeId),
    setDrawerOpen: (open: boolean) => store.setDrawerOpen(open),
    workspace,
    editor,
    review: Object.freeze({ buildRevisionRequest }),
    terminal: Object.freeze({
      focus() { window.dispatchEvent(new Event("hicode:terminal-focus")); },
    }),
  });

  mountedRoot = createRoot(mount);
  mountedRoot.render(
    <>
      <AppShell adapter={adapter} store={store} />
      <WorkspacePortals controller={workspaceController} store={workspaceStore} />
      <TerminalPortal api={terminalApi} />
      <PreviewPortal api={previewApi} />
    </>,
  );
  adapter.applyLegacyRoute({ route: "home", mainClass: "home", activeNav: "newChat" });
  mount.dataset.appShell = "react-typescript-vite";
  mount.dataset.designSystem = HICODE_DESIGN_SYSTEM.id;
  mount.dataset.supportedWidths = HICODE_DESIGN_SYSTEM.supportedWidths.join(",");

  return Object.freeze({
    unmount() {
      mountedRoot?.unmount();
      mountedRoot = null;
      delete window.hicodeAppShell;
    },
  });
}
