import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { secureRandomInt } from "../crypto/random.ts";
import type { AssetProvider, PuzzleSourceImage, TileLocation, TileAsset } from "./asset-provider.ts";
import { ConfigurationError } from "../errors.ts";

export interface LocalPreprocessedAssetProviderOptions {
  /** Directory produced by scripts/process-assets.mjs: <processedDir>/<imageId>/<grid>/r{row}c{col}.jpg */
  processedDir: string;
  images: PuzzleSourceImage[];
}

/**
 * Serves puzzle tiles that were pre-cropped *offline* (see
 * scripts/process-assets.mjs, which uses `sharp` as a one-time
 * dev-time dependency -- it is never required at runtime). This is
 * the provider you want in production for real photos: the engine
 * never decodes or crops images on the request path, so a flood of
 * challenge-creation requests can't be used to exhaust CPU via image
 * processing.
 */
export class LocalPreprocessedAssetProvider implements AssetProvider {
  private readonly options: LocalPreprocessedAssetProviderOptions;

  constructor(options: LocalPreprocessedAssetProviderOptions) {
    this.options = options;
  }

  async listSourceImages(): Promise<PuzzleSourceImage[]> {
    return this.options.images;
  }

  async pickSourceImage(): Promise<PuzzleSourceImage> {
    const images = this.options.images;
    if (images.length === 0) {
      throw new ConfigurationError(
        "LocalPreprocessedAssetProvider: no source images configured. Run `npm run assets:setup && npm run assets:process` first -- see docs/asset-management.md.",
      );
    }
    return images[secureRandomInt(0, images.length)]!;
  }

  async getTile(loc: TileLocation): Promise<TileAsset | undefined> {
    // Locations arrive from authenticated tile tokens the engine minted, never
    // raw client input -- but the path is still built defensively so a bad
    // catalogue entry (or a future caller) can never escape processedDir.
    if (!this.options.images.some((img) => img.id === loc.imageId)) return undefined;
    const safeSegment = (s: string | number) => String(s).replace(/[^a-zA-Z0-9_-]/g, "");
    const path = join(
      this.options.processedDir,
      safeSegment(loc.imageId),
      safeSegment(loc.grid),
      `r${safeSegment(loc.row)}c${safeSegment(loc.col)}.jpg`,
    );
    try {
      const data = await readFile(path);
      return { contentType: "image/jpeg", data };
    } catch {
      return undefined;
    }
  }
}
