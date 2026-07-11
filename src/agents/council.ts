import type { VibeConfig, ModelProfile } from "../config.js";
import { getProfile } from "../config.js";
import { completeModelProfile } from "../model-provider.js";
import { ui, startSpinner, stopSpinner } from "../ui.js";
import { runLoop } from "../agent.js";
import { newSession } from "../context.js";
import { TOOL_SCHEMAS, type ExecEnv } from "../tools/index.js";

function councilProfiles(cfg: VibeConfig): ModelProfile[] {
  const seen = new Set<string>();
  return cfg.councilMembers
    .map((k) => getProfile(cfg, k))
    .filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
}

// Debaters get read-only access to ground their arguments in the real codebase.
const READ_ONLY = ["read_file", "ls", "glob", "grep"];
const READ_ONLY_TOOLS = TOOL_SCHEMAS.filter((t) => READ_ONLY.includes(t.function.name));

/** One debater's turn: a quiet read-only agent that can inspect the codebase. */
async function debaterTurn(
  cfg: VibeConfig,
  env: ExecEnv,
  m: ModelProfile,
  question: string,
  others: string,
  prev: string,
  round: number,
): Promise<string> {
  const system =
    round === 1
      ? "You are a debater with READ-ONLY access to the codebase (read_file, ls, glob, grep). Investigate if it helps, then answer the question concisely and correctly. Cite files/lines when relevant."
      : "You are debating other models. You have READ-ONLY codebase tools — use them to verify claims. Read the others' latest answers, correct any errors (yours or theirs), and give your improved, concise answer.";
  const content =
    round === 1
      ? question
      : `Question: ${question}\n\nOther models said:\n${others || "(none yet)"}\n\nYour previous answer:\n${prev || "(none)"}\n\nGive your updated answer.`;

  const session = newSession(system);
  session.messages.push({ role: "user", content });
  const childEnv: ExecEnv = { ...env, depth: env.depth + 1, quiet: true, toolLog: undefined };
  const text = await runLoop(cfg, session, childEnv, {
    tools: READ_ONLY_TOOLS,
    profile: m,
    maxSteps: 6,
    autoCompact: false,
  }).catch((e) => `(error: ${(e as Error).message})`);
  return (text || "(empty)").trim();
}

/**
 * Model council / ensemble: every member model answers the same question in
 * parallel, then a synthesizer model merges their answers — taking the
 * strongest points from each, correcting errors, and noting disagreement.
 * This is "fusion by cross-validation": models complement each other directly.
 */
export async function runCouncil(cfg: VibeConfig, question: string): Promise<string> {
  const members = councilProfiles(cfg);

  if (members.length === 0) {
    ui.warn("  no council members configured");
    return "";
  }

  ui.councilStart(question, members.map((m) => `${m.name}:${m.model}`));

  startSpinner(`polling ${members.length} models`);
  const answers = await Promise.all(
    members.map(async (m) => {
      try {
        const text = await completeModelProfile(m, [
          { role: "system", content: "Answer the user's question as correctly and concisely as you can. If unsure, say so." },
          { role: "user", content: question },
        ]);
        return { member: m.name, model: m.model, text: text.trim() || "(empty)" };
      } catch (e) {
        return { member: m.name, model: m.model, text: `(error: ${(e as Error).message})` };
      }
    }),
  );
  stopSpinner();

  for (const a of answers) ui.councilAnswer(a.member, a.model, a.text);

  // If there's only one member, there's nothing to synthesize.
  if (members.length === 1) return answers[0].text;

  const synth = getProfile(cfg, cfg.councilSynthesizer);
  startSpinner(`synthesizing with ${synth.model}`);
  const merged = await completeModelProfile(
    synth,
    [
      {
        role: "system",
        content:
          "You are the SYNTHESIZER of a model council. Several models answered the same question. Produce one best answer that combines the strongest, most correct points from each, resolves contradictions in favor of what's verifiably correct, and briefly flags any genuine disagreement. Do not mention the models by name. Be concise and direct.",
      },
      {
        role: "user",
        content:
          `Question: ${question}\n\n` +
          answers.map((a, i) => `### Answer ${i + 1} (${a.model})\n${a.text}`).join("\n\n"),
      },
    ],
    0.3,
  ).catch((e) => `(synthesis failed: ${(e as Error).message})`);
  stopSpinner();

  ui.councilSynthesis(synth.model, merged);
  return merged;
}

/**
 * Multi-round debate: members answer, then each round they see the others'
 * latest answers and revise/critique. A synthesizer renders the verdict.
 * Fusion by argument: models correct each other before the merge.
 */
export async function runDebate(
  cfg: VibeConfig,
  env: ExecEnv,
  question: string,
  rounds = 2,
): Promise<string> {
  const members = councilProfiles(cfg);
  if (members.length === 0) {
    ui.warn("  no council members configured");
    return "";
  }
  if (members.length === 1) return runCouncil(cfg, question);

  ui.councilStart(question, members.map((m) => `${m.name}:${m.model}`));

  // Each member's latest position, keyed by display name.
  let positions: { name: string; model: string; text: string }[] = [];

  for (let round = 1; round <= rounds; round++) {
    ui.phase(`Debate round ${round}/${rounds}  (debaters may read the codebase)`);
    startSpinner(`round ${round}: ${members.length} models investigating`);
    const others = (selfName: string) =>
      positions.filter((p) => p.name !== selfName).map((p) => `### ${p.model}\n${p.text}`).join("\n\n");

    const next = await Promise.all(
      members.map(async (m) => {
        const prev = positions.find((p) => p.name === m.name)?.text ?? "";
        const text = await debaterTurn(cfg, env, m, question, others(m.name), prev, round);
        return { name: m.name, model: m.model, text };
      }),
    );
    stopSpinner();
    positions = next;
    for (const p of positions) ui.councilAnswer(p.name, p.model, p.text);
  }

  const synth = getProfile(cfg, cfg.councilSynthesizer);
  startSpinner(`synthesizing verdict with ${synth.model}`);
  const verdict = await completeModelProfile(
    synth,
    [
      {
        role: "system",
        content:
          "You are the moderator of a model debate. Given the models' final positions, deliver one clear, correct verdict. Resolve disagreements on the merits and note any remaining genuine uncertainty. Be concise.",
      },
      {
        role: "user",
        content: `Question: ${question}\n\nFinal positions:\n${positions.map((p) => `### ${p.model}\n${p.text}`).join("\n\n")}`,
      },
    ],
    0.3,
  ).catch((e) => `(synthesis failed: ${(e as Error).message})`);
  stopSpinner();

  ui.councilSynthesis(synth.model, verdict);
  return verdict;
}
