#!/usr/bin/env node
// Downloads the OORABLE CAPTCHA supplied meme-puzzle source images into
// assets/source/. Run this on a machine with network access -- it does
// nothing at build time and is never required at runtime. See
// docs/asset-management.md.
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "assets", "source");

const IMAGES = [
  { id: "meme-1", url: "https://ik.imagekit.io/oorable/c928850cf25287bcf22a7f0fdeceb3e4.jpg" },
  { id: "meme-2", url: "https://ik.imagekit.io/oorable/87dee6d33b04f1df28bc85702ee12d4b.jpg" },
  { id: "meme-3", url: "https://ik.imagekit.io/oorable/8cef642481853f378a453a318ef7f205.jpg" },
  { id: "meme-4", url: "https://ik.imagekit.io/oorable/4c099f3e21dd22600d6e23a2637acc2c.jpg" },
];

await mkdir(outDir, { recursive: true });

let failures = 0;
for (const { id, url } of IMAGES) {
  process.stdout.write(`Fetching ${id} from ${url} ... `);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`FAILED (HTTP ${res.status})`);
      failures++;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = (res.headers.get("content-type") || "").includes("png") ? "png" : "jpg";
    await writeFile(join(outDir, `${id}.${ext}`), buf);
    console.log(`OK (${buf.length} bytes)`);
  } catch (err) {
    console.log(`FAILED (${err.message})`);
    failures++;
  }
}

if (failures > 0) {
  console.log(`\n${failures} of ${IMAGES.length} downloads failed. Re-run this script once you have network access to ik.imagekit.io.`);
  process.exitCode = 1;
} else {
  console.log(`\nDone. Next: npm run assets:process`);
}
