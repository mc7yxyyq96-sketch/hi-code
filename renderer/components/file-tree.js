import { shortPath } from "../utils/format.js";

export function mountFileTree({ elements, api, getCwd }) {
  let fileDir = "";
  const { modal, pathLabel, list, preview, closeButton } = elements;

  const open = async (dir) => {
    fileDir = dir || getCwd();
    modal.classList.remove("hidden");
    await render(fileDir);
  };

  const close = () => modal.classList.add("hidden");

  const render = async (dir) => {
    fileDir = dir;
    pathLabel.textContent = shortPath(dir);
    preview.textContent = "选择一个文件预览内容。";
    const entries = await api.listDir(dir);
    list.innerHTML = "";
    if (dir !== getCwd()) {
      const up = document.createElement("button");
      up.className = "file-row";
      up.innerHTML = `<span class="i-chev back"></span><span>返回上级</span>`;
      up.onclick = () => render(parentDir(dir));
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
      const row = document.createElement("button");
      row.className = "file-row";
      row.innerHTML = `<span class="${entry.dir ? "i-folder" : "i-edit"}"></span><span></span>`;
      row.querySelector("span:last-child").textContent = entry.name;
      row.onclick = async () => {
        if (entry.dir) return render(entry.path);
        const result = await api.readFile(entry.path);
        preview.textContent = result.error || result.content || "";
        pathLabel.textContent = shortPath(result.path || entry.path);
      };
      list.appendChild(row);
    }
  };

  closeButton.onclick = close;
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });

  return { open, close, render, getDir: () => fileDir };
}

function parentDir(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return "/" + parts.slice(0, -1).join("/");
}
