import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  FileAttachmentStore,
  attachmentReference,
} from "../dist/attachment-store.js";
import { materializeAttachmentMessages } from "../dist/attachment-materializer.js";
import {
  CommandRegistry,
  createDefaultCommandRegistry,
} from "../dist/command-registry.js";
import { FileRuntimeStore } from "../dist/runtime-stores.js";
import { createRuntime } from "../dist/runtime.js";
import { deleteSession } from "../dist/session-store.js";
import { estimateTokens } from "../dist/context.js";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ""}`);
    fail++;
  }
}

function throwsCode(name, fn, code) {
  try {
    fn();
    check(name, false, "expected exception");
  } catch (error) {
    check(name, error?.code === code, `${error?.code || "no-code"}: ${error?.message || error}`);
  }
}

async function rejectsCode(name, fn, code) {
  try {
    await fn();
    check(name, false, "expected rejection");
  } catch (error) {
    check(name, error?.code === code, `${error?.code || "no-code"}: ${error?.message || error}`);
  }
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-attachments-"));
const store = new FileAttachmentStore(root);
const sessionId = "session-attachments-1";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

console.log("\n[attachment-store] durable content-addressed storage");
const image = store.putBuffer({
  sessionId,
  name: "control-panel.png",
  data: png,
  mimeType: "image/png",
});
const duplicate = store.putBuffer({
  sessionId,
  name: "control-panel-copy.png",
  data: png,
  mimeType: "application/octet-stream",
});
check("image type is detected from bytes", image.kind === "image" && image.mimeType === "image/png", JSON.stringify(image));
check("identical content shares one blob key", duplicate.blobKey === image.blobKey && duplicate.id !== image.id);
check("attachment records do not persist a source path", !("sourcePath" in image) && !("path" in image), JSON.stringify(image));

const restartedStore = new FileAttachmentStore(root);
const restartedRecord = restartedStore.get(image.id);
const restartedRead = restartedStore.read(image.id);
check(
  "attachment metadata survives a new store instance",
  restartedRecord?.sessionId === sessionId && restartedRecord?.sha256 === image.sha256,
  JSON.stringify(restartedRecord),
);
check("attachment bytes survive a new store instance", restartedRead.data.equals(png));
check("session listing is deterministic", restartedStore.list(sessionId).map((item) => item.id).sort().join(",") === [image.id, duplicate.id].sort().join(","));

if (process.platform !== "win32") {
  const recordPath = path.join(root, "records", `${image.id}.json`);
  const blobPath = path.join(root, "blobs", image.blobKey);
  check("attachment metadata is owner-only", (fs.statSync(recordPath).mode & 0o777) === 0o600);
  check("attachment blob is owner-only", (fs.statSync(blobPath).mode & 0o777) === 0o600);
}

throwsCode(
  "unsafe attachment session id is rejected",
  () => store.putBuffer({ sessionId: "../escape", name: "escape.txt", data: Buffer.from("no") }),
  "attachment_session_invalid",
);
throwsCode(
  "empty attachments are rejected visibly",
  () => store.putBuffer({ sessionId, name: "empty.txt", data: Buffer.alloc(0) }),
  "attachment_empty",
);

const corrupt = store.putBuffer({
  sessionId,
  name: "integrity.txt",
  data: Buffer.from("integrity evidence", "utf8"),
  mimeType: "text/plain",
});
fs.writeFileSync(path.join(root, "blobs", corrupt.blobKey), "tampered");
throwsCode("blob tampering is detected on every read", () => restartedStore.read(corrupt.id), "attachment_integrity_failed");

check("removing one deduplicated record succeeds", store.remove(image.id) === true);
check("shared content remains readable for the other record", store.read(duplicate.id).data.equals(png));

console.log("\n[attachment-store] runtime persistence and provider preflight");
const text = store.putBuffer({
  sessionId,
  name: "inspection-notes.txt",
  data: Buffer.from("terminal X1 must be labeled", "utf8"),
  mimeType: "application/octet-stream",
});
const pdf = store.putBuffer({
  sessionId,
  name: "drawing.pdf",
  data: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF", "utf8"),
  mimeType: "application/octet-stream",
});
check("text and PDF are classified from content", text.kind === "text" && pdf.kind === "pdf", JSON.stringify({ text, pdf }));

const responseProfile = {
  name: "responses-fixture",
  baseURL: "https://example.invalid/v1",
  apiKey: "unused",
  model: "vision-fixture",
  contextWindow: 8192,
  temperature: 0,
  protocol: "responses",
};
const persistedMessages = [{
  role: "user",
  content: [
    { type: "text", text: "Inspect these inputs" },
    attachmentReference(duplicate),
    attachmentReference(text),
  ],
}];
const materialized = materializeAttachmentMessages(persistedMessages, store, responseProfile);
const materializedParts = materialized[0]?.content;
check(
  "supported image becomes an integrity-checked data URL",
  Array.isArray(materializedParts) && materializedParts.some((part) => part.type === "image_url" && part.image_url.url.startsWith("data:image/png;base64,")),
);
check(
  "UTF-8 text is materialized locally with its filename",
  Array.isArray(materializedParts) && materializedParts.some((part) => part.type === "text" && part.text.includes("inspection-notes.txt") && part.text.includes("terminal X1")),
);
check("durable attachment references never reach the provider", Array.isArray(materializedParts) && materializedParts.every((part) => part.type !== "attachment_ref"));

throwsCode(
  "unsupported PDF is rejected before provider transport",
  () => materializeAttachmentMessages([{ role: "user", content: [attachmentReference(pdf)] }], store, responseProfile),
  "attachment_capability_unsupported",
);
throwsCode(
  "missing attachment is reported instead of silently ignored",
  () => materializeAttachmentMessages([{ role: "user", content: [{
    type: "attachment_ref",
    attachment: { ...attachmentReference(text).attachment, id: "att-00000000-0000-4000-8000-000000000000" },
  }] }], store, responseProfile),
  "attachment_not_found",
);

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-attachment-runtime-"));
const runtimeStore = new FileRuntimeStore(runtimeRoot);
const runtimeSnapshot = {
  id: sessionId,
  cwd: root,
  model: responseProfile.model,
  systemMessage: { role: "system", content: "system" },
  createdAt: 1,
  updatedAt: 2,
  firstPrompt: "Inspect these inputs",
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  messages: persistedMessages,
};
check("runtime snapshot accepts durable attachment references", runtimeStore.syncSession(runtimeSnapshot).ok === true);
const rebuilt = new FileRuntimeStore(runtimeRoot).loadSession(sessionId);
check(
  "runtime restart preserves attachment identity",
  rebuilt?.messages?.[0]?.content?.[1]?.type === "attachment_ref" && rebuilt.messages[0].content[1].attachment.id === duplicate.id,
  JSON.stringify(rebuilt?.messages?.[0]),
);
const smallTextEstimate = estimateTokens([{ role: "user", content: [attachmentReference(text)] }]);
const largeTextReference = attachmentReference({ ...text, size: 64 * 1024 });
const largeTextEstimate = estimateTokens([{ role: "user", content: [largeTextReference] }]);
check("text attachment budget scales with materialized byte size", largeTextEstimate > smallTextEstimate + 10_000);

console.log("\n[attachment-runtime] real Runtime and provider path");
const modelRequests = [];
const server = http.createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  modelRequests.push(JSON.parse(raw));
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Attachment received." }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 2 } })}\n\n`);
  response.end("data: [DONE]\n\n");
});
const port = await listen(server);
const runtimeEvents = [];
const cfg = {
  profiles: {
    default: {
      name: "runtime-attachment",
      baseURL: `http://127.0.0.1:${port}/v1`,
      apiKey: "unused-local-key",
      model: "vision-runtime-fixture",
      contextWindow: 8192,
      temperature: 0,
      protocol: "chat_completions",
    },
  },
  defaultProfile: "default",
  roleModels: {},
  councilMembers: ["default"],
  councilSynthesizer: "default",
  compactThreshold: 0.9,
  reasoningLevel: "medium",
  sandbox: false,
  mcpServers: {},
};
const attachmentRuntime = createRuntime({
  cfg,
  cwd: root,
  mode: "yolo",
  systemPrompt: "Test system",
  ask: async () => "y",
  eventSink: { emit: (event) => runtimeEvents.push(event) },
  legacyAssistantOutput: false,
  persistRuntimeEvents: false,
  attachmentStore: store,
  commandSurface: "desktop",
});
const runtimeImage = store.putBuffer({ sessionId: attachmentRuntime.sessionId, name: "runtime-image.png", data: png });
await attachmentRuntime.handleInput("Inspect the image", { attachmentIds: [runtimeImage.id] });
const providerUser = modelRequests[0]?.messages?.find((message) => message.role === "user");
check("Runtime sends a verified image to the real provider path", providerUser?.content?.some((part) => part.type === "image_url"));
check("Runtime persists only the durable reference", attachmentRuntime.session.messages[0]?.content?.some((part) => part.type === "attachment_ref") && !JSON.stringify(attachmentRuntime.session.messages[0]).includes("base64"));
check("Runtime event carries the durable attachment reference", runtimeEvents.some((event) => event.type === "message:appended" && event.payload?.message?.content?.some?.((part) => part.type === "attachment_ref")));

