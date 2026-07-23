import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_SCRIPT = path.resolve(__dirname, "../../services/gateway/server.mjs");
const MARKER = path.join(os.homedir(), ".hicode", "gateway.json");

/**
 * Desktop manager for the local Gateway process (Wave3).
 */
export function createGatewayService() {
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  let info = null;

  function readMarker() {
    try {
      if (!fs.existsSync(MARKER)) return null;
      return JSON.parse(fs.readFileSync(MARKER, "utf8"));
    } catch {
      return null;
    }
  }

  async function start({ port = 8787, token = "" } = {}) {
    if (child && !child.killed) {
      return { ok: true, alreadyRunning: true, ...(info || readMarker() || {}) };
    }
    const args = [GATEWAY_SCRIPT, "--port", String(port)];
    if (token) args.push("--token", String(token));
    child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let boot = "";
    child.stdout?.on("data", (buf) => { boot += buf.toString("utf8"); });
    child.stderr?.on("data", (buf) => { boot += buf.toString("utf8"); });
    child.on("exit", () => { child = null; });

    // Wait briefly for marker / health.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const marker = readMarker();
      if (marker?.port) {
        info = marker;
        const health = await fetchJson(`http://127.0.0.1:${marker.port}/health`);
        if (health?.ok) return { ok: true, ...marker, health };
      }
    }
    return { ok: false, error: "gateway failed to start", log: boot.slice(-500) };
  }

  async function stop() {
    if (child && !child.killed) {
      try { child.kill(); } catch { /* ignore */ }
      child = null;
    }
    info = null;
    try { if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER); } catch { /* ignore */ }
    return { ok: true };
  }

  async function status() {
    const marker = info || readMarker();
    if (!marker?.port) return { ok: true, running: false };
    const health = await fetchJson(`http://127.0.0.1:${marker.port}/health`);
    if (!health?.ok) return { ok: true, running: false, marker };
    const control = await fetchJson(`http://127.0.0.1:${marker.port}/v1/control`, marker.token);
    return { ok: true, running: true, marker, health, control };
  }

  async function connectRemote({ baseUrl, token } = {}) {
    const root = String(baseUrl || "").replace(/\/$/, "");
    if (!root) return { ok: false, error: "baseUrl required" };
    const health = await fetchJson(`${root}/health`);
    if (!health?.ok) return { ok: false, error: "remote health check failed", health };
    const control = await fetchJson(`${root}/v1/control`, token);
    if (!control?.ok) return { ok: false, error: control?.error || "remote unauthorized", control };
    return { ok: true, mode: "remote", baseUrl: root, health, control };
  }

  return { start, stop, status, connectRemote, readMarker };
}

async function fetchJson(url, token) {
  try {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const res = await fetch(url, { headers });
    return await res.json();
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

export function registerGatewayIpc({ register, gateway }) {
  if (!register || !gateway) throw new Error("registerGatewayIpc requires register + gateway");
  register("gateway:start", async (_e, payload = {}) => gateway.start(payload || {}));
  register("gateway:stop", async () => gateway.stop());
  register("gateway:status", async () => gateway.status());
  register("gateway:connect-remote", async (_e, payload = {}) => gateway.connectRemote(payload || {}));
}
