#!/usr/bin/env node
// Slices each downloaded source image into per-grid tile files, e.g.
// assets/processed/meme-1/3/r0c0.jpg .. r2c2.jpg. Requires `sharp`
// (npm install --save-dev sharp) -- a one-time, offline dev-tool
// dependency, never a runtime dependency of the published packages.
// See docs/asset-management.md.
import { readdir, mkdir } from "node:fs/promises";
import { join, dirname, parse } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceDir = process.argv[2] ?? join(__dirname, "..", "assets", "source");
const processedDir = process.argv[3] ?? join(__dirname, "..", "assets", "processed");
const GRIDS = [2, 3, 4];

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error(
    "This script needs `sharp`. Run `npm install --save-dev sharp` (requires network) and try again.\n" +
      "sharp is a one-time asset-processing tool, not a runtime dependency of any published OORABLE CAPTCHA package.",
  );
  process.exit(1);
}

let files;
try {
  files = (await readdir(sourceDir)).filter((f) => /\.(jpe?g|png)$/i.test(f));
} catch {
  console.error(`Could not read ${sourceDir}. Run \`npm run assets:setup\` first (or pass a source directory as the first argument).`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`No source images found in ${sourceDir}.`);
  process.exit(1);
}

for (const file of files) {
  const { name: imageId } = parse(file);
  const inputPath = join(sourceDir, file);
  const meta = await sharp(inputPath).metadata();
  const size = Math.min(meta.width ?? 0, meta.height ?? 0);
  if (!size) {
    console.warn(`Skipping ${file}: could not read dimensions`);
    continue;
  }

  for (const grid of GRIDS) {
    const tileSize = Math.floor(size / grid);
    const outDir = join(processedDir, imageId, String(grid));
    await mkdir(outDir, { recursive: true });
    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        await sharp(inputPath)
          .extract({ left: col * tileSize, top: row * tileSize, width: tileSize, height: tileSize })
          .jpeg({ quality: 85 })
          .toFile(join(outDir, `r${row}c${col}.jpg`));
      }
    }
    console.log(`${imageId}: wrote ${grid}x${grid} tiles`);
  }
}

console.log("\nDone. Configure LocalPreprocessedAssetProvider with processedDir pointing at " + processedDir + ".");