const runtimePdf = store.putBuffer({ sessionId: attachmentRuntime.sessionId, name: "runtime-drawing.pdf", data: Buffer.from("%PDF-1.7\n%%EOF") });
const messagesBeforePdf = attachmentRuntime.session.messages.length;
const requestsBeforePdf = modelRequests.length;
await rejectsCode(
  "Runtime rejects unsupported PDF before a provider request",
  () => attachmentRuntime.handleInput("Inspect the PDF", { attachmentIds: [runtimePdf.id] }),
  "attachment_capability_unsupported",
);
check("failed attachment preflight does not poison session history", attachmentRuntime.session.messages.length === messagesBeforePdf);
check("failed attachment preflight makes no network request", modelRequests.length === requestsBeforePdf);

let unknownCommandRejected = false;
try {
  await attachmentRuntime.handleInput("/definitely-not-a-command");
} catch (error) {
  unknownCommandRejected = /Unknown command/.test(error?.message || "");
}
check("Runtime reports unknown slash commands without contacting the model", unknownCommandRejected && modelRequests.length === requestsBeforePdf);
await attachmentRuntime.handleInput("运行测试");
check("ordinary coding language reaches the agent route", modelRequests.length === requestsBeforePdf + 1);
attachmentRuntime.shutdown();
deleteSession(attachmentRuntime.sessionId);
await new Promise((resolve) => server.close(resolve));

