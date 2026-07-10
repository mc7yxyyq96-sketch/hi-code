import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, Box, Text, Static, useInput, useApp } from "ink";
import Spinner from "ink-spinner";
import chalk from "chalk";
import type { VibeConfig } from "./config.js";
import { defaultProfile } from "./config.js";
import type { PermissionMode } from "./permissions.js";
import type { StoredSession } from "./session-store.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { makeCompleter, type Completer } from "./completer.js";
import { setSpinnerEnabled } from "./ui.js";
import { estimateTokens, fullHistory } from "./context.js";
import { RuntimeEventBus } from "./runtime-event-sink.js";
import { connectAssistantTextOutput } from "./runtime-client-adapters.js";

export interface TuiOpts {
  cfg: VibeConfig;
  cwd: string;
  mode: PermissionMode;
  systemPrompt: string;
  restored?: StoredSession;
}

const HISTORY_FILE = path.join(os.homedir(), ".vibe", "history");

/** Mount the Ink app. Resolves only when the user quits (which exits the process). */
export function runTui(opts: TuiOpts): Promise<void> {
  // Give Ink a private stdout so its own frame writes bypass our output bridge.
  const real = process.stdout;
  const realWrite = real.write.bind(real);
  const inkStdout: NodeJS.WriteStream = Object.create(real);
  (inkStdout as any).write = realWrite;

  // Compatibility command/tool output still uses console/stdout. Assistant
  // model text is projected from RuntimeEventBus inside the React app.
  const bridge = { feed: (_: string) => {} };
  const origLog = console.log;
  const origErr = console.error;
  const origWrite = process.stdout.write.bind(process.stdout);
  const toStr = (args: any[]) => args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  console.log = (...a: any[]) => bridge.feed(toStr(a) + "\n");
  console.error = (...a: any[]) => bridge.feed(toStr(a) + "\n");
  (process.stdout as any).write = (chunk: any, enc?: any, cb?: any) => {
    bridge.feed(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof enc === "function") enc();
    else if (typeof cb === "function") cb();
    return true;
  };
  setSpinnerEnabled(false); // Ink renders its own spinner

  const restore = () => {
    console.log = origLog;
    console.error = origErr;
    (process.stdout as any).write = origWrite;
    setSpinnerEnabled(true);
  };

  return new Promise<void>(() => {
    render(<App opts={opts} bridge={bridge} onExit={restore} />, { stdout: inkStdout, patchConsole: false });
  });
}

interface AppProps {
  opts: TuiOpts;
  bridge: { feed: (s: string) => void };
  onExit: () => void;
}

function App({ opts, bridge, onExit }: AppProps) {
  const { exit } = useApp();
  const [lines, setLines] = useState<string[]>(() => banner(opts));
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const [stats, setStats] = useState({ ctx: 0, used: 0 });

  const runtimeRef = useRef<Runtime | null>(null);
  const assistantDisconnectRef = useRef<(() => void) | null>(null);
  const askResolveRef = useRef<((s: string) => void) | null>(null);
  const lineBuf = useRef("");
  const completer = useRef<Completer>(makeCompleter(opts.cwd));

  // Bridge committed lines into <Static> and the trailing partial into `live`.
  const feed = useCallback((chunk: string) => {
    lineBuf.current += chunk;
    const parts = lineBuf.current.split("\n");
    lineBuf.current = parts.pop() ?? "";
    if (parts.length) setLines((prev) => [...prev, ...parts]);
    setLive(lineBuf.current);
  }, []);

  useEffect(() => {
    bridge.feed = feed;
  }, [bridge, feed]);

  // Build the runtime once, wiring permission prompts through the Ink prompt.
  if (!runtimeRef.current) {
    const ask = (q: string) =>
      new Promise<string>((resolve) => {
        setPendingAsk(q);
        askResolveRef.current = resolve;
      });
    const eventBus = new RuntimeEventBus();
    assistantDisconnectRef.current = connectAssistantTextOutput(eventBus, {
      write: feed,
      prefix: ({ label }) => `\n${chalk.green("● ")}${label ? chalk.dim(`[${label}] `) : ""}`,
    });
    runtimeRef.current = createRuntime({
      ...opts,
      ask,
      eventSink: eventBus,
      legacyAssistantOutput: false,
    });
  }
  const rt = runtimeRef.current;

  const quit = () => {
    assistantDisconnectRef.current?.();
    assistantDisconnectRef.current = null;
    rt.shutdown();
    onExit();
    exit();
    process.exit(0);
  };

  // Ctrl-C: interrupt a running turn, else quit.
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (rt.abort()) feed(chalk.yellow("\n  ⏹ interrupting…\n"));
      else quit();
    }
  });

  const answerAsk = (answer: string) => {
    setPendingAsk(null);
    askResolveRef.current?.(answer);
    askResolveRef.current = null;
  };

  const submit = async (raw: string) => {
    const input = raw.trim();
    if (!input || busy) return;
    appendHistory(input);
    feed(chalk.bold.magenta("› ") + input + "\n");
    if (input === "/exit" || input === "/quit") return quit();
    setBusy(true);
    try {
      await rt.handleInput(input);
    } catch (e) {
      feed(chalk.red("  " + (e as Error).message) + "\n");
    }
    feed(chalk.gray("─".repeat(48)) + "\n");
    setStats({
      ctx: estimateTokens(fullHistory(rt.session)),
      used: rt.session.totalPromptTokens + rt.session.totalCompletionTokens,
    });
    setBusy(false);
  };

  const model = defaultProfile(opts.cfg).model;
  const footer =
    chalk.magenta(model) +
    chalk.gray(`  ·  ~${fmt(stats.ctx)} ctx  ·  ${fmt(stats.used)} tokens`) +
    (opts.cfg.sandbox ? chalk.gray("  ·  ") + chalk.green("sandbox") : "");

  return (
    <Box flexDirection="column">
      <Static items={lines}>{(line, i) => <Text key={i}>{line}</Text>}</Static>
      {live ? <Text>{live}</Text> : null}
      {busy && !pendingAsk ? (
        <Box>
          <Text color="magenta">
            <Spinner type="dots" />
          </Text>
          <Text color="gray"> working… (Ctrl-C to interrupt)</Text>
        </Box>
      ) : null}
      {pendingAsk ? (
        <InputField prompt={pendingAsk} onSubmit={answerAsk} />
      ) : !busy ? (
        <InputField prompt={chalk.bold.magenta("› ")} onSubmit={submit} completer={completer.current} />
      ) : null}
      <Text>{footer}</Text>
    </Box>
  );
}

