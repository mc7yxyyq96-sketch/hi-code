import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

/**
 * Lightweight integrated terminal (line-buffered shell sessions).
 * Clean-room Wave1 surface — not a copy of any third-party terminal UI.
 */
export function createTerminalService({ getCwd }) {
  /** @type {Map<string, { child: import('node:child_process').ChildProcessWithoutNullStreams, cwd: string }>} */
  const sessions = new Map();
  let seq = 0;

  function shellCommand() {
    if (process.platform === "win32") return { cmd: "powershell.exe", args: ["-NoLogo", "-NoProfile"] };
    const sh = process.env.SHELL || "/bin/zsh";
    return { cmd: sh, args: ["-l"] };
  }

  function emit(webContents, channel, payload) {
    if (!webContents || webContents.isDestroyed()) return;
    webContents.send(channel, payload);
  }

  function createSession(webContents, { cwd } = {}) {
    const id = `term-${Date.now()}-${++seq}`;
    const workdir = cwd || (typeof getCwd === "function" ? getCwd() : "") || process.cwd();
    const { cmd, args } = shellCommand();
    const child = spawn(cmd, args, {
      cwd: workdir,
      env: { ...process.env, TERM: "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    sessions.set(id, { child, cwd: workdir });

    const forward = (stream) => {
      child[stream].on("data", (buf) => {
        emit(webContents, "terminal:data", { id, stream, data: buf.toString("utf8") });
      });
    };
    forward("stdout");
    forward("stderr");
    child.on("exit", (code, signal) => {
      sessions.delete(id);
      emit(webContents, "terminal:exit", { id, code, signal });
    });
    emit(webContents, "terminal:ready", { id, cwd: workdir, shell: cmd });
    return { ok: true, id, cwd: workdir, shell: cmd };
  }

  function write(id, data) {
    const session = sessions.get(id);
    if (!session) return { ok: false, error: "terminal session not found" };
    const text = String(data ?? "");
    if (!text) return { ok: true };
    session.child.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
    return { ok: true };
  }

  function kill(id) {
    const session = sessions.get(id);
    if (!session) return { ok: true };
    try { session.child.kill(); } catch { /* ignore */ }
    sessions.delete(id);
    return { ok: true };
  }

  function list() {
    return [...sessions.entries()].map(([id, session]) => ({ id, cwd: session.cwd }));
  }

  function disposeAll() {
    for (const id of [...sessions.keys()]) kill(id);
  }

  return { createSession, write, kill, list, disposeAll, home: () => os.homedir(), resolveCwd: (value) => path.resolve(value || process.cwd()) };
}

export function registerTerminalIpc({ register, terminal, BrowserWindow }) {
  if (!register || !terminal) throw new Error("registerTerminalIpc requires register + terminal");

  register("terminal:create", async (event, payload = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: "no window" };
    return terminal.createSession(event.sender, payload);
  });
  register("terminal:write", async (_event, payload = {}) => terminal.write(payload.id, payload.data));
  register("terminal:kill", async (_event, payload = {}) => terminal.kill(payload?.id));
  register("terminal:list", async () => ({ ok: true, sessions: terminal.list() }));
}
