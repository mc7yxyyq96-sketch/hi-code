import { useEffect, useRef, useSyncExternalStore } from "react";
import type { LegacyPanelAdapter } from "./legacy-panel-adapter.ts";
import type { ShellStore } from "./store.ts";

interface AppShellProps {
  adapter: LegacyPanelAdapter;
  store: ShellStore;
}

export function AppShell({ adapter, store }: AppShellProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRouteRef = useRef<HTMLButtonElement>(null);
  const routes = adapter.navigableRoutes();
  const current = routes.find((route) => route.id === state.activeRouteId);

  useEffect(() => {
    if (!state.drawerOpen) return undefined;
    firstRouteRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      store.setDrawerOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state.drawerOpen, store]);

  const requestRoute = (routeId: string) => {
    try {
      adapter.requestRoute(routeId);
    } catch {
      // The adapter writes an actionable error into the shared store.
    }
  };

  return (
    <div className="app-shell-compact" data-testid="react-app-shell">
      <button
        ref={triggerRef}
        className="app-shell-nav-trigger"
        type="button"
        aria-label={`打开工作区导航${current ? `，当前：${current.label}` : ""}`}
        aria-controls="appShellDrawer"
        aria-expanded={state.drawerOpen}
        title="工作区导航"
        onClick={() => store.setDrawerOpen(!state.drawerOpen)}
      >
        <span className="i-stack" aria-hidden="true" />
      </button>

      {state.drawerOpen ? (
        <>
          <button
            className="app-shell-drawer-backdrop"
            type="button"
            aria-label="关闭工作区导航"
            onClick={() => store.setDrawerOpen(false)}
          />
          <aside id="appShellDrawer" className="app-shell-drawer" aria-label="工作区导航">
            <header className="app-shell-drawer-head">
              <div>
                <strong>工作区</strong>
                <span>{current?.label || "Hi Code"}</span>
              </div>
              <button
                className="app-shell-drawer-close"
                type="button"
                aria-label="关闭工作区导航"
                title="关闭"
                onClick={() => store.setDrawerOpen(false)}
              >
                ×
              </button>
            </header>
            <nav className="app-shell-route-list">
              {routes.map((route, index) => (
                <button
                  ref={index === 0 ? firstRouteRef : undefined}
                  key={route.id}
                  className={`app-shell-route${state.activeRouteId === route.id ? " active" : ""}`}
                  type="button"
                  aria-current={state.activeRouteId === route.id ? "page" : undefined}
                  onClick={() => requestRoute(route.id)}
                >
                  <span className={route.iconClass} aria-hidden="true" />
                  <span>{route.label}</span>
                </button>
              ))}
            </nav>
          </aside>
        </>
      ) : null}

      {state.compatibilityError ? (
        <div className="app-shell-error" role="alert">
          <span>{state.compatibilityError}</span>
          <button type="button" aria-label="关闭错误提示" onClick={() => store.setCompatibilityError("")}>×</button>
        </div>
      ) : null}
    </div>
  );
}
