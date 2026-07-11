#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { ELECTRON_COMPATIBILITY_TARGET } from "../../scripts/electron-compatibility.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureDir = path.join(root, "tests", "electron-e2e", "fixtures");
const resultDir = path.join(root, "test-results", "electron-e2e", `${process.platform}-${process.arch}`);
const baseline = JSON.parse(fs.readFileSync(path.join(fixtureDir, "layout-baseline.json"), "utf8"));
const updateFixtures = process.argv.includes("--update-fixtures");
const results = [];
const pageErrors = [];
let electronApp;
let userDataDir;
let modelServer;
let modelBaseURL = "";
let modelServerRequests = 0;
let embeddedRuntime = null;
let editorFixturePath = "";

function safeElectronEnv(isolatedHome) {
  const allowed = [
    "PATH", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
    "TMPDIR", "TMP", "TEMP", "SystemRoot", "DISPLAY", "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "CI",
  ];
  const env = {};
  for (const key of allowed) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  env.HOME = isolatedHome;
  env.USERPROFILE = isolatedHome;
  env.HICODE_E2E = "1";
  env.HICODE_BASE_URL = modelBaseURL;
  env.HICODE_MODEL = "hicode-e2e-model";
  env.HICODE_LEGACY_STDOUT_BRIDGE = "0";
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  return env;
}

async function startModelServer() {
  modelServer = http.createServer((request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
      response.writeHead(404).end("not found");
      return;
    }
    modelServerRequests++;
    request.resume();
    request.on("end", () => {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "protocol-native " } }] })}\n\n`);
      setTimeout(() => {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "desktop response" } }] })}\n\n`);
        response.end("data: [DONE]\n\n");
      }, 12);
    });
  });
  await new Promise((resolve, reject) => {
    modelServer.once("error", reject);
    modelServer.listen(0, "127.0.0.1", resolve);
  });
  const address = modelServer.address();
  assert.ok(address && typeof address === "object", "Model test server did not bind a TCP port");
  modelBaseURL = `http://127.0.0.1:${address.port}/v1`;
}

