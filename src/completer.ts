import fs from "node:fs";
import path from "node:path";
import { COMMAND_NAMES } from "./commands.js";
import { ROLES } from "./agents/roles.js";

const ROLE_NAMES = Object.keys(ROLES);

/** readline completer: returns [matches, substringBeingCompleted]. */
export type Completer = (line: string) => [string[], string];

/**
 * Tab-completion for the REPL:
 *   - leading `/`          → slash command names
 *   - `/agent <tab>`       → role names
 *   - any token `@path`    → files/dirs under cwd (dirs get a trailing /)
 */
export function makeCompleter(cwd: string): Completer {
  return (line: string): [string[], string] => {
    const token = lastToken(line);

    // @path file/dir completion (works anywhere in the line).
    if (token.startsWith("@")) {
      return completePath(cwd, token);
    }

    // /agent <role>  and  /mode <name>
    const roleMatch = line.match(/^\/agent\s+(\S*)$/);
    if (roleMatch) {
      const partial = roleMatch[1];
      const hits = ROLE_NAMES.filter((r) => r.startsWith(partial));
      return [hits.length ? hits : ROLE_NAMES, partial];
    }

    // Slash command names (only while typing the first token).
    if (line.startsWith("/") && !line.includes(" ")) {
      const hits = COMMAND_NAMES.filter((c) => c.startsWith(line));
      return [hits.length ? hits : COMMAND_NAMES, line];
    }

    return [[], line];
  };
}

function lastToken(line: string): string {
  const i = Math.max(line.lastIndexOf(" "), line.lastIndexOf("\t"));
  return i === -1 ? line : line.slice(i + 1);
}

function completePath(cwd: string, token: string): [string[], string] {
  const raw = token.slice(1); // strip '@'
  const slash = raw.lastIndexOf("/");
  const dirPart = slash >= 0 ? raw.slice(0, slash + 1) : "";
  const basePart = slash >= 0 ? raw.slice(slash + 1) : raw;
  const dirAbs = path.isAbsolute(dirPart) ? dirPart : path.join(cwd, dirPart);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return [[], token];
  }

  const hits = entries
    .filter((e) => e.name.startsWith(basePart) && (basePart.startsWith(".") || !e.name.startsWith(".")))
    .map((e) => "@" + dirPart + e.name + (e.isDirectory() ? "/" : ""))
    .sort();

  return [hits, token];
}