/** 1234 → "1.2k". */
function fmt(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

interface InputFieldProps {
  prompt: string;
  onSubmit: (value: string) => void;
  completer?: Completer;
}

/** A minimal terminal input: typing, backspace, Enter, Tab-complete, ↑/↓ history. */
function InputField({ prompt, onSubmit, completer }: InputFieldProps) {
  const [value, setValue] = useState("");
  const [hint, setHint] = useState("");
  const histIdx = useRef(-1);

  useInput((input, key) => {
    if (key.ctrl && input === "c") return; // handled by App
    // Enter, whether a discrete keypress or the tail of a pasted/bulk chunk.
    if (key.return || input.includes("\r") || input.includes("\n")) {
      const before = input.split(/\r|\n/)[0] ?? "";
      onSubmit(value + before);
      setValue("");
      setHint("");
      histIdx.current = -1;
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setHint("");
      return;
    }
    if (key.tab && completer) {
      const [hits, sub] = completer(value);
      if (hits.length === 1) {
        setValue(value.slice(0, value.length - sub.length) + hits[0]);
        setHint("");
      } else if (hits.length > 1) {
        setHint(hits.slice(0, 12).join("  "));
      }
      return;
    }
    if (key.upArrow) {
      const h = loadHistory();
      if (h.length) {
        histIdx.current = Math.min(histIdx.current + 1, h.length - 1);
        setValue(h[h.length - 1 - histIdx.current]);
      }
      return;
    }
    if (key.downArrow) {
      const h = loadHistory();
      if (histIdx.current > 0) {
        histIdx.current -= 1;
        setValue(h[h.length - 1 - histIdx.current]);
      } else {
        histIdx.current = -1;
        setValue("");
      }
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
      setHint("");
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text>{prompt}</Text>
        <Text>{value}</Text>
        <Text color="magenta">▋</Text>
      </Box>
      {hint ? <Text color="gray">  {hint}</Text> : null}
    </Box>
  );
}

function banner(opts: TuiOpts): string[] {
  const def = defaultProfile(opts.cfg);
  const out = [
    "",
    chalk.bold.magenta("  ✺ Hi Code") + chalk.gray("  — terminal coding agent (TUI)"),
    chalk.gray("─".repeat(48)),
    chalk.gray(`  cwd:   ${opts.cwd}`),
    chalk.gray(`  model: `) + chalk.bold(def.model) + chalk.gray(`  @ ${def.baseURL}`),
  ];
  if (opts.cfg.sandbox) out.push(chalk.gray("  sandbox: ") + chalk.green("on"));
  if (opts.mode !== "default") out.push(chalk.yellow(`  mode:  ${opts.mode}`));
  if (opts.restored) out.push(chalk.gray(`  resumed ${opts.restored.id} (${opts.restored.messages.length} msgs)`));
  out.push(chalk.gray("  /help for commands · Ctrl-C to interrupt/quit · Tab to complete"));
  out.push(chalk.gray("─".repeat(48)));
  return out;
}

function loadHistory(): string[] {
  try {
    return fs.readFileSync(HISTORY_FILE, "utf8").split("\n").filter(Boolean).slice(-1000);
  } catch {
    return [];
  }
}

function appendHistory(line: string): void {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true, mode: 0o700 });
    fs.appendFileSync(HISTORY_FILE, line + "\n", { mode: 0o600 });
  } catch {
    /* ignore */
  }
}