function record(name, status, detail = "") {
  results.push({ name, status, detail });
  console.log(`  ${status === "passed" ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function check(name, action) {
  try {
    await action();
    record(name, "passed");
  } catch (error) {
    record(name, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function setContentSize(width, height) {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Electron window is missing");
    window.setContentSize(size.width, size.height);
  }, { width, height });
}

async function waitVisible(page, selector, timeout = 8_000) {
  const locator = page.locator(selector);
  await locator.waitFor({ state: "visible", timeout });
  return locator;
}

async function returnHome(page) {
  const button = page.locator("#newChat");
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await waitVisible(page, "#home");
}

async function verifyNavigation(page, width) {
  for (const item of baseline.navigation) {
    const button = page.locator(item.button);
    await button.scrollIntoViewIfNeeded();
    assert.equal(await button.isVisible(), true, `${item.name} has no visible navigation entry at ${width}px`);
    await button.click();
    await waitVisible(page, item.view);
    await returnHome(page);
  }

  const settingsButton = page.locator("#settingsBtn");
  await settingsButton.scrollIntoViewIfNeeded();
  await settingsButton.click();
  await waitVisible(page, "#settings");
  await page.locator("#cfg-cancel").click();
  assert.equal(await page.locator("#settings").isHidden(), true, `Settings did not close at ${width}px`);
}

async function captureHome(page, width) {
  await setContentSize(width, baseline.height);
  await page.waitForTimeout(220);
  if (!(await page.locator("#home").isVisible())) await returnHome(page);

  const layout = await page.evaluate(() => {
    const brand = document.querySelector(".brand-label");
    const brandParent = brand?.closest(".brand-main");
    const brandRect = brand?.getBoundingClientRect();
    const parentRect = brandParent?.getBoundingClientRect();
    const crumbLabel = document.querySelector(".crumb span:first-child");
    const crumbRect = crumbLabel?.getBoundingClientRect();
    const crumbStyle = crumbLabel ? getComputedStyle(crumbLabel) : null;
    const crumbFontSize = Number.parseFloat(crumbStyle?.fontSize || "0");
    const workspaceBar = document.querySelector("#workspacebar")?.getBoundingClientRect();
    const shellMount = document.querySelector("#appShellMount");
    const shellTrigger = document.querySelector(".app-shell-nav-trigger");
    const topActions = [...document.querySelectorAll(".workspace-actions .top-btn")]
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          id: button.id,
          fullyInsideHeader: !!workspaceBar && rect.left >= workspaceBar.left - 1 && rect.right <= workspaceBar.right + 1,
        };
      });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rootOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyOverflowX: document.body.scrollWidth > document.body.clientWidth + 1,
      brand: brandRect && parentRect ? {
        text: brand.textContent.trim(),
        width: brandRect.width,
        fullyInsideParent: brandRect.left >= parentRect.left - 1 && brandRect.right <= parentRect.right + 1,
      } : null,
      crumb: crumbRect ? {
        text: crumbLabel.textContent.trim(),
        singleLine: crumbStyle?.whiteSpace === "nowrap" && crumbRect.height <= crumbFontSize * 1.7,
      } : null,
      topActions,
      appShell: {
        implementation: shellMount?.dataset.appShell || "",
        activeRoute: shellMount?.dataset.activeRoute || "",
        triggerVisible: Boolean(shellTrigger?.getClientRects().length),
      },
    };
  });

  assert.ok(Math.abs(layout.viewport.width - width) <= 2, `Expected ${width}px content width, got ${layout.viewport.width}`);
  assert.equal(layout.rootOverflowX, false, `Root document overflows horizontally at ${width}px`);
  assert.equal(layout.bodyOverflowX, false, `Body overflows horizontally at ${width}px`);
  assert.equal(layout.brand?.text, baseline.brand.text, `Brand text changed at ${width}px`);
  assert.ok(layout.brand?.width >= baseline.brand.minimumVisibleWidth, `Brand is truncated at ${width}px`);
  assert.equal(layout.brand?.fullyInsideParent, true, `Brand is clipped by its parent at ${width}px`);
  assert.equal(layout.crumb?.text, baseline.brand.text, `Workspace brand text changed at ${width}px`);
  assert.equal(layout.crumb?.singleLine, true, `Workspace brand wrapped onto multiple lines at ${width}px`);
  assert.equal(layout.appShell.implementation, "react-typescript-vite", `Typed App Shell is not mounted at ${width}px`);
  assert.equal(layout.appShell.activeRoute, "home", `App Shell route is not synchronized at ${width}px`);
  if (width <= 820) {
    assert.equal(layout.topActions.length, 0, `Compact top actions should be hidden at ${width}px`);
    assert.equal(layout.appShell.triggerVisible, true, `Compact App Shell navigation is missing at ${width}px`);
  }
  else {
    assert.equal(layout.topActions.length, 5, `Expected every top action at ${width}px`);
    assert.equal(layout.topActions.every((action) => action.fullyInsideHeader), true, `A top action is clipped at ${width}px`);
    assert.equal(layout.appShell.triggerVisible, false, `Compact App Shell navigation should be hidden at ${width}px`);
  }

  const resultPath = path.join(resultDir, `home-${width}.png`);
  const image = await page.screenshot({ path: resultPath, animations: "disabled" });
  assert.ok(image.length > 12_000, `Screenshot is unexpectedly small at ${width}px`);
  if (updateFixtures) fs.copyFileSync(resultPath, path.join(fixtureDir, `home-${width}.png`));
  else assert.ok(fs.statSync(path.join(fixtureDir, `home-${width}.png`)).size > 12_000, `Committed ${width}px fixture is missing or blank`);
  return layout;
}

async function verifyTypedAppShell(page) {
  await setContentSize(720, baseline.height);
  await returnHome(page);
  const trigger = await waitVisible(page, ".app-shell-nav-trigger");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await trigger.click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  const drawer = await waitVisible(page, "#appShellDrawer");
  const routeButtons = drawer.locator(".app-shell-route");
  assert.ok(await routeButtons.count() >= 10, "Compact App Shell omits production routes");
  await drawer.getByRole("button", { name: "任务", exact: true }).click();
  await waitVisible(page, "#jobView");
  assert.equal(await page.locator("#appShellDrawer").isHidden(), true, "App Shell drawer did not close after navigation");
  assert.equal(await page.locator("#app").getAttribute("data-shell-route"), "jobs");
  assert.ok((await page.locator("#jobsBtn").getAttribute("class"))?.includes("active"));

  await trigger.click();
  await waitVisible(page, "#appShellDrawer");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#appShellDrawer").isHidden(), true, "Escape did not close the App Shell drawer");
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, "App Shell trigger did not regain focus");

  await setContentSize(1024, baseline.height);
  await page.waitForTimeout(120);
  assert.equal(await trigger.isHidden(), true, "Compact App Shell trigger should be hidden above the compact breakpoint");
}

async function openLocalChat(page) {
  await returnHome(page);
  const input = page.locator("#input");
  await input.fill("/help");
  await page.locator("#send").click();
  await waitVisible(page, "#chatview");
}

async function verifyProtocolNativeDesktopTurn(page) {
  await setContentSize(1024, baseline.height);
  await returnHome(page);
  const input = page.locator("#input");
  await input.fill("render the protocol-native desktop response");
  await page.locator("#send").click();
  await waitVisible(page, "#chatview");
  await page.waitForFunction(() => {
    const messages = [...document.querySelectorAll(".msg.agent .agent-body")];
    return messages.some((message) => message.textContent?.includes("protocol-native desktop response"));
  }, undefined, { timeout: 8_000 });
  const assistantText = await page.locator(".msg.agent .agent-body").allTextContents();
  assert.ok(assistantText.some((text) => text.includes("protocol-native desktop response")), JSON.stringify(assistantText));
  assert.equal(modelServerRequests, 1, "Desktop turn did not reach the isolated model server exactly once");
}

async function verifyResponsivePanels(page) {
  await setContentSize(1024, baseline.height);
  await openLocalChat(page);
  const timelineButton = await waitVisible(page, "#timelineDrawerBtn");
  await timelineButton.click();
  assert.equal(await timelineButton.getAttribute("aria-expanded"), "true");
  await waitVisible(page, "#timelinePanel");
  const backdrop = page.locator("#workbenchDrawerBackdrop");
  const backdropBox = await backdrop.boundingBox();
  assert.ok(backdropBox, "Timeline drawer backdrop has no visible bounds");
  await backdrop.click({ position: { x: Math.max(1, backdropBox.width - 20), y: Math.max(1, backdropBox.height / 2) } });
  assert.equal(await timelineButton.getAttribute("aria-expanded"), "false");

  await setContentSize(720, baseline.height);
  await page.waitForTimeout(180);
  const diffButton = await waitVisible(page, "#diffDrawerBtn");
  await diffButton.click();
  assert.equal(await diffButton.getAttribute("aria-expanded"), "true");
  await waitVisible(page, "#diffPanel");
  await page.keyboard.press("Escape");
  assert.equal(await diffButton.getAttribute("aria-expanded"), "false");

  await setContentSize(1440, baseline.height);
  await page.waitForTimeout(180);
  assert.equal(await page.locator("#timelineDrawerBtn").isHidden(), true, "Desktop layout should not show drawer controls");
  assert.equal(await page.locator("#timelinePanel").isVisible(), true, "Desktop timeline must remain visible");
  assert.equal(await page.locator("#diffPanel").isVisible(), true, "Desktop diff panel must remain visible");
}

async function verifySessionKeyboardAndLongTranscript(page) {
  await setContentSize(1024, baseline.height);
  await openLocalChat(page);
  await page.evaluate(() => {
    const workspace = window.hicodeAppShell?.workspace;
    if (!workspace) throw new Error("Typed workspace bridge is unavailable");
    const messages = Array.from({ length: 10_000 }, (_, index) => ({
      id: `e2e-long-message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      text: `Long transcript message ${index}`,
      status: "complete",
      attachments: [],
    }));
    workspace.setConversation(messages, "e2e-long-session");
    workspace.setSessions([
      { id: "e2e-session-one", firstPrompt: "First keyboard session", messageCount: 4, updatedAt: Date.now(), model: "e2e", cwd: "/e2e" },
      { id: "e2e-session-two", firstPrompt: "Second keyboard session", messageCount: 6, updatedAt: Date.now() - 1_000, model: "e2e", cwd: "/e2e" },
      { id: "e2e-session-three", firstPrompt: "Third keyboard session", messageCount: 8, updatedAt: Date.now() - 2_000, model: "e2e", cwd: "/e2e" },
    ]);
  });

  await page.waitForFunction(() => document.querySelector("#chat")?.dataset.totalMessages === "10000");
  const transcript = await page.evaluate(() => {
    const chat = document.querySelector("#chat");
    return {
      totalMessages: Number(chat?.dataset.totalMessages || 0),
      mountedMessages: Number(chat?.dataset.mountedMessages || 0),
      messageRows: chat?.querySelectorAll(".msg").length || 0,
      windowStart: Number(chat?.dataset.windowStart || 0),
      owner: chat?.dataset.workspaceOwner || "",
    };
  });
  assert.equal(transcript.totalMessages, 10_000);
  assert.ok(transcript.mountedMessages <= 160, `Mounted ${transcript.mountedMessages} transcript rows`);
  assert.equal(transcript.messageRows, transcript.mountedMessages);
  assert.equal(transcript.owner, "react");

  await page.locator("#chat").getByRole("button", { name: "较早消息" }).click();
  await page.waitForFunction((previousStart) => Number(document.querySelector("#chat")?.dataset.windowStart || 0) < previousStart, transcript.windowStart);

  const sessionButtons = page.locator("#sessions .sess-main");
  await sessionButtons.first().waitFor({ state: "visible" });
  assert.equal(await sessionButtons.count(), 3);
  await sessionButtons.nth(0).focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await sessionButtons.nth(1).evaluate((element) => document.activeElement === element), true, "ArrowDown did not move session keyboard focus");
  await page.keyboard.press("End");
  assert.equal(await sessionButtons.nth(2).evaluate((element) => document.activeElement === element), true, "End did not move session keyboard focus to the last session");

  const workbenchImage = await page.screenshot({
    path: path.join(resultDir, "workspace-long-transcript-1024.png"),
    animations: "disabled",
  });
  assert.ok(workbenchImage.length > 12_000, "Long transcript screenshot is unexpectedly small");

  await page.evaluate(() => {
    const workspace = window.hicodeAppShell?.workspace;
    workspace?.clearConversation("e2e-long-session");
    workspace?.setSessions([]);
  });
}

