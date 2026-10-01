#!/usr/bin/env node
// tsc's `rewriteRelativeImportExtensions` rewrites ".ts" -> ".js" in emitted
// JavaScript, but leaves relative ".ts" specifiers untouched in emitted
// .d.ts files. Published packages contain no ".ts" sources, so consumers'
// TypeScript would fail to resolve those imports (and, with skipLibCheck,
// silently degrade the types to `any`). This post-build step rewrites relative
// specifiers in declaration files to ".js", the canonical NodeNext form.
//
// Usage: node fix-declaration-extensions.mjs <dist-dir>
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist");

const FROM_RE = /(\bfrom\s+["'])(\.{1,2}\/[^"']+?)\.ts(["'])/g;
const IMPORT_TYPE_RE = /(\bimport\(\s*["'])(\.{1,2}\/[^"']+?)\.ts(["']\s*\))/g;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".d.ts")) yield full;
  }
}

let changed = 0;
for await (const file of walk(root)) {
  const before = await readFile(file, "utf8");
  const after = before.replace(FROM_RE, "$1$2.js$3").replace(IMPORT_TYPE_RE, "$1$2.js$3");
  if (after !== before) {
    await writeFile(file, after);
    changed++;
  }
}
console.log(`fix-declaration-extensions: rewrote ${changed} declaration file(s) under ${root}`);
