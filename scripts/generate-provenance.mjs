#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { artifactSubjects, listReleaseArtifacts, sha256File } from "./release-artifacts.mjs";
import { inspectReleaseSource } from "./release-source.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

function buildTimestamp(env = process.env) {
  const epoch = Number(env.SOURCE_DATE_EPOCH);
  return Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : new Date().toISOString();
}

export function createProvenanceStatement({ version, subjects, sourceSha, sourceTreeClean, lockDigest, releaseManifest, env = process.env }) {
  const signed = releaseManifest?.signed === true;
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: subjects,
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://github.com/mc7yxyyq96-sketch/hi-code/blob/main/docs/release-pipeline.md#desktop-package",
        externalParameters: {
          version,
          channel: releaseManifest?.channel || "unknown",
          mode: releaseManifest?.mode || "unknown",
          artifactTrust: releaseManifest?.artifactTrust || (signed ? "signed" : "unsigned"),
          publishRequested: false,
        },
        internalParameters: {
          credentialValuesRecorded: false,
          updateEnabled: releaseManifest?.updateEnabled === true,
          sourceTreeClean: sourceTreeClean === true,
        },
        resolvedDependencies: [
          { uri: "git+https://github.com/mc7yxyyq96-sketch/hi-code.git", digest: { sha1: sourceSha } },
          { uri: "file:package-lock.json", digest: { sha256: lockDigest } },
        ],
      },
      runDetails: {
        builder: {
          id: env.GITHUB_ACTIONS === "true"
            ? "https://github.com/mc7yxyyq96-sketch/hi-code/.github/workflows/release-packaging.yml"
            : "https://github.com/mc7yxyyq96-sketch/hi-code/local-release-pipeline",
          version: { electronBuilder: "26.15.3" },
        },
        metadata: {
          invocationId: env.GITHUB_RUN_ID ? `github-actions:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT || "1"}` : "local-unattested",
          startedOn: buildTimestamp(env),
          finishedOn: buildTimestamp(env),
          reproducible: false,
        },
        byproducts: [],
      },
    },
  };
}

export function generateProvenance(root = defaultRoot, { env = process.env } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const releaseDir = path.join(root, "release");
  const embeddedPath = path.join(root, "build", "generated", "release-channel.json");
  const releaseManifest = fs.existsSync(embeddedPath) ? JSON.parse(fs.readFileSync(embeddedPath, "utf8")) : null;
  const outputName = `provenance-v${pkg.version}.json`;
  const artifacts = listReleaseArtifacts(releaseDir, pkg.version, { exclude: [outputName] });
  if (!artifacts.length) throw new Error("No release artifacts or SBOM exist; build packages or generate the SBOM first");
  const sourceState = inspectReleaseSource(root, env);
  if (!sourceState.ok) throw new Error("Cannot bind provenance to an inspectable Git source state");
  if (releaseManifest?.mode === "release" && !sourceState.clean) throw new Error("Release provenance requires a clean Git source tree");
  const statement = createProvenanceStatement({
    version: pkg.version,
    subjects: artifactSubjects(releaseDir, artifacts),
    sourceSha: sourceState.commit,
    sourceTreeClean: sourceState.clean,
    lockDigest: sha256File(path.join(root, "package-lock.json")),
    releaseManifest,
    env,
  });
  const outputPath = path.join(releaseDir, outputName);
  fs.writeFileSync(outputPath, `${JSON.stringify(statement, null, 2)}\n`, { mode: 0o644 });
  return { outputPath, statement };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = generateProvenance();
    console.log(`[provenance] wrote ${path.relative(defaultRoot, result.outputPath)} (${result.statement.subject.length} subjects, unattested=${result.statement.predicate.runDetails.metadata.invocationId === "local-unattested"})`);
  } catch (error) {
    console.error(`[provenance] ${error.message}`);
    process.exitCode = 1;
  }
}
