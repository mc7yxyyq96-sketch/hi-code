#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createReleasePolicy, writeEmbeddedReleaseManifest } from "../electron/services/release-policy.mjs";
import { inspectReleaseSource } from "./release-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const platformArg = process.argv.find((value) => value.startsWith("--platform="));
const channelArg = process.argv.find((value) => value.startsWith("--channel="));
const modeArg = process.argv.find((value) => value.startsWith("--mode="));
const platform = platformArg?.split("=")[1] || process.platform;
const policy = createReleasePolicy({
  version: pkg.version,
  platform,
  channel: channelArg?.split("=")[1],
  mode: modeArg?.split("=")[1],
  sourceState: inspectReleaseSource(root, process.env),
});
const manifest = writeEmbeddedReleaseManifest({ root, policy });

console.log(JSON.stringify({ ...policy, embeddedManifest: path.relative(root, manifest.outputPath) }, null, 2));
if (!policy.ok) process.exitCode = 1;
