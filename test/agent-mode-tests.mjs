import assert from "node:assert/strict";
import { AGENT_MODE_PROFILES, resolveToolDecision, isAgentMode } from "../dist/agent-modes.js";
import { newPermissionState, requestPermission } from "../dist/permissions.js";
import { createAcpStub } from "../dist/acp-stub.js";

assert.equal(isAgentMode("build"), true);
assert.equal(isAgentMode("nope"), false);
assert.equal(resolveToolDecision("plan", "write_file"), "deny");
assert.equal(resolveToolDecision("plan", "read_file"), "prompt");
assert.equal(resolveToolDecision("build", "edit_file"), "auto-allow");
assert.equal(resolveToolDecision("ask", "bash"), "deny");
assert.ok(AGENT_MODE_PROFILES.plan.systemGuidance.includes("PLAN"));

const planState = newPermissionState("default", "plan");
const denied = await requestPermission(
  planState,
  { tool: "write_file", action: "write x.ts", mutating: true },
  async () => "y",
);
assert.equal(denied, "deny");

const buildState = newPermissionState("default", "build");
const allowed = await requestPermission(
  buildState,
  { tool: "edit_file", action: "edit x.ts", mutating: true },
  async () => "n",
);
assert.equal(allowed, "allow");

const acp = createAcpStub();
const init = await acp.initialize({ clientName: "test" });
assert.equal(init.protocolVersion, "0.1-stub");
const prompted = await acp.prompt({ prompt: "hello" });
assert.equal(prompted.status, "unsupported");

console.log("agent-mode-tests: ok");
