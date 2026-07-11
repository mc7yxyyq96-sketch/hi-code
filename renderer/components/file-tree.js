import { shortPath } from "../utils/format.js";

export function mountFileTree({ elements, api, getCwd, toast = null }) {
  let fileDir = "";
  let activeFile = null;
  let conflict = null;
  let saving = false;
  const {
    modal,
    pathLabel,
    list,
    editorMount,
    emptyState,
    status,
    saveButton,
    reloadButton,
    forceButton,
    closeButton,
  } = elements;

  const editorLoader = window.hicodeAppShell?.editor;
  if (!editorLoader?.load) throw new Error("CodeMirror editor loader is unavailable");
  let editor = null;
  let editorPromise = null;

  const ensureEditor = async () => {
    if (editor) return editor;
    editorPromise ||= editorLoader.load().then((factory) => factory.create({
      parent: editorMount,
      onChange: handleEditorUpdate,
      onSave: () => { void save(); },
    }));
    try {
      editor = await editorPromise;
      return editor;
    } catch (error) {
      editorPromise = null;
      throw error;
    }
  };

  const open = async (dir) => {
    fileDir = dir || getCwd();
    modal.classList.remove("hidden");
    setState("loading", "正在加载编辑器…");
    try {
      await ensureEditor();
      await render(fileDir);
      if (conflict) setState("conflict", "磁盘文件已被其他程序修改。请重新加载，或明确选择强制覆盖。");
      else if (activeFile) setState(isDirty() ? "dirty" : "clean", isDirty() ? "有未保存修改" : `${activeFile.relativePath || shortPath(activeFile.path)} · UTF-8`);
      else setState("empty", "选择一个 UTF-8 文本文件开始编辑。最大 2MB。");
      editor?.focus();
    } catch (error) {
      showError(error?.message || "编辑器加载失败，请重试");
    }
  };

  const close = () => {
    if (isDirty() && !confirmDiscard("关闭编辑器会丢失尚未保存的修改。仍要关闭吗？")) return false;
    modal.classList.add("hidden");
    return true;
  };

  const render = async (dir) => {
    fileDir = dir;
    pathLabel.textContent = shortPath(activeFile?.relativePath || dir);
    const entries = await api.listDir(dir);
    list.replaceChildren();
    if (!samePath(dir, getCwd())) {
      const up = fileRow("返回上级", "i-chev back");
      up.onclick = () => { void render(parentDir(dir)); };
      list.appendChild(up);
    }
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "file-empty";
      empty.textContent = "这个目录没有可显示的文件。";
      list.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const row = fileRow(entry.name, entry.dir ? "i-folder" : "i-edit");
      row.dataset.path = entry.path;
      row.classList.toggle("active", samePath(activeFile?.path, entry.path));
      row.onclick = () => {
        if (entry.dir) void render(entry.path);
        else void openFile(entry.path);
      };
      list.appendChild(row);
    }
  };

  async function openFile(filePath, { discard = false } = {}) {
    if (!api.has("openEditorFile")) return showError("当前版本未提供安全编辑 API");
    if (!discard && isDirty() && !confirmDiscard("打开其他文件会丢失尚未保存的修改。仍要继续吗？")) return false;
    setState("loading", "正在读取文件…");
    try {
      await ensureEditor();
    } catch (error) {
      return showError(error?.message || "编辑器加载失败，请重试");
    }
    const result = await api.openEditorFile({ path: filePath });
    if (!result?.ok) return showError(result?.error || "文件读取失败");
    activeFile = result.file;
    conflict = null;
    editor.setDocument(activeFile.content, activeFile.path);
    editorMount.dataset.currentPath = activeFile.path;
    emptyState.classList.add("hidden");
    editorMount.classList.remove("hidden");
    pathLabel.textContent = shortPath(activeFile.relativePath || activeFile.path);
    setState("clean", `${activeFile.relativePath || shortPath(activeFile.path)} · ${formatBytes(activeFile.size)} · UTF-8`);
    await render(fileDir);
    editor.focus();
    return true;
  }

  async function save({ force = false } = {}) {
    if (!activeFile || !editor || saving || !api.has("saveEditorFile")) return false;
    if (force && !conflict) return false;
    if (force && !window.confirm("磁盘文件已变化。强制覆盖会丢失外部修改，确定继续吗？")) return false;
    saving = true;
    setState("saving", force ? "正在强制覆盖磁盘文件…" : "正在保存…");
    const result = await api.saveEditorFile({
      path: activeFile.path,
      content: editor.getContent(),
      expectedRevision: activeFile.revision,
      force,
    });
    saving = false;
    if (!result?.ok) {
      if (result?.code === "file_conflict") {
        conflict = result;
        setState("conflict", "磁盘文件已被其他程序修改。请重新加载，或明确选择强制覆盖。");
        toast?.info?.("检测到磁盘冲突，未覆盖外部修改。");
      } else showError(result?.error || "文件保存失败");
      return false;
    }
    activeFile = result.file;
    conflict = null;
    setState("clean", `${result.forced ? "已强制覆盖" : "已保存"} · ${activeFile.relativePath || shortPath(activeFile.path)}`);
    toast?.ok?.(result.forced ? "已按确认覆盖磁盘文件" : "文件已保存");
    return true;
  }

  async function reload() {
    if (!activeFile) return false;
    if (isDirty() && !window.confirm("重新加载会丢失编辑器里的未保存修改，确定继续吗？")) return false;
    return openFile(activeFile.path, { discard: true });
  }

  function handleEditorUpdate() {
    if (!activeFile || saving) return;
    if (conflict) {
      setState("conflict", "磁盘文件已被其他程序修改。请重新加载，或明确选择强制覆盖。");
      return;
    }
    const dirty = isDirty();
    setState(dirty ? "dirty" : "clean", dirty ? "有未保存修改" : "内容与磁盘一致");
  }

  function isDirty() {
    return Boolean(activeFile && editor && editor.getContent() !== activeFile.content);
  }

  function setState(name, message) {
    modal.dataset.editorState = name;
    status.textContent = message;
    status.className = `file-editor-status is-${name}`;
    const dirty = isDirty();
    saveButton.disabled = !activeFile || !dirty || saving || name === "conflict";
    reloadButton.disabled = !activeFile || saving;
    forceButton.classList.toggle("hidden", name !== "conflict");
    forceButton.disabled = name !== "conflict" || saving;
  }

  function showError(message) {
    setState("error", message);
    toast?.error?.(message);
    return false;
  }

  saveButton.onclick = () => { void save(); };
  reloadButton.onclick = () => { void reload(); };
  forceButton.onclick = () => { void save({ force: true }); };
  closeButton.onclick = close;
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  setState("empty", "选择一个 UTF-8 文本文件开始编辑。最大 2MB。");

  return {
    open,
    close,
    render,
    openFile,
    save,
    reload,
    getDir: () => fileDir,
    getFile: () => activeFile ? { ...activeFile } : null,
    destroy: () => editor?.destroy(),
  };
}

function fileRow(label, iconClass) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "file-row";
  const icon = document.createElement("span");
  icon.className = iconClass;
  const text = document.createElement("span");
  text.textContent = label;
  row.append(icon, text);
  return row;
}

function parentDir(value) {
  const input = String(value || "");
  const windows = /^[a-z]:[\\/]/i.test(input) || (input.includes("\\") && !input.includes("/"));
  const separator = windows ? "\\" : "/";
  const normalized = input.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index < 0) return input;
  if (windows && index === 2) return normalized.slice(0, 3);
  if (!windows && index === 0) return "/";
  return normalized.slice(0, index).replace(/[\\/]/g, separator);
}

function samePath(a, b) {
  const left = String(a || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const right = String(b || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return left === right;
}

function confirmDiscard(message) {
  return typeof window.confirm !== "function" || window.confirm(message);
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}