async function verifyIntegratedEditor(page) {
  await setContentSize(720, baseline.height);
  const filesButton = page.locator("#filesBtn");
  await filesButton.scrollIntoViewIfNeeded();
  await filesButton.click();
  await waitVisible(page, "#files");
  const sourceDirectory = page.locator("#fileList .file-row").filter({ hasText: "src" });
  await sourceDirectory.click();
  const sourceFile = page.locator("#fileList .file-row").filter({ hasText: "editor-e2e.ts" });
  await sourceFile.click();
  await waitVisible(page, "#fileEditorMount .cm-editor");
  await page.waitForFunction(() => document.querySelector("#files")?.dataset.editorState === "clean");

  const editorContent = page.locator("#fileEditorMount .cm-content");
  await editorContent.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText("export const editorValue = 2;\n");
  await page.waitForFunction(() => document.querySelector("#files")?.dataset.editorState === "dirty");
  await page.locator("#fileSave").click();
  await page.waitForFunction(() => document.querySelector("#files")?.dataset.editorState === "clean");
  assert.equal(fs.readFileSync(editorFixturePath, "utf8"), "export const editorValue = 2;\n");

  await editorContent.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText("export const editorValue = 3;\n");
  fs.writeFileSync(editorFixturePath, "export const externalValue = 9;\n");
  await page.locator("#fileSave").click();
  await page.waitForFunction(() => document.querySelector("#files")?.dataset.editorState === "conflict");
  const fileConflict = await page.locator("#fileEditorStatus").textContent();
  assert.match(fileConflict || "", /磁盘文件已被其他程序修改/);
  assert.equal(fs.readFileSync(editorFixturePath, "utf8"), "export const externalValue = 9;\n", "file_conflict overwrote the external disk change");
  assert.equal(await page.locator("#fileForceSave").isVisible(), true, "Conflict does not expose an explicit force action");
  assert.equal(await page.locator("#fileSave").isDisabled(), true, "Conflict still permits a normal stale save");
  await editorContent.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.insertText(" ");
  assert.equal(await page.locator("#files").getAttribute("data-editor-state"), "conflict", "Typing after a conflict hid the conflict state");
  assert.equal(await page.locator("#fileForceSave").isVisible(), true, "Typing after a conflict hid the force action");
  const editorLayout = await page.locator("#files .file-card").evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(editorLayout.scrollWidth <= editorLayout.width + 1, `Compact editor overflows horizontally: ${JSON.stringify(editorLayout)}`);
  const editorConflictImage = await page.screenshot({
    path: path.join(resultDir, "editor-conflict-720.png"),
    animations: "disabled",
  });
  assert.ok(editorConflictImage.length > 12_000, "Editor conflict screenshot is unexpectedly small");

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#fileReload").click();
  await page.waitForFunction(() => document.querySelector("#files")?.dataset.editorState === "clean");
  assert.match(await editorContent.textContent() || "", /externalValue/);
  await page.locator("#file-close").click();
  assert.equal(await page.locator("#files").isHidden(), true);
}

