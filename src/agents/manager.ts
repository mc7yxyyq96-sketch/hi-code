import type { VibeConfig } from "../config.js";
import { getProfile, profileForRole } from "../config.js";
import { complete } from "../llm.js";
import type { ExecEnv } from "../tools/index.js";
import { ui, startSpinner, stopSpinner } from "../ui.js";
import { ROLES } from "./roles.js";
import { spawnAgent } from "./subagent.js";

interface Task {
  id: string;
  role: string;
  task: string;
  deps: string[];
}

const VALID_ROLES = Object.keys(ROLES);

/**
 * Manager-orchestrated build. A manager model decomposes the goal into a task
 * graph (tasks + dependencies); independent tasks run in parallel (in yolo
 * mode), dependent ones wait for and receive their predecessors' reports.
 */
export async function runBuild(cfg: VibeConfig, env: ExecEnv, goal: string): Promise<void> {
  ui.managerStart(goal);
  const lead: ExecEnv = { ...env, depth: 0, quiet: false, toolLog: undefined };

  // --- 1. Decompose into a task graph ---
  const managerProfile = getProfile(cfg, cfg.roleModels["architect"]); // reuse the planning model
  startSpinner(`manager (${managerProfile.model}) decomposing the goal`);
  const raw = await complete(
    managerProfile,
    [
      {
        role: "system",
        content:
          "You are the PROJECT MANAGER. Decompose the user's goal into a minimal set of concrete tasks for your team. " +
          `Available roles: ${VALID_ROLES.join(", ")}. ` +
          "Return ONLY a JSON array. Each item: {\"id\":\"t1\",\"role\":\"coder\",\"task\":\"...\",\"deps\":[\"t0\"]}. " +
          "Use deps to express ordering; tasks with no deps (or whose deps are all done) run in parallel. " +
          "Keep it to 2-5 tasks. End with a review task that depends on the implementation tasks.",
      },
      { role: "user", content: goal },
    ],
    0.2,
  ).catch((e) => `error: ${(e as Error).message}`);
  stopSpinner();

  const tasks = parseTasks(raw);
  if (!tasks.length) {
    ui.warn("  manager could not produce a task plan; falling back to a single coder");
    await spawnAgent(lead, "coder", goal);
    ui.managerEnd();
    return;
  }
  ui.taskGraph(tasks);

  // --- 2. Execute respecting dependencies, parallelizing when safe ---
  const reports = new Map<string, { role: string; model: string; report: string }>();
  const pending = [...tasks];
  const failed: string[] = [];
  const canParallelize = env.perms.mode === "yolo"; // parallel needs non-interactive perms

  while (pending.length) {
    const ready = pending.filter((t) => t.deps.every((d) => reports.has(d)));
    if (!ready.length) {
      ui.warn(`  unmet dependencies for: ${pending.map((t) => t.id).join(", ")} — stopping`);
      break;
    }

    const runOne = async (t: Task) => {
      const quiet = canParallelize && ready.length > 1;
      const model = profileForRole(cfg, t.role).model;
      let report = "";
      let toolLog: string[] = [];

      // Up to 2 attempts: retry once on a failed/empty report.
      for (let attempt = 1; attempt <= 2; attempt++) {
        toolLog = [];
        const note =
          attempt === 1
            ? ""
            : `\n\n[Note: a previous attempt failed or produced nothing. Try a different approach and make sure to complete the task.]`;
        report = await spawnAgent(lead, t.role, buildPrompt(t, reports) + note, { quiet, toolLog });
        if (!isFailure(report)) break;
        if (attempt < 2 && !quiet) ui.warn(`  ⟳ ${t.id} (@${t.role}) failed — retrying`);
      }

      reports.set(t.id, { role: t.role, model, report });
      return { t, model, report, toolLog, failed: isFailure(report) };
    };

    if (canParallelize && ready.length > 1) {
      ui.parallelStart(ready.map((t) => `${t.id}:@${t.role}`));
      const done = await Promise.all(ready.map(runOne));
      for (const d of done) {
        ui.agentDone(d.t.id, d.t.role, d.model, d.report, d.toolLog);
        if (d.failed) failed.push(d.t.id);
      }
    } else {
      for (const t of ready) {
        ui.serialStart(`${t.id} — @${t.role}`);
        const d = await runOne(t);
        if (d.failed) failed.push(t.id);
      }
    }

    for (const t of ready) pending.splice(pending.indexOf(t), 1);
  }

  if (failed.length) ui.warn(`  ⚠ tasks that failed after retry: ${failed.join(", ")}`);
  ui.managerEnd();
}

/** Heuristic: did an agent turn fail outright (errored or produced nothing)? */
function isFailure(report: string): boolean {
  const r = report.trim();
  return r === "" || r.startsWith("error:") || r.startsWith("(subagent produced no report)");
}

function buildPrompt(t: Task, reports: Map<string, { report: string }>): string {
  let prompt = t.task;
  if (t.deps.length) {
    const ctx = t.deps
      .map((d) => `## Result of ${d}\n${reports.get(d)?.report ?? "(missing)"}`)
      .join("\n\n");
    prompt += `\n\n--- Context from completed tasks ---\n${ctx}`;
  }
  return prompt;
}

/** Extract and validate the task array from the manager's (possibly noisy) output. */
function parseTasks(raw: string): Task[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Task[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (!p || typeof p.task !== "string") continue;
    out.push({
      id: typeof p.id === "string" ? p.id : `t${i}`,
      role: VALID_ROLES.includes(p.role) ? p.role : "coder",
      task: p.task,
      deps: Array.isArray(p.deps) ? p.deps.filter((d: any) => typeof d === "string") : [],
    });
  }
  return out;
}
