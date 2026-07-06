import { TOOL_SCHEMAS } from "../tools/index.js";
import type { ToolSchema } from "../llm.js";

export interface Role {
  name: string;
  description: string;
  systemPrompt: string;
  /** Tool names this role is allowed to use. */
  toolNames: string[];
  /** Additional bash restriction for roles that may run checks but must not mutate files. */
  bashMode?: "normal" | "read-only";
}

const READ_ONLY = ["read_file", "ls", "glob", "grep"];
const FULL = ["read_file", "write_file", "edit_file", "ls", "glob", "grep", "bash"];
const REVIEW = ["read_file", "ls", "glob", "grep", "bash"]; // can run tests, can't mutate source

export const ROLES: Record<string, Role> = {
  architect: {
    name: "architect",
    description: "Plans and designs. Read-only. Breaks a goal into concrete steps.",
    toolNames: READ_ONLY,
    systemPrompt:
      "You are the ARCHITECT on a software team. Investigate the codebase with read-only tools, then produce a concrete, numbered implementation plan. Each step should name the files to touch and what changes to make. Be specific and realistic. Do NOT write code or modify files — planning only. End with the plan as a numbered list.",
  },
  coder: {
    name: "coder",
    description: "Implements changes. Full tool access.",
    toolNames: FULL,
    systemPrompt:
      "You are the CODER on a software team. Implement the requested changes by actually reading and editing files. Read a file before editing it. Match existing style. Keep changes focused. After making changes, briefly summarize what you changed (files + one line each). Run a build or quick check with bash if it's cheap and relevant.",
  },
  reviewer: {
    name: "reviewer",
    description: "Reviews changes for correctness. Read-only + can run tests.",
    toolNames: REVIEW,
    bashMode: "read-only",
    systemPrompt:
      "You are the REVIEWER on a software team. Inspect the recent changes (use git diff via bash, read files, run tests/linters if present). Your bash runs in a read-only filesystem sandbox, so do not attempt to modify files. Look for correctness bugs, missed cases, and broken builds. Output a short list of concrete issues. If everything is correct, reply with exactly the word APPROVED on its own line followed by a one-line rationale.",
  },
  tester: {
    name: "tester",
    description: "Writes and runs tests. Full tool access.",
    toolNames: FULL,
    systemPrompt:
      "You are the TESTER on a software team. Write focused tests for the recent changes and run them with bash. Report pass/fail clearly. Fix obviously-broken tests you wrote, but don't refactor product code.",
  },
  explorer: {
    name: "explorer",
    description: "Researches and answers questions about the codebase. Read-only.",
    toolNames: READ_ONLY,
    systemPrompt:
      "You are the EXPLORER. Answer the question by searching and reading the codebase. Cite files and line numbers. Be concise and factual; do not modify anything.",
  },
};

export function toolsFor(role: Role): ToolSchema[] {
  return TOOL_SCHEMAS.filter((t) => role.toolNames.includes(t.function.name));
}

export function resolveRole(name: string): Role | undefined {
  return ROLES[name?.toLowerCase()?.trim()];
}

export function roleList(): string {
  return Object.values(ROLES)
    .map((r) => `${r.name} — ${r.description}`)
    .join("\n");
}
