import { DEFAULT_ROUTE_REGISTRY, type ShellRouteDefinition, type ShellRouteRegistry } from "./contracts.ts";
import type { ShellStore } from "./store.ts";

interface ClassListLike {
  toggle(token: string, force?: boolean): boolean;
}

interface ElementLike {
  id: string;
  className: string;
  classList: ClassListLike;
  dataset?: Record<string, string> | DOMStringMap;
  click?: () => void;
}

interface DocumentLike {
  getElementById(id: string): ElementLike | null;
  querySelectorAll(selector: string): Iterable<ElementLike> | ArrayLike<ElementLike>;
}

export interface LegacyRouteRequest {
  route: string;
  mainClass: string;
  activeNav: string;
}

export interface AppliedLegacyRoute {
  routeId: string;
  panelId: string;
  navId: string;
}

export class ShellCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellCompatibilityError";
  }
}

function asElements(value: Iterable<ElementLike> | ArrayLike<ElementLike>) {
  return Array.from(value as ArrayLike<ElementLike>);
}

export class LegacyPanelAdapter {
  readonly #document: DocumentLike;
  readonly #store: ShellStore;
  readonly #registry: ShellRouteRegistry;

  constructor(options: { document: DocumentLike; store: ShellStore; registry?: ShellRouteRegistry }) {
    this.#document = options.document;
    this.#store = options.store;
    this.#registry = options.registry ?? DEFAULT_ROUTE_REGISTRY;
  }

  validate() {
    const required = new Set(["app", "main", "appShellMount"]);
    for (const route of this.#registry.list()) {
      required.add(route.panelId);
      required.add(route.navId);
      if (route.triggerId) required.add(route.triggerId);
    }
    const missing = [...required].filter((id) => !this.#document.getElementById(id));
    if (missing.length) {
      const message = `Legacy App Shell is missing required element${missing.length === 1 ? "" : "s"}: ${missing.map((id) => `#${id}`).join(", ")}`;
      this.#store.setCompatibilityError(message);
      throw new ShellCompatibilityError(message);
    }
  }

  applyLegacyRoute(request: LegacyRouteRequest): AppliedLegacyRoute {
    const route = this.#registry.resolveLegacy(request.route, request.activeNav);
    if (!route) return this.#fail(`Unknown legacy route mapping: ${request.route} + ${request.activeNav}`);
    if (request.mainClass !== route.mainClass) {
      return this.#fail(`Legacy route ${route.id} expected main class ${route.mainClass}, received ${request.mainClass}`);
    }

    const main = this.#requireElement("main");
    main.className = route.mainClass;
    const panelIds = new Set(this.#registry.list().map((candidate) => candidate.panelId));
    for (const panelId of panelIds) this.#requireElement(panelId).classList.toggle("hidden", panelId !== route.panelId);
    for (const nav of asElements(this.#document.querySelectorAll(".nav-row"))) nav.classList.toggle("active", nav.id === route.navId);

    const app = this.#requireElement("app");
    if (app.dataset) app.dataset.shellRoute = route.id;
    const mount = this.#requireElement("appShellMount");
    if (mount.dataset) mount.dataset.activeRoute = route.id;
    this.#store.setActiveRoute(route.id, route.navId);
    return { routeId: route.id, panelId: route.panelId, navId: route.navId };
  }

  requestRoute(routeId: string) {
    const route = this.#registry.get(routeId);
    if (!route) return this.#fail(`Unknown App Shell route: ${routeId}`);
    if (!route.directNavigable || !route.triggerId) return this.#fail(`Route ${route.id} is not directly navigable`);
    const trigger = this.#requireElement(route.triggerId);
    if (typeof trigger.click !== "function") return this.#fail(`Route ${route.id} trigger #${route.triggerId} is not actionable`);
    this.#store.setDrawerOpen(false);
    trigger.click();
  }

  navigableRoutes(): readonly ShellRouteDefinition[] {
    return this.#registry.list().filter((route) => route.directNavigable && Boolean(route.triggerId));
  }

  #requireElement(id: string) {
    const element = this.#document.getElementById(id);
    if (element) return element;
    return this.#fail(`Legacy App Shell is missing required element #${id}`);
  }

  #fail(message: string): never {
    this.#store.setCompatibilityError(message);
    throw new ShellCompatibilityError(message);
  }
}
