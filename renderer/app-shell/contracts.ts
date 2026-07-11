export type ShellRouteId =
  | "home"
  | "chat"
  | "store"
  | "plugins"
  | "skills"
  | "agents"
  | "mcp"
  | "commands"
  | "git"
  | "jobs"
  | "arena"
  | "industrial";

export interface ShellRouteDefinition {
  id: ShellRouteId | string;
  label: string;
  panelId: string;
  mainClass: string;
  navId: string;
  triggerId: string | null;
  iconClass: string;
  directNavigable: boolean;
}

export interface ShellRouteRegistry {
  get(id: string): ShellRouteDefinition | undefined;
  list(): readonly ShellRouteDefinition[];
  resolveLegacy(panelId: string, navId: string): ShellRouteDefinition | undefined;
}

export const DEFAULT_SHELL_ROUTES = Object.freeze([
  { id: "home", label: "新对话", panelId: "home", mainClass: "home", navId: "newChat", triggerId: "newChat", iconClass: "i-edit", directNavigable: true },
  { id: "chat", label: "当前对话", panelId: "chatview", mainClass: "chatting", navId: "newChat", triggerId: null, iconClass: "i-chat", directNavigable: false },
  { id: "store", label: "商城", panelId: "capabilityView", mainClass: "capability", navId: "storeBtn", triggerId: "storeBtn", iconClass: "i-store", directNavigable: true },
  { id: "plugins", label: "插件", panelId: "capabilityView", mainClass: "capability", navId: "pluginsBtn", triggerId: "pluginsBtn", iconClass: "i-plug", directNavigable: true },
  { id: "skills", label: "技能", panelId: "capabilityView", mainClass: "capability", navId: "skillsBtn", triggerId: "skillsBtn", iconClass: "i-spark", directNavigable: true },
  { id: "agents", label: "智能体", panelId: "capabilityView", mainClass: "capability", navId: "agentsBtn", triggerId: "agentsBtn", iconClass: "i-users", directNavigable: true },
  { id: "mcp", label: "MCP", panelId: "capabilityView", mainClass: "capability", navId: "mcpBtn", triggerId: "mcpBtn", iconClass: "i-network", directNavigable: true },
  { id: "commands", label: "命令", panelId: "commandView", mainClass: "commands", navId: "cmdBtn", triggerId: "cmdBtn", iconClass: "i-command", directNavigable: true },
  { id: "git", label: "Git", panelId: "gitView", mainClass: "git", navId: "gitBtn", triggerId: "gitBtn", iconClass: "i-git", directNavigable: true },
  { id: "jobs", label: "任务", panelId: "jobView", mainClass: "jobs", navId: "jobsBtn", triggerId: "jobsBtn", iconClass: "i-stack", directNavigable: true },
  { id: "arena", label: "竞技场", panelId: "arenaView", mainClass: "arena", navId: "arenaBtn", triggerId: "arenaBtn", iconClass: "i-scale", directNavigable: true },
  { id: "industrial", label: "工业项目", panelId: "industrialView", mainClass: "industrial", navId: "industrialBtn", triggerId: "industrialBtn", iconClass: "i-folder", directNavigable: true },
] satisfies readonly ShellRouteDefinition[]);

function legacyKey(panelId: string, navId: string) {
  return `${panelId}\u0000${navId}`;
}

export function createRouteRegistry(definitions: readonly ShellRouteDefinition[]): ShellRouteRegistry {
  const routes = definitions.map((definition) => Object.freeze({ ...definition }));
  const byId = new Map<string, ShellRouteDefinition>();
  const byLegacy = new Map<string, ShellRouteDefinition>();

  for (const route of routes) {
    if (!route.id || !route.panelId || !route.mainClass || !route.navId || !route.label) {
      throw new Error(`Invalid shell route definition: ${JSON.stringify(route)}`);
    }
    if (byId.has(route.id)) throw new Error(`Duplicate route id: ${route.id}`);
    const key = legacyKey(route.panelId, route.navId);
    if (byLegacy.has(key)) throw new Error(`Duplicate legacy mapping: ${route.panelId} + ${route.navId}`);
    byId.set(route.id, route);
    byLegacy.set(key, route);
  }

  return Object.freeze({
    get: (id: string) => byId.get(id),
    list: () => routes,
    resolveLegacy: (panelId: string, navId: string) => byLegacy.get(legacyKey(panelId, navId)),
  });
}

export const DEFAULT_ROUTE_REGISTRY = createRouteRegistry(DEFAULT_SHELL_ROUTES);
