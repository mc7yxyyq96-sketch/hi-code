import chalk from "chalk";
import { diffLines } from "diff";

export const ui = {
  banner() {
    const line = chalk.gray("─".repeat(48));
    console.log();
    console.log(chalk.bold.magenta("  ✺ Hi Code") + chalk.gray("  — your terminal coding agent"));
    console.log(line);
  },

  info(msg: string) {
    console.log(chalk.gray(msg));
  },

  warn(msg: string) {
    console.log(chalk.yellow(msg));
  },

  error(msg: string) {
    console.log(chalk.red("✗ " + msg));
  },

  /** Header shown when the model decides to invoke a tool. */
  toolCall(name: string, summary: string) {
    console.log();
    console.log(chalk.cyan("⏺ " + chalk.bold(name)) + chalk.gray("  " + summary));
  },

  toolResult(text: string, { dim = true } = {}) {
    const lines = text.split("\n");
    const shown = lines.slice(0, 12);
    for (const l of shown) {
      console.log(chalk.gray("  │ ") + (dim ? chalk.dim(l) : l));
    }
    if (lines.length > shown.length) {
      console.log(chalk.gray(`  │ … (+${lines.length - shown.length} more lines)`));
    }
  },

  /** Render a unified-ish colored diff between two file contents. */
  diff(oldStr: string, newStr: string, filename: string) {
    console.log(chalk.gray("  ┌─ ") + chalk.bold(filename));
    const parts = diffLines(oldStr, newStr);
    for (const part of parts) {
      const lines = part.value.replace(/\n$/, "").split("\n");
      for (const line of lines) {
        if (part.added) console.log(chalk.green("  │ + " + line));
        else if (part.removed) console.log(chalk.red("  │ - " + line));
        else console.log(chalk.gray("  │   " + line));
      }
    }
    console.log(chalk.gray("  └─"));
  },

  assistantPrefix(label?: string) {
    const tag = label ? chalk.dim(`[${label}] `) : "";
    process.stdout.write("\n" + chalk.green("● ") + tag);
  },

  newline() {
    process.stdout.write("\n");
  },

  // ---- multi-agent framing ----
  teamStart(goal: string) {
    console.log();
    console.log(chalk.bold.magenta("╔══ AI TEAM ") + chalk.gray("─".repeat(36)));
    console.log(chalk.magenta("║ ") + chalk.bold("goal: ") + goal);
    console.log(chalk.magenta("╚") + chalk.gray("─".repeat(46)));
  },

  teamEnd() {
    console.log(chalk.bold.magenta("╚══ team finished ") + chalk.gray("─".repeat(30)));
  },

  agentStart(role: string, task: string, model?: string) {
    console.log();
    const tag = model ? chalk.magenta(` (${model})`) : "";
    console.log(chalk.bold.blue(`  ↘ @${role}`) + tag + chalk.gray("  " + oneLine(task, 60)));
  },

  agentEnd(role: string, summary: string) {
    console.log(chalk.blue(`  ↙ @${role} done`) + chalk.gray("  " + oneLine(summary, 60)));
  },

  phase(label: string) {
    console.log();
    console.log(chalk.bold.yellow("▶ " + label));
  },

  // ---- manager-orchestrated build ----
  managerStart(goal: string) {
    console.log();
    console.log(chalk.bold.magenta("╔══ PROJECT MANAGER ") + chalk.gray("─".repeat(28)));
    console.log(chalk.magenta("║ ") + chalk.bold("goal: ") + goal);
    console.log(chalk.magenta("╚") + chalk.gray("─".repeat(46)));
  },

  taskGraph(tasks: { id: string; role: string; task: string; deps: string[] }[]) {
    console.log(chalk.bold("  task plan:"));
    for (const t of tasks) {
      const deps = t.deps.length ? chalk.gray(`  ⟵ ${t.deps.join(", ")}`) : "";
      console.log(
        "    " +
          chalk.yellow(t.id.padEnd(4)) +
          chalk.blue(`@${t.role}`.padEnd(12)) +
          chalk.gray(oneLine(t.task, 46)) +
          deps,
      );
    }
  },

  parallelStart(items: string[]) {
    console.log();
    console.log(chalk.bold.yellow(`▶ running ${items.length} in parallel: `) + items.join(", "));
  },

  serialStart(item: string) {
    console.log();
    console.log(chalk.bold.yellow("▶ ") + item);
  },

  agentDone(id: string, role: string, model: string, report: string, tools: string[]) {
    const used = tools.length ? chalk.gray(`  [${summarizeTools(tools)}]`) : "";
    console.log(
      chalk.green("  ✓ ") + chalk.yellow(id) + " " + chalk.blue(`@${role}`) + chalk.magenta(` (${model})`) + used,
    );
    console.log(chalk.gray("    ↳ ") + oneLine(report, 80));
  },

  managerEnd() {
    console.log(chalk.bold.magenta("╚══ build finished ") + chalk.gray("─".repeat(29)));
  },

  // ---- model council (ensemble) ----
  councilStart(question: string, members: string[]) {
    console.log();
    console.log(chalk.bold.cyan("⚖ MODEL COUNCIL ") + chalk.gray("─".repeat(31)));
    console.log(chalk.cyan("  question: ") + oneLine(question, 60));
    console.log(chalk.gray("  members:  ") + members.join(", "));
  },

  councilAnswer(member: string, model: string, text: string) {
    console.log();
    console.log(chalk.bold.cyan(`  ◆ ${member}`) + chalk.magenta(` (${model})`));
    for (const l of text.split("\n").slice(0, 8)) console.log(chalk.gray("  │ ") + l);
  },

  councilSynthesis(model: string, text: string) {
    console.log();
    console.log(chalk.bold.green("  ★ synthesis ") + chalk.magenta(`(${model})`));
    console.log(text);
    console.log(chalk.bold.cyan("⚖ ") + chalk.gray("─".repeat(44)));
  },

  cost(promptTokens: number, completionTokens: number) {
    console.log(
      chalk.gray(
        `  ↳ tokens: ${promptTokens} in / ${completionTokens} out / ${promptTokens + completionTokens} total`,
      ),
    );
  },
};

function oneLine(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

/** "read_file×2, bash, write_file" from a flat list of tool names. */
function summarizeTools(tools: string[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([t, n]) => (n > 1 ? `${t}×${n}` : t)).join(", ");
}

let spinnerTimer: NodeJS.Timeout | null = null;
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let spinnerEnabled = true;

/** The Ink TUI shows its own spinner, so it disables the ANSI \r spinner. */
export function setSpinnerEnabled(v: boolean): void {
  spinnerEnabled = v;
}

export function startSpinner(label = "thinking"): void {
  if (spinnerTimer || !spinnerEnabled) return;
  let i = 0;
  process.stdout.write("\x1b[?25l"); // hide cursor
  spinnerTimer = setInterval(() => {
    process.stdout.write("\r" + chalk.magenta(FRAMES[i++ % FRAMES.length]) + " " + chalk.gray(label) + "  ");
  }, 80);
}

export function stopSpinner(): void {
  if (!spinnerTimer) return;
  clearInterval(spinnerTimer);
  spinnerTimer = null;
  process.stdout.write("\r\x1b[K"); // clear line
  process.stdout.write("\x1b[?25h"); // show cursor
}
