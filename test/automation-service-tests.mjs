import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAutomationService } from "../electron/services/automation-service.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-auto-"));
const storePath = path.join(dir, "automations.json");
let clock = 1_700_000_000_000;
const automation = createAutomationService({ storePath, now: () => clock });

const created = automation.create({
  title: "Hourly scan",
  prompt: "检查依赖是否过期",
  schedule: { kind: "interval", every: "1h" },
  workspace: "/tmp/demo",
});
assert.equal(created.ok, true);
assert.equal(created.item.enabled, true);
assert.ok(created.item.nextRunAt > clock);

const listed = automation.list();
assert.equal(listed.items.length, 1);

clock = created.item.nextRunAt + 1;
const due = automation.due();
assert.equal(due.items.length, 1);
assert.equal(due.items[0].id, created.item.id);

const ran = automation.markRun(created.item.id, { at: clock });
assert.equal(ran.ok, true);
assert.equal(ran.item.runCount, 1);
assert.ok(ran.item.nextRunAt > clock);

const paused = automation.setEnabled(created.item.id, false);
assert.equal(paused.item.enabled, false);
assert.equal(paused.item.nextRunAt, null);

const once = automation.create({
  title: "Once",
  prompt: "跑一次",
  schedule: { kind: "once", at: clock + 1000 },
});
assert.equal(once.ok, true);
clock = once.item.nextRunAt + 1;
const onceRun = automation.markRun(once.item.id, { at: clock });
assert.equal(onceRun.item.enabled, false);

const removed = automation.remove(created.item.id);
assert.equal(removed.ok, true);
assert.equal(automation.list().items.length, 1);

console.log("automation-service-tests: ok");
