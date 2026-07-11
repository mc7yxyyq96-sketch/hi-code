export type CommandSurface = "cli" | "tui" | "desktop" | "runtime";
export type CommandRoute = "shell" | "slash" | "native" | "agent";

export interface CommandDescriptor {
  id: string;
  route: CommandRoute;
  aliases?: string[];
  surfaces: CommandSurface[];
  priority?: number;
  description?: string;
  match?: (input: string, context: CommandResolveContext) => unknown | null | false;
}

export interface CommandResolveContext {
  surface: CommandSurface;
}

export type NativeCommandDescriptor = Omit<CommandDescriptor, "route"> & { route?: "native" };

export type CommandResolution =
  | { ok: true; route: CommandRoute; commandId: string; input: string; args: string; payload?: unknown }
  | { ok: false; route: "invalid"; code: string; message: string; input: string };

export class CommandRegistryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CommandRegistryError";
    this.code = code;
  }
}

export const DEFAULT_SLASH_COMMANDS = [
  { id: "help" },
  { id: "clear", aliases: ["reset"] },
  { id: "compact" },
  { id: "undo" },
  { id: "diff" },
  { id: "team" },
  { id: "build" },
  { id: "agent" },
  { id: "agents" },
  { id: "council" },
  { id: "debate" },
  { id: "models" },
  { id: "model" },
  { id: "mode" },
  { id: "yolo" },
  { id: "sessions" },
  { id: "resume" },
  { id: "mcp" },
  { id: "sandbox" },
  { id: "cost" },
  { id: "tools" },
  { id: "init" },
  { id: "cwd" },
  { id: "exit", aliases: ["quit"] },
] as const;

const ALL_SURFACES: CommandSurface[] = ["cli", "tui", "desktop", "runtime"];

export class CommandRegistry {
  private readonly descriptors = new Map<string, CommandDescriptor>();

  register(input: CommandDescriptor): CommandDescriptor {
    const descriptor = normalizeDescriptor(input);
    if (this.descriptors.has(descriptor.id)) throw new CommandRegistryError("command_id_conflict", `Command id is already registered: ${descriptor.id}`);
    if (descriptor.route === "slash") {
      for (const existing of this.descriptors.values()) {
        if (existing.route !== "slash" || !overlaps(existing.surfaces, descriptor.surfaces)) continue;
        const shared = slashNames(existing).find((alias) => slashNames(descriptor).includes(alias));
        if (shared) throw new CommandRegistryError("command_alias_conflict", `Slash command alias /${shared} is already registered.`);
      }
    }
    this.descriptors.set(descriptor.id, descriptor);
    return cloneDescriptor(descriptor);
  }

  list(surface?: CommandSurface): CommandDescriptor[] {
    return Array.from(this.descriptors.values())
      .filter((descriptor) => !surface || descriptor.surfaces.includes(surface))
      .map(cloneDescriptor)
      .sort((a, b) => a.route.localeCompare(b.route) || a.id.localeCompare(b.id));
  }

  listSlashCommands(surface: CommandSurface = "runtime"): string[] {
    return this.list(surface)
      .filter((descriptor) => descriptor.route === "slash")
      .map((descriptor) => `/${descriptor.id}`)
      .sort();
  }

