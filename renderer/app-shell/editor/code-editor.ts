import { EditorState } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";

export interface CodeEditorOptions {
  parent: HTMLElement;
  onChange(): void;
  onSave(): void;
}

export interface CodeEditorSurface {
  setDocument(content: string, filePath: string): void;
  getContent(): string;
  focus(): void;
  destroy(): void;
}

export interface CodeEditorFactory {
  create(options: CodeEditorOptions): CodeEditorSurface;
}

export function createCodeEditorFactory(): CodeEditorFactory {
  return Object.freeze({
    create(options: CodeEditorOptions): CodeEditorSurface {
      if (!(options?.parent instanceof HTMLElement)) throw new Error("Code editor parent is required");
      const view = new EditorView({ state: editorState("", "", options), parent: options.parent });
      return Object.freeze({
        setDocument(content: string, filePath: string) {
          view.setState(editorState(String(content || ""), String(filePath || ""), options));
        },
        getContent: () => view.state.doc.toString(),
        focus: () => view.focus(),
        destroy: () => view.destroy(),
      });
    },
  });
}

function editorState(content: string, filePath: string, options: CodeEditorOptions) {
  return EditorState.create({
    doc: content,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      languageForPath(filePath),
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => { options.onSave(); return true; } },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update: ViewUpdate) => { if (update.docChanged) options.onChange(); }),
      EditorView.theme({
        "&": { height: "100%", backgroundColor: "transparent" },
        ".cm-scroller": { overflow: "auto", fontFamily: '"SF Mono", ui-monospace, Menlo, monospace', fontSize: "12.5px", lineHeight: "1.6" },
        ".cm-content": { padding: "12px 0", caretColor: "#17120d" },
        ".cm-gutters": { backgroundColor: "rgba(239, 226, 207, .34)", borderRight: "1px solid rgba(216, 201, 180, .72)", color: "#9b8f80" },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(209, 190, 162, .18)" },
        "&.cm-focused": { outline: "none" },
      }),
    ],
  });
}

function languageForPath(filePath: string) {
  const extension = filePath.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  if (["js", "mjs", "cjs", "jsx"].includes(extension)) return javascript({ jsx: extension === "jsx" });
  if (["ts", "tsx"].includes(extension)) return javascript({ typescript: true, jsx: extension === "tsx" });
  if (extension === "json") return json();
  if (["md", "markdown"].includes(extension)) return markdown();
  if (extension === "css") return css();
  if (["html", "htm"].includes(extension)) return html();
  return [];
}
