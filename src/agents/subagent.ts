import type { VibeConfig } from "../config.js";
import { profileForRole } from "../config.js";
import type { ExecEnv } from "../tools/index.js";
import { runLoop } from "../agent.js";
import { newSession } from "../context.js";
import { ui } from "../ui.js";
import { ROLES, resolveRole, toolsFor, type Role } from "./roles.js";

function workspaceHeader(env: ExecEnv): string {
  return `\n\nWorking directory: ${env.ctx.cwd}\nPlatform: ${process.platform}\nYou and your teammates share this same filesystem — collaborate by reading and editing real files.`;
}

/**
 * Run one subagent with a restricted role to completion and return its report.
 * Subagents share cwd and the permission state with the lead, but get a fresh
 * conversation focused on their task. Depth-limited to prevent runaway nesting.
 */
export interface SpawnOpts {
  /** Run silently (no per-agent framing/streaming) — used inside parallel batches. */
  quiet?: boolean;
  /** Collects the names of tools the agent used. */
  toolLog?: string[];
}

export async function spawnAgent(
  env: ExecEnv,
  roleName: string,
  task: string,
  opts: SpawnOpts = {},
): Promise<string> {
  if (env.depth >= 2) {
    return "Error: max delegation depth reached; do the work directly.";
  }
  const role: Role = resolveRole(roleName) ?? ROLES.coder;
  const profile = profileForRole(env.cfg, role.name);
  const quiet = opts.quiet === true;

  if (!quiet) ui.agentStart(role.name, task, profile.model);
  const session = newSession(role.systemPrompt + workspaceHeader(env));
  session.messages.push({ role: "user", content: task });

  const childEnv: ExecEnv = {
    ...env,
    ctx: { ...env.ctx, bashMode: role.bashMode },
    depth: env.depth + 1,
    quiet,
    toolLog: opts.toolLog ?? env.toolLog,
  };
  const report = await runLoop(env.cfg, session, childEnv, {
    tools: toolsFor(role),
    label: role.name,
    maxSteps: 30,
    profile,
  });

  if (!quiet) ui.agentEnd(role.name, report || "(no report)");
  return report || "(subagent produced no report)";
}

/**
 * Fixed multi-agent pipeline: architect → coder → reviewer → (fix loop).
 * A visible demonstration of several agents collaborating on one goal.
 */
export async function runTeam(cfg: VibeConfig, env: ExecEnv, goal: string): Promise<void> {
  ui.teamStart(goal);
  const lead: ExecEnv = { ...env, depth: 0 };

  // 1) Plan
  ui.phase("Phase 1 — Architect plans");
  const plan = await spawnAgent(
    lead,
    "architect",
    `Create a concise, numbered implementation plan for this goal. Planning only — do not modify files.\n\nGoal: ${goal}`,
  );

  // 2) Implement
  ui.phase("Phase 2 — Coder implements");
  const impl = await spawnAgent(
    lead,
    "coder",
    `Implement the following plan by editing the codebase. Make all necessary changes.\n\n## Plan\n${plan}\n\n## Original goal\n${goal}`,
  );

  // 3) Review
  ui.phase("Phase 3 — Reviewer checks the work");
  const review = await spawnAgent(
    lead,
    "reviewer",
    `Review the changes just made for this goal: "${goal}". Use git diff and run any tests. List concrete issues, or reply APPROVED if all good.\n\nCoder's summary:\n${impl}`,
  );

  // 4) Fix loop (one pass) if not approved
  const approved = /\bAPPROVED\b/.test(review);
  if (!approved) {
    ui.phase("Phase 4 — Coder addresses review feedback");
    await spawnAgent(
      lead,
      "coder",
      `The reviewer found issues with the work for goal "${goal}". Fix them.\n\n## Review feedback\n${review}`,
    );
  } else {
    ui.info("  reviewer approved — no fixes needed");
  }

  ui.teamEnd();
}
