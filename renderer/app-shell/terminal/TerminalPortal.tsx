import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TerminalApi, TerminalCapabilities, TerminalEvent, TerminalSession } from "./api.ts";
import type { XtermRuntime } from "./xterm-runtime.ts";

type Phase = "loading" | "idle" | "starting" | "running" | "stopping" | "unavailable";

export function TerminalPortal({ api }: { api: TerminalApi }) {
  const mount = document.getElementById("terminalReactMount");
  if (!mount) throw new Error("Terminal mount #terminalReactMount is missing");
  return createPortal(<TerminalWorkbench api={api} />, mount);
}

function TerminalWorkbench({ api }: { api: TerminalApi }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<XtermRuntime | null>(null);
  const runtimePromiseRef = useRef<Promise<XtermRuntime> | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const inputBufferRef = useRef("");
  const inputTimerRef = useRef<number | null>(null);
  const inputChainRef = useRef(Promise.resolve());
  const lastSequenceRef = useRef(0);
  const bufferedEventsRef = useRef(new Map<string, TerminalEvent[]>());
  const aliveRef = useRef(true);
  const acceptInputRef = useRef(false);
  const [capabilities, setCapabilities] = useState<TerminalCapabilities | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [dimensions, setDimensions] = useState({ cols: 100, rows: 28 });

  const reportError = (error: string) => {
    if (!aliveRef.current) return;
    setMessage(error || "终端操作失败");
  };

  const sendInput = (data: string) => {
    if (!sessionRef.current || !acceptInputRef.current) return;
    inputBufferRef.current += data;
    if (utf8Length(inputBufferRef.current) >= 48 * 1024) flushInput();
    else if (inputTimerRef.current === null) inputTimerRef.current = window.setTimeout(flushInput, 8);
  };

  const flushInput = () => {
    if (inputTimerRef.current !== null) window.clearTimeout(inputTimerRef.current);
    inputTimerRef.current = null;
    const active = sessionRef.current;
    const buffered = inputBufferRef.current;
    inputBufferRef.current = "";
    if (!active || !buffered) return;
    for (const chunk of splitUtf8(buffered, 60 * 1024)) {
      inputChainRef.current = inputChainRef.current.then(async () => {
        const result = await api.write(active.id, chunk);
        if (!result.ok) throw new Error(result.error || "终端输入失败");
      }).catch((error) => reportError(error instanceof Error ? error.message : String(error)));
    }
  };

  const handleResize = (size: { cols: number; rows: number }) => {
    setDimensions(size);
    const active = sessionRef.current;
    if (!active) return;
    void api.resize(active.id, size).then((result) => {
      if (!result.ok && result.code !== "terminal_closed") reportError(result.error || "终端尺寸更新失败");
    });
  };

  const ensureRuntime = async () => {
    if (runtimeRef.current) return runtimeRef.current;
    if (!runtimePromiseRef.current) {
      runtimePromiseRef.current = import("./xterm-runtime.ts").then((module) => {
        if (!canvasRef.current) throw new Error("终端画布尚未挂载");
        const runtime = module.createXtermRuntime({ element: canvasRef.current, onInput: sendInput, onResize: handleResize });
        runtimeRef.current = runtime;
        return runtime;
      });
    }
    return runtimePromiseRef.current;
  };

  const applyEvent = (event: TerminalEvent) => {
    const active = sessionRef.current;
    if (!active || active.id !== event.sessionId) {
      const events = bufferedEventsRef.current.get(event.sessionId) || [];
      if (events.length < 256) events.push(event);
      bufferedEventsRef.current.set(event.sessionId, events);
      return;
    }
    if (event.sequence <= lastSequenceRef.current) return;
    lastSequenceRef.current = event.sequence;
    if (event.type === "output") {
      runtimeRef.current?.write(event.data);
      return;
    }
    sessionRef.current = null;
    acceptInputRef.current = false;
    setSession(null);
    setPhase(capabilities?.available === false ? "unavailable" : "idle");
    const suffix = event.exitCode === null ? "" : `，退出码 ${event.exitCode}`;
    runtimeRef.current?.write(`\r\n\x1b[90m[终端已结束${suffix}]\x1b[0m\r\n`);
  };

  useEffect(() => {
    aliveRef.current = true;
    const unsubscribe = api.onEvent(applyEvent);
    const focus = () => runtimeRef.current?.focus();
    window.addEventListener("hicode:terminal-focus", focus);
    void (async () => {
      const detected = await api.capabilities();
      if (!aliveRef.current) return;
      setCapabilities(detected);
      if (!detected.available) {
        setPhase("unavailable");
        setMessage(detected.reason || "当前环境不支持集成终端");
        return;
      }
      const current = await api.status();
      if (!aliveRef.current) return;
      if (!current.ok || !current.active || !current.session) {
        setPhase("idle");
        return;
      }
      const runtime = await ensureRuntime();
      sessionRef.current = current.session;
      acceptInputRef.current = true;
      setSession(current.session);
      setPhase("running");
      lastSequenceRef.current = 0;
      if (current.snapshot) runtime.write(current.snapshot);
      runtime.fit();
      runtime.focus();
    })().catch((error) => {
      setPhase("unavailable");
      reportError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      aliveRef.current = false;
      unsubscribe();
      window.removeEventListener("hicode:terminal-focus", focus);
      if (inputTimerRef.current !== null) window.clearTimeout(inputTimerRef.current);
      flushInput();
      const active = sessionRef.current;
      acceptInputRef.current = false;
      if (active) void api.close(active.id, "renderer_unmounted");
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
      runtimePromiseRef.current = null;
    };
  }, []);

  const start = async () => {
    if (!capabilities?.available || phase === "starting" || phase === "running") return;
    setMessage("");
    setPhase("starting");
    try {
      const runtime = await ensureRuntime();
      runtime.reset();
      runtime.fit();
      const result = await api.create(runtime.dimensions());
      if (!result.ok || !result.session) {
        setPhase("idle");
        setMessage(result.error || "终端启动失败");
        return;
      }
      sessionRef.current = result.session;
      acceptInputRef.current = true;
      setSession(result.session);
      setPhase("running");
      lastSequenceRef.current = 0;
      if (result.snapshot) runtime.write(result.snapshot);
      const pending = bufferedEventsRef.current.get(result.session.id) || [];
      bufferedEventsRef.current.delete(result.session.id);
      for (const event of pending) applyEvent(event);
      const size = runtime.fit();
      await api.resize(result.session.id, size);
      runtime.focus();
    } catch (error) {
      setPhase("idle");
      reportError(error instanceof Error ? error.message : String(error));
    }
  };

  const stop = async () => {
    const active = sessionRef.current;
    if (!active || phase === "stopping") return;
    setMessage("");
    setPhase("stopping");
    acceptInputRef.current = false;
    flushInput();
    await inputChainRef.current;
    const result = await api.close(active.id, "user_closed");
    if (!result.ok) {
      acceptInputRef.current = true;
      setPhase("running");
      reportError(result.error || "终端关闭失败");
    }
  };

  const stateLabel = phase === "running" ? "运行中" : phase === "starting" ? "等待授权" : phase === "stopping" ? "正在关闭" : phase === "unavailable" ? "不可用" : phase === "loading" ? "检测中" : "未启动";

  return (
    <div className="terminal-shell" data-testid="integrated-terminal" data-phase={phase}>
      <header className="terminal-head">
        <div className="terminal-heading">
          <h2>终端</h2>
          <p className="mono" title={session?.cwd || capabilities?.shell?.executable || ""}>
            {session?.cwd || capabilities?.shell?.label || "当前工作区"}
          </p>
        </div>
        <div className="terminal-actions">
          <span className={`terminal-state ${phase}`}>{stateLabel}</span>
          <button type="button" className="ghost" disabled={!runtimeRef.current} onClick={() => runtimeRef.current?.clear()}>清屏</button>
          <button type="button" className="ghost" disabled={phase !== "running"} onClick={() => void stop()}>停止</button>
          <button type="button" className="primary" disabled={!capabilities?.available || phase === "running" || phase === "starting" || phase === "stopping"} onClick={() => void start()}>
            {session ? "终端运行中" : "启动终端"}
          </button>
        </div>
      </header>

      {message ? <div className="terminal-message" role="alert">{message}</div> : null}

      <section className="terminal-frame" aria-label="集成终端">
        <div ref={canvasRef} className="terminal-canvas" />
        {!runtimeRef.current && phase !== "starting" ? (
          <div className="terminal-empty">
            <strong>{phase === "unavailable" ? "终端不可用" : "尚未启动终端"}</strong>
            <span>{phase === "unavailable"
              ? capabilities?.setupHint
              : "启动需明确授权；授权后本会话输入会直接执行，切换工作区或关闭窗口将终止进程树。"}</span>
          </div>
        ) : null}
      </section>

      <footer className="terminal-meta mono">
        <span>{session?.shell.label || capabilities?.shell?.label || "PTY"}</span>
        <span>{dimensions.cols} × {dimensions.rows}</span>
      </footer>
    </div>
  );
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function splitUtf8(value: string, maxBytes: number) {
  const chunks: string[] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const character of value) {
    const size = utf8Length(character);
    if (current.length && bytes + size > maxBytes) {
      chunks.push(current.join(""));
      current = [];
      bytes = 0;
    }
    current.push(character);
    bytes += size;
  }
  if (current.length) chunks.push(current.join(""));
  return chunks;
}
