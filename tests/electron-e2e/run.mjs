#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureDir = path.join(root, "tests", "electron-e2e", "fixtures");
const resultDir = path.join(root, "test-results", "electron-e2e", `${process.platform}-${process.arch}`);
const baseline = JSON.parse(fs.readFileSync(path.join(fixtureDir, "layout-baseline.json"), "utf8"));
const updateFixtures = process.argv.includes("--update-fixtures");
const results = [];
const pageErrors = [];
let electronApp;
let userDataDir;

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
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  return env;
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
  if (width <= 820) assert.equal(layout.topActions.length, 0, `Compact top actions should be hidden at ${width}px`);
  else {
    assert.equal(layout.topActions.length, 5, `Expected every top action at ${width}px`);
    assert.equal(layout.topActions.every((action) => action.fullyInsideHeader), true, `A top action is clipped at ${width}px`);
  }

  const resultPath = path.join(resultDir, `home-${width}.png`);
  const image = await page.screenshot({ path: resultPath, animations: "disabled" });
  assert.ok(image.length > 12_000, `Screenshot is unexpectedly small at ${width}px`);
  if (updateFixtures) fs.copyFileSync(resultPath, path.join(fixtureDir, `home-${width}.png`));
  else assert.ok(fs.statSync(path.join(fixtureDir, `home-${width}.png`)).size > 12_000, `Committed ${width}px fixture is missing or blank`);
  return layout;
}

async function openLocalChat(page) {
  await returnHome(page);
  const input = page.locator("#input");
  await input.fill("/help");
  await page.locator("#send").click();
  await waitVisible(page, "#chatview");
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

async function main() {
  fs.rmSync(resultDir, { recursive: true, force: true });
  fs.mkdirSync(resultDir, { recursive: true, mode: 0o755 });
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-electron-e2e-"));

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

  if (await page.locator("#auth").isVisible()) await page.locator("#skipAuth").click();
  await waitVisible(page, "#app");
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });

  await check("launches the real local Electron renderer", async () => {
    assert.ok(page.url().startsWith("file://"), `Unexpected renderer URL: ${page.url()}`);
    assert.equal(await page.title(), "Hi Code");
  });

  await check("isolates user data and excludes parent-process secrets", async () => {
    const environment = await electronApp.evaluate(() => ({
      home: process.env.HOME,
      userProfile: process.env.USERPROFILE,
      sensitiveKeys: Object.keys(process.env).filter((key) => /(?:^|_)(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)$/i.test(key)),
    }));
    assert.equal(environment.home, userDataDir);
    assert.equal(environment.userProfile, userDataDir);
    assert.deepEqual(environment.sensitiveKeys, []);
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

  await check("responsive timeline and diff panels have real drawer access", async () => {
    await verifyResponsivePanels(page);
  });

  await check("renderer produced no uncaught page errors", async () => {
    assert.deepEqual(pageErrors, []);
  });

  fs.writeFileSync(path.join(resultDir, "layout-observed.json"), `${JSON.stringify({
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
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
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
}