async function verifyDiffCommentRevisionRequest(page) {
  await setContentSize(1440, baseline.height);
  await openLocalChat(page);
  await page.locator(".toast").evaluateAll((elements) => elements.forEach((element) => element.click()));
  const requestsBefore = modelServerRequests;
  const assistantMessagesBefore = await page.locator(".msg.agent .agent-body").count();
  await page.evaluate(() => {
    const workspace = window.hicodeAppShell?.workspace;
    if (!workspace) throw new Error("Typed workspace bridge is unavailable");
    workspace.setDiffs([{
      id: "e2e-review-diff",
      path: "src/editor-e2e.ts",
      before: "export const editorValue = 2;\n",
      after: "export const externalValue = 9;\n",
      status: "pending",
    }], "e2e-review-diff");
  });
  const changedLine = page.locator("#diffPanel .diff-code-line.add").first();
  await changedLine.click();
  const reviewComment = "请把变量名改为 validatedValue，并保留导出。";
  await page.locator("#diffPanel .diff-review textarea").fill(reviewComment);
  const reviewImage = await page.screenshot({
    path: path.join(resultDir, "diff-review-comment-1440.png"),
    animations: "disabled",
  });
  assert.ok(reviewImage.length > 12_000, "Diff review screenshot is unexpectedly small");
  await page.locator("#diffPanel .diff-review button").click();
  await page.waitForFunction((text) => [...document.querySelectorAll(".msg.user")].some((message) => message.textContent?.includes(text)), reviewComment);
  await page.waitForFunction(
    (count) => document.querySelectorAll(".msg.agent .agent-body").length > count,
    assistantMessagesBefore,
    { timeout: 8_000 },
  );
  const latestAssistant = page.locator(".msg.agent .agent-body").last();
  await latestAssistant.waitFor({ state: "visible", timeout: 8_000 });
  assert.match(await latestAssistant.textContent() || "", /protocol-native desktop response/);
  await page.waitForFunction(() => document.querySelector("#runStatus")?.classList.contains("hidden"), undefined, { timeout: 8_000 });
  assert.equal(modelServerRequests, requestsBefore + 1, "Diff review comment did not enter the real model Runtime");
}

