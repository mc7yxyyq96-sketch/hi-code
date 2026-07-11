import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface XtermRuntime {
  write(data: string): void;
  clear(): void;
  reset(): void;
  focus(): void;
  fit(): { cols: number; rows: number };
  dimensions(): { cols: number; rows: number };
  dispose(): void;
}

export function createXtermRuntime({
  element,
  onInput,
  onResize,
}: {
  element: HTMLElement;
  onInput(data: string): void;
  onResize(size: { cols: number; rows: number }): void;
}): XtermRuntime {
  const terminal = new Terminal({
    allowProposedApi: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 1.25,
    minimumContrastRatio: 4.5,
    rightClickSelectsWord: true,
    screenReaderMode: true,
    scrollback: 5000,
    scrollOnUserInput: true,
    theme: {
      background: "#151612",
      foreground: "#f0eee7",
      cursor: "#f2c66d",
      cursorAccent: "#151612",
      selectionBackground: "#536f68aa",
      black: "#151612",
      red: "#df6a5f",
      green: "#81ad78",
      yellow: "#e0b86a",
      blue: "#78a9d1",
      magenta: "#b58acb",
      cyan: "#69b4ad",
      white: "#e8e5dc",
      brightBlack: "#6c7068",
      brightRed: "#ef8177",
      brightGreen: "#9bc58f",
      brightYellow: "#f2cf83",
      brightBlue: "#93bee0",
      brightMagenta: "#caa5da",
      brightCyan: "#85ccc4",
      brightWhite: "#fffdf7",
    },
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(element);

  const inputDisposable = terminal.onData(onInput);
  const binaryDisposable = terminal.onBinary(onInput);
  let frame = 0;
  let lastCols = 0;
  let lastRows = 0;
  const fit = () => {
    if (!element.isConnected || element.clientWidth < 40 || element.clientHeight < 40) {
      return { cols: terminal.cols, rows: terminal.rows };
    }
    try { fitAddon.fit(); } catch {}
    const size = { cols: terminal.cols, rows: terminal.rows };
    if (size.cols !== lastCols || size.rows !== lastRows) {
      lastCols = size.cols;
      lastRows = size.rows;
      onResize(size);
    }
    return size;
  };
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  });
  observer.observe(element);
  frame = requestAnimationFrame(fit);

  const runtime: XtermRuntime = {
    write(data) { terminal.write(data); },
    clear() { terminal.clear(); },
    reset() { terminal.reset(); },
    focus() { terminal.focus(); },
    fit,
    dimensions() { return { cols: terminal.cols, rows: terminal.rows }; },
    dispose() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      inputDisposable.dispose();
      binaryDisposable.dispose();
      terminal.dispose();
    },
  };
  return Object.freeze(runtime);
}
