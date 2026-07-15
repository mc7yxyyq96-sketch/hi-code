const RENDERER_COMMANDS = new Set([
  "new-chat",
  "search",
  "focus-composer",
  "toggle-sidebar",
  "open-settings",
]);

export function normalizeNativeMenuCommand(value) {
  const command = typeof value === "string" ? value.trim() : "";
  return RENDERER_COMMANDS.has(command) ? command : "";
}

export function createNativeMenuTemplate({ appName = "Hi Code", platform = process.platform, sendCommand }) {
  if (typeof sendCommand !== "function") throw new TypeError("sendCommand must be a function");
  const dispatch = (command) => () => {
    const normalized = normalizeNativeMenuCommand(command);
    if (normalized) sendCommand(normalized);
  };

  const template = [
    {
      label: "文件",
      submenu: [
        { id: "hicode.new-chat", label: "新对话", accelerator: "CmdOrCtrl+N", click: dispatch("new-chat") },
        { id: "hicode.focus-composer", label: "聚焦输入框", accelerator: "CmdOrCtrl+L", click: dispatch("focus-composer") },
        { type: "separator" },
        platform === "darwin" ? { role: "close", label: "关闭窗口" } : { role: "quit", label: "退出" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "pasteAndMatchStyle", label: "粘贴并匹配样式" },
        { role: "delete", label: "删除" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "显示",
      submenu: [
        { id: "hicode.search", label: "搜索", accelerator: "CmdOrCtrl+K", click: dispatch("search") },
        { id: "hicode.toggle-sidebar", label: "切换侧边栏", accelerator: "CmdOrCtrl+Shift+S", click: dispatch("toggle-sidebar") },
        { id: "hicode.settings", label: "设置", accelerator: "CmdOrCtrl+,", click: dispatch("open-settings") },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切换全屏" },
      ],
    },
    {
      role: "windowMenu",
      label: "窗口",
    },
  ];

  if (platform === "darwin") {
    template.unshift({
      label: appName,
      submenu: [
        { role: "about", label: `关于 ${appName}` },
        { type: "separator" },
        { id: "hicode.app-settings", label: "设置", accelerator: "CmdOrCtrl+,", click: dispatch("open-settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: `隐藏 ${appName}` },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: `退出 ${appName}` },
      ],
    });
  }

  return template;
}

export function installNativeMenu({ app, Menu, sendCommand, platform = process.platform }) {
  if (!app || !Menu?.buildFromTemplate || !Menu?.setApplicationMenu) {
    throw new TypeError("Electron app and Menu are required");
  }
  const template = createNativeMenuTemplate({ appName: app.name || "Hi Code", platform, sendCommand });
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return { menu, template };
}
