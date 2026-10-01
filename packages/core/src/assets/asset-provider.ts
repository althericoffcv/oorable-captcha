export interface PuzzleSourceImage {
  id: string;
  /** Human-readable label, e.g. for admin tooling -- never sent to the client. */
  label?: string;
}

export interface TileLocation {
  imageId: string;
  grid: number;
  row: number;
  col: number;
}

export interface TileAsset {
  contentType: string;
  data: Buffer;
}

/**
 * Bring-your-own image source for the meme-puzzle challenge type.
 *
 * Providers are deliberately *stateless*: they map a tile location to
 * pixels and nothing else. The engine, not the provider, mints the opaque
 * per-challenge tokens the client sees (see crypto/tile-token.ts), so a
 * provider never needs a registry that could grow without bound or fall
 * out of sync between server instances.
 */
export interface AssetProvider {
  /** The pool of available puzzle source images. */
  listSourceImages(): Promise<PuzzleSourceImage[]>;
  /** Picks one source image at random (cryptographically) for a new challenge. */
  pickSourceImage(): Promise<PuzzleSourceImage>;
  /** Returns the pixels for one tile, or undefined if it does not exist. */
  getTile(location: TileLocation): Promise<TileAsset | undefined>;
}