  resolve(input: string, context: CommandResolveContext): CommandResolution {
    const raw = String(input ?? "");
    const text = raw.trim();
    const surface = validateSurface(context?.surface);
    const available = Array.from(this.descriptors.values()).filter((descriptor) => descriptor.surfaces.includes(surface));

    if (text.startsWith("!")) {
      const shell = available.find((descriptor) => descriptor.route === "shell");
      if (!shell) return invalid(raw, "command_surface_unsupported", "Shell commands are not available on this surface.");
      return { ok: true, route: "shell", commandId: shell.id, input: raw, args: text.slice(1) };
    }

    if (text.startsWith("/")) {
      const [token = "", ...rest] = text.slice(1).split(/\s+/);
      const alias = normalizeAlias(token);
      const descriptor = available.find((item) => item.route === "slash" && slashNames(item).includes(alias));
      if (!descriptor) return invalid(raw, "command_unknown", `Unknown command: /${alias || "(empty)"}`);
      return { ok: true, route: "slash", commandId: descriptor.id, input: raw, args: rest.join(" ") };
    }

    const nativeMatches: Array<{ descriptor: CommandDescriptor; payload: unknown }> = [];
    for (const descriptor of available.filter((item) => item.route === "native")) {
      let payload: unknown;
      try {
        payload = descriptor.match?.(text, { surface });
      } catch {
        return invalid(raw, "command_match_failed", `Native command matcher failed: ${descriptor.id}`);
      }
      if (payload !== null && payload !== false && payload !== undefined) nativeMatches.push({ descriptor, payload });
    }
    if (nativeMatches.length) {
      nativeMatches.sort((a, b) => (b.descriptor.priority || 0) - (a.descriptor.priority || 0) || a.descriptor.id.localeCompare(b.descriptor.id));
      const topPriority = nativeMatches[0].descriptor.priority || 0;
      const top = nativeMatches.filter((item) => (item.descriptor.priority || 0) === topPriority);
      if (top.length > 1) return invalid(raw, "command_route_conflict", `Command matches multiple native routes: ${top.map((item) => item.descriptor.id).join(", ")}`);
      return { ok: true, route: "native", commandId: top[0].descriptor.id, input: raw, args: "", payload: top[0].payload };
    }

    const agent = available.find((descriptor) => descriptor.route === "agent");
    if (!agent) return invalid(raw, "command_route_missing", "No agent route is registered for this surface.");
    return { ok: true, route: "agent", commandId: agent.id, input: raw, args: text };
  }
}

export function createDefaultCommandRegistry(options: { nativeCommands?: NativeCommandDescriptor[] } = {}): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register({ id: "shell", route: "shell", surfaces: ALL_SURFACES, priority: 100 });
  for (const command of DEFAULT_SLASH_COMMANDS) {
    registry.register({
      id: command.id,
      route: "slash",
      aliases: "aliases" in command ? [...command.aliases] : [],
      surfaces: ALL_SURFACES,
      priority: 100,
    });
  }
  for (const descriptor of options.nativeCommands || []) registry.register({ ...descriptor, route: "native" });
  registry.register({ id: "agent.input", route: "agent", surfaces: ALL_SURFACES, priority: -100 });
  return registry;
}

function normalizeDescriptor(input: CommandDescriptor): CommandDescriptor {
  const id = String(input?.id || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id)) throw new CommandRegistryError("command_id_invalid", "Command id is invalid.");
  if (input.route !== "shell" && input.route !== "slash" && input.route !== "native" && input.route !== "agent") throw new CommandRegistryError("command_route_invalid", `Command route is invalid: ${String(input.route)}`);
  const surfaces = Array.from(new Set((input.surfaces || []).map(validateSurface)));
  if (!surfaces.length) throw new CommandRegistryError("command_surface_invalid", "Command must declare at least one surface.");
  const aliases = Array.from(new Set((input.aliases || []).map(normalizeAlias).filter(Boolean)));
  if (input.route === "native" && typeof input.match !== "function") throw new CommandRegistryError("command_matcher_required", `Native command ${id} requires a matcher.`);
  return {
    id,
    route: input.route,
    aliases,
    surfaces,
    priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
    ...(input.description ? { description: String(input.description) } : {}),
    ...(input.match ? { match: input.match } : {}),
  };
}

function cloneDescriptor(descriptor: CommandDescriptor): CommandDescriptor {
  return { ...descriptor, aliases: [...(descriptor.aliases || [])], surfaces: [...descriptor.surfaces] };
}

function slashNames(descriptor: CommandDescriptor): string[] {
  return [normalizeAlias(descriptor.id), ...(descriptor.aliases || []).map(normalizeAlias)];
}

function normalizeAlias(value: string): string {
  return String(value || "").trim().replace(/^\/+/, "").toLowerCase();
}

function validateSurface(surface: CommandSurface): CommandSurface {
  if (surface !== "cli" && surface !== "tui" && surface !== "desktop" && surface !== "runtime") throw new CommandRegistryError("command_surface_invalid", `Unknown command surface: ${String(surface)}`);
  return surface;
}

function overlaps(left: CommandSurface[], right: CommandSurface[]): boolean {
  return left.some((surface) => right.includes(surface));
}

function invalid(input: string, code: string, message: string): CommandResolution {
  return { ok: false, route: "invalid", code, message, input };
}
