# Asset management (meme-puzzle images)

## The two providers

- **`SyntheticAssetProvider`** (default): zero-dependency, procedurally draws each puzzle image as a set of overlapping circles seeded deterministically from the image id, and serves each tile as an SVG crop of that same pattern -- same seed means same circles, so two tiles from the same image line up at their shared edge, the same way real jigsaw pieces would. This is what lets the entire create → render → solve → verify lifecycle run and be tested with no network access and no native image-processing library -- which is exactly the situation this repository was built in (see below). It is **not** a replacement for real photos; recognizable content is the entire point of a *meme* puzzle.
- **`LocalPreprocessedAssetProvider`** (production): serves tiles that were cropped **offline**, ahead of time, so the engine never decodes or crops an image on the request path (a flood of challenge-creation requests can't be used to exhaust CPU via image processing).

```ts
import { createEngine, LocalPreprocessedAssetProvider } from "@oorable/captcha";

const engine = createEngine({
  assetProvider: new LocalPreprocessedAssetProvider({
    processedDir: "./assets/processed",
    images: [{ id: "meme-1" }, { id: "meme-2" }, { id: "meme-3" }, { id: "meme-4" }],
  }),
});
```

## Turning the four supplied images into real tiles

The project brief supplied four image URLs (`assets/manifest.json`). This repository was built in a sandbox with **no network access at all** -- confirmed by testing both a direct HTTP request (blocked by the environment's egress proxy) and this tool's own web-fetch capability (which, separately, only extracts page text/HTML and cannot return raw image bytes at all). So these specific URLs could not be downloaded, inspected, or verified here. This is exactly the situation the brief itself anticipated ("if fetching remote images during the build is unavailable, create a clear asset setup script... do not silently substitute other images") -- which is what the two scripts below are.

```bash
npm run assets:setup     # downloads assets/manifest.json's URLs into assets/source/
npm run assets:process   # requires `sharp`: npm install --save-dev sharp
```

`assets:process` slices each source image into 2x2, 3x3, and 4x4 tile sets under `assets/processed/<imageId>/<grid>/r<row>c<col>.jpg`.

**This pipeline has been verified end-to-end** against a synthetic stand-in JPEG (a generated 300x300 test image, not one of the real supplied URLs, for the reasons above): `process-assets.mjs`, unmodified, correctly produced real JPEG tiles at the expected dimensions (100x100 for the 3x3 grid, 75x75 for the 4x4 grid) using the real `sharp` library available in the build environment. What could not be verified here is specific to the four supplied URLs being reachable at all -- the processing logic itself has been exercised for real, not just written and left untested.

Once processed, add the images to your `LocalPreprocessedAssetProvider` config as shown above.

## Adding your own images

1. Add entries to `assets/manifest.json` (or skip `assets:setup` entirely and drop files straight into `assets/source/<id>.jpg` yourself).
2. Run `npm run assets:process`.
3. List the same ids in your `LocalPreprocessedAssetProvider({ images: [...] })` config.

Guidance for choosing images: prefer roughly square, visually busy (not a large flat-color area) photos -- a puzzle piece from a mostly-empty sky is much harder for a *human* to place correctly, which defeats the point. Rotate your pool periodically (see `docs/threat-model.md`'s note on a small static image pool being crackable by simple hashing over time).

## Licensing and attribution

**Make sure you have the rights** to use, and to let end users see and interact with, any image you configure here -- this project does not vouch for the licensing of any image URL supplied to it, including the four in the project brief; confirm their license and required attribution before shipping them to real users. If an image requires attribution, display it near the puzzle in your own UI (this project does not have a built-in attribution-rendering feature).

## Writing your own `AssetProvider`

Implement `listSourceImages()`, `pickSourceImage()`, and `getTile(location): Promise<{ contentType, data } | undefined>` (`packages/core/src/assets/asset-provider.ts`). Providers are deliberately **stateless** -- they map a `{ imageId, grid, row, col }` location to pixels and nothing else. The engine, not the provider, mints the opaque per-challenge tile tokens the client sees (`crypto/tile-token.ts`), so a provider never needs its own registry that could grow without bound or fall out of sync between server instances.