console.log("\n[command-registry] one routing contract for all surfaces");
const registry = createDefaultCommandRegistry({
  nativeCommands: [{
    id: "native.open-app",
    surfaces: ["desktop"],
    priority: 100,
    match(input) {
      return input === "打开 Chrome" ? { app: "Google Chrome" } : null;
    },
  }],
});
const clear = registry.resolve("/clear", { surface: "desktop" });
const reset = registry.resolve("/reset", { surface: "cli" });
const shell = registry.resolve("!npm test", { surface: "tui" });
const native = registry.resolve("打开 Chrome", { surface: "desktop" });
const coding = registry.resolve("运行测试", { surface: "desktop" });
const unknown = registry.resolve("/definitely-not-a-command", { surface: "desktop" });
check("canonical slash command resolves", clear.ok && clear.route === "slash" && clear.commandId === "clear");
check("slash alias resolves to one canonical command", reset.ok && reset.route === "slash" && reset.commandId === "clear");
check("shell routing is consistent on TUI", shell.ok && shell.route === "shell" && shell.args === "npm test");
check("known native intent carries typed payload", native.ok && native.route === "native" && native.payload?.app === "Google Chrome");
check("ordinary coding request is not swallowed by native routing", coding.ok && coding.route === "agent");
check("unknown slash command is a visible routing error", !unknown.ok && unknown.code === "command_unknown");

const duplicateRegistry = new CommandRegistry();
duplicateRegistry.register({ id: "slash.one", route: "slash", aliases: ["same"], surfaces: ["desktop"] });
throwsCode(
  "overlapping slash aliases are rejected at registration",
  () => duplicateRegistry.register({ id: "slash.two", route: "slash", aliases: ["same"], surfaces: ["desktop"] }),
  "command_alias_conflict",
);

const conflictRegistry = new CommandRegistry();
for (const id of ["native.one", "native.two"]) {
  conflictRegistry.register({ id, route: "native", surfaces: ["desktop"], priority: 20, match: () => ({ id }) });
}
const conflict = conflictRegistry.resolve("ambiguous native intent", { surface: "desktop" });
check("equal-priority native conflicts fail closed", !conflict.ok && conflict.code === "command_route_conflict", JSON.stringify(conflict));

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(runtimeRoot, { recursive: true, force: true });
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