async function verifyIntegratedTerminal(page) {
  console.log("    [terminal] prepare execution policy");
  await setContentSize(1024, baseline.height);
  await returnHome(page);
  const accessLabel = page.locator("#accessLabel");
  if ((await accessLabel.textContent()) !== "完全访问") {
    await page.evaluate(() => {
      window.__hicodeTerminalPolicyReady = false;
      window.hicode.onTurnDone(() => { window.__hicodeTerminalPolicyReady = true; });
    });
    await page.locator("#access").click();
    await page.waitForFunction(() => document.querySelector("#accessLabel")?.textContent === "完全访问");
    await page.waitForFunction(() => window.__hicodeTerminalPolicyReady === true, undefined, { timeout: 8_000 });
  }

  console.log("    [terminal] open workbench");
  const terminalButton = page.locator("#terminalBtn");
  await terminalButton.scrollIntoViewIfNeeded();
  await terminalButton.click();
  await waitVisible(page, "#terminalView");
  const terminal = page.locator('[data-testid="integrated-terminal"]');
  await terminal.waitFor({ state: "visible" });
  console.log("    [terminal] start PTY");
  await terminal.getByRole("button", { name: "启动终端" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="integrated-terminal"]')?.getAttribute("data-phase") === "running", undefined, { timeout: 10_000 });

  console.log("    [terminal] execute command");
  const input = page.locator("#terminalView .xterm-helper-textarea");
  await input.waitFor({ state: "attached", timeout: 8_000 });
  await input.focus();
  await page.keyboard.type(process.platform === "win32" ? "Write-Output HICODE_PTY_E2E" : "printf 'HICODE_PTY_E2E\\n'");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#terminalView .xterm-rows")?.textContent?.includes("HICODE_PTY_E2E"), undefined, { timeout: 8_000 });

  console.log("    [terminal] capture responsive layouts");
  const desktopLayout = await page.locator("#terminalView").evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    phase: element.querySelector('[data-testid="integrated-terminal"]')?.getAttribute("data-phase"),
  }));
  assert.equal(desktopLayout.phase, "running");
  assert.ok(desktopLayout.scrollWidth <= desktopLayout.width + 1, `Desktop terminal overflows horizontally: ${JSON.stringify(desktopLayout)}`);
  const desktopImage = await page.screenshot({
    path: path.join(resultDir, "terminal-running-1024.png"),
    animations: "disabled",
  });
  assert.ok(desktopImage.length > 12_000, "Desktop terminal screenshot is unexpectedly small");

  await setContentSize(720, baseline.height);
  await page.waitForTimeout(180);
  const compactLayout = await page.locator("#terminalView").evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    stopVisible: Boolean([...element.querySelectorAll("button")].find((button) => button.textContent?.trim() === "停止")?.getClientRects().length),
  }));
  assert.ok(compactLayout.scrollWidth <= compactLayout.width + 1, `Compact terminal overflows horizontally: ${JSON.stringify(compactLayout)}`);
  assert.equal(compactLayout.stopVisible, true, "Compact terminal does not expose its stop action");
  const compactImage = await page.screenshot({
    path: path.join(resultDir, "terminal-running-720.png"),
    animations: "disabled",
  });
  assert.ok(compactImage.length > 12_000, "Compact terminal screenshot is unexpectedly small");

  console.log("    [terminal] stop PTY");
  await terminal.getByRole("button", { name: "停止" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="integrated-terminal"]')?.getAttribute("data-phase") === "idle", undefined, { timeout: 8_000 });
  const status = await page.evaluate(() => window.hicode.getTerminalStatus());
  assert.equal(status.ok, true);
  assert.equal(status.active, false);

  await returnHome(page);
  if ((await accessLabel.textContent()) === "完全访问") {
    await page.evaluate(() => { window.__hicodeTerminalPolicyReady = false; });
    await page.locator("#access").click();
    await page.waitForFunction(() => document.querySelector("#accessLabel")?.textContent === "需确认");
    await page.waitForFunction(() => window.__hicodeTerminalPolicyReady === true, undefined, { timeout: 8_000 });
  }
}

