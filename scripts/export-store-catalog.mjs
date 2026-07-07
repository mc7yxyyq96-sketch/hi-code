#!/usr/bin/env node
// Export the built-in store catalog to store/catalog.json so remote
// catalog sources (GitHub raw / future gitee mirror) serve real data.
// Run `npm run store:export` after editing electron/store-catalog.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_STORE_CATALOG } from "../electron/store-catalog.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "store");
const outFile = path.join(outDir, "catalog.json");

const catalog = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString().slice(0, 10),
  homepage: "https://github.com/mc7yxyyq96-sketch/hi-code",
  items: BUILTIN_STORE_CATALOG,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`wrote ${path.relative(root, outFile)} (${catalog.items.length} items)`);
