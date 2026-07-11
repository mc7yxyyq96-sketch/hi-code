import type { ChatMessage } from "./llm.js";
import { completeModelProfile } from "./model-provider.js";
import type { ModelProfile } from "./config.js";

/** Flatten message content (string or multimodal parts) to plain text. */
export function contentText(content: ChatMessage["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .map((p) => p.type === "text" ? p.text : p.type === "image_url" ? "[image]" : `[attachment: ${p.attachment.name}]`)
    .join(" ");
}

/** Cheap token estimate: ~4 chars/token, plus per-message overhead. */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += contentText(m.content).length;
    // Images dominate token cost; approximate each at ~1000 tokens (4000 chars).
    if (Array.isArray(m.content)) chars += m.content.filter((p) => p.type === "image_url").length * 4000;
    if (Array.isArray(m.content)) chars += m.content.filter((p) => p.type === "attachment_ref").reduce((sum, p) => sum + Math.min(p.attachment.size, 4000), 0);
    if (m.tool_calls) for (const tc of m.tool_calls) chars += tc.function.arguments.length + tc.function.name.length;
    chars += 8;
  }
  return Math.ceil(chars / 4);
}

export interface Session {
  system: ChatMessage;
  messages: ChatMessage[]; // everything after the system prompt
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

export function newSession(systemPrompt: string): Session {
  return {
    system: { role: "system", content: systemPrompt },
    messages: [],
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
  };
}

export function fullHistory(s: Session): ChatMessage[] {
  return [s.system, ...s.messages];
}

/**
 * Summarize older turns into a single synthetic message, keeping the most
 * recent exchanges verbatim. Mirrors Claude Code's /compact.
 */
export async function compact(p: ModelProfile, s: Session, keepRecent = 6): Promise<number> {
  if (s.messages.length <= keepRecent + 2) return 0;
  const cutoff = s.messages.length - keepRecent;
  const toSummarize = s.messages.slice(0, cutoff);
  const recent = s.messages.slice(cutoff);

  const transcript = toSummarize
    .map((m) => {
      if (m.role === "tool") return `[tool result] ${truncate(contentText(m.content), 600)}`;
      if (m.tool_calls?.length)
        return `assistant called: ${m.tool_calls.map((t) => t.function.name).join(", ")}`;
      return `${m.role}: ${truncate(contentText(m.content), 1200)}`;
    })
    .join("\n");

  const summary = await completeModelProfile(p, [
    {
      role: "system",
      content:
        "You compress a coding session transcript. Produce a dense technical summary preserving: the user's goals, decisions made, files created/modified, key findings, and any unfinished work. Use terse bullet points. No preamble.",
    },
    { role: "user", content: transcript },
  ]);

  const before = s.messages.length;
  s.messages = [
    { role: "user", content: `[Earlier conversation summary]\n${summary}` },
    { role: "assistant", content: "Understood — continuing from that summary." },
    ...recent,
  ];
  return before - s.messages.length;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