async function main() {
  fs.rmSync(resultDir, { recursive: true, force: true });
  fs.mkdirSync(resultDir, { recursive: true, mode: 0o755 });
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-electron-e2e-"));
  editorFixturePath = path.join(userDataDir, "src", "editor-e2e.ts");
  fs.mkdirSync(path.dirname(editorFixturePath), { recursive: true });
  fs.writeFileSync(editorFixturePath, "export const editorValue = 1;\n");
  await startModelServer();

  console.log("\n[electron-e2e] real Electron smoke");
  electronApp = await electron.launch({
    args: [root, `--user-data-dir=${userDataDir}`],
    cwd: root,
    env: safeElectronEnv(userDataDir),
    timeout: 30_000,
  });
  const page = await electronApp.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  embeddedRuntime = await electronApp.evaluate(() => ({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
  }));

  if (await page.locator("#auth").isVisible()) await page.locator("#skipAuth").click();
  await waitVisible(page, "#app");
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });

  await check("launches the real local Electron renderer", async () => {
    assert.ok(page.url().startsWith("file://"), `Unexpected renderer URL: ${page.url()}`);
    assert.equal(await page.title(), "Hi Code");
  });

  await check("runs the pinned Electron, Chromium, and Node baseline", async () => {
    assert.equal(embeddedRuntime.electron, ELECTRON_COMPATIBILITY_TARGET.electron);
    assert.equal(Number.parseInt(embeddedRuntime.chromium, 10), ELECTRON_COMPATIBILITY_TARGET.chromiumMajor);
    assert.equal(Number.parseInt(embeddedRuntime.node, 10), ELECTRON_COMPATIBILITY_TARGET.embeddedNodeMajor);
  });

  await check("isolates user data and excludes parent-process secrets", async () => {
    const environment = await electronApp.evaluate(() => ({
      home: process.env.HOME,
      userProfile: process.env.USERPROFILE,
      legacyStdoutBridge: process.env.HICODE_LEGACY_STDOUT_BRIDGE,
      sensitiveKeys: Object.keys(process.env).filter((key) => /(?:^|_)(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)$/i.test(key)),
    }));
    assert.equal(environment.home, userDataDir);
    assert.equal(environment.userProfile, userDataDir);
    assert.equal(environment.legacyStdoutBridge, "0");
    assert.deepEqual(environment.sensitiveKeys, []);
  });

  await check("streams a desktop turn with the compatibility stdout bridge disabled", async () => {
    await verifyProtocolNativeDesktopTurn(page);
  });

  const observed = {};
  for (const width of baseline.widths) {
    await check(`${width}px layout keeps the brand visible without horizontal overflow`, async () => {
      observed[width] = await captureHome(page, width);
    });
  }

  for (const width of baseline.widths) {
    await check(`${width}px core navigation and settings remain reachable`, async () => {
      await setContentSize(width, baseline.height);
      await returnHome(page);
      await verifyNavigation(page, width);
    });
  }

  await check("typed App Shell controls legacy panels at compact width", async () => {
    await verifyTypedAppShell(page);
  });

  await check("responsive timeline and diff panels have real drawer access", async () => {
    await verifyResponsivePanels(page);
  });

  await check("long transcripts stay bounded and session keyboard navigation remains usable", async () => {
    await verifySessionKeyboardAndLongTranscript(page);
  });

  await check("CodeMirror opens edits saves reloads and refuses stale disk writes", async () => {
    await verifyIntegratedEditor(page);
  });

  await check("diff review comment enters the real Runtime revision loop", async () => {
    await verifyDiffCommentRevisionRequest(page);
  });

  await check("integrated terminal runs real PTY input output resize and close", async () => {
    await verifyIntegratedTerminal(page);
  });

  await check("renderer produced no uncaught page errors", async () => {
    assert.deepEqual(pageErrors, []);
  });

  // Run navigation denial last: Chromium keeps a prevented navigation pending
  // from Playwright's perspective even though the trusted document stays loaded.
  await check("blocks untrusted renderer navigation and new windows", async () => {
    const trustedUrl = page.url();
    await page.evaluate(() => window.location.assign("https://navigation-blocked.invalid/"));
    await page.waitForTimeout(120);
    assert.equal(page.url(), trustedUrl);
    await page.evaluate(() => window.open("https://window-blocked.invalid/", "_blank"));
    await page.waitForTimeout(120);
    const windowCount = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    assert.equal(windowCount, 1);
  });

  fs.writeFileSync(path.join(resultDir, "layout-observed.json"), `${JSON.stringify({
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    embeddedRuntime,
    observed,
    results,
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  console.error(`[electron-e2e] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (electronApp) await electronApp.close().catch(() => {});
  if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
}
