import { secureRandomInt } from "../crypto/random.ts";
import type { AssetProvider, PuzzleSourceImage, TileLocation, TileAsset } from "./asset-provider.ts";

/**
 * Zero-dependency fallback / demo asset provider.
 *
 * It procedurally draws each puzzle image as a set of overlapping
 * circles, seeded deterministically from the image id, and serves
 * each tile as an SVG crop of that same pattern -- same seed means
 * same circles, so two tiles from the same image line up at their
 * shared edge the way real jigsaw pieces would. This is what lets the
 * whole create -> render -> solve -> verify lifecycle run and be
 * tested in an environment with no network access and no native
 * image-processing library (see docs/limitations.md).
 *
 * It is NOT a replacement for real photos. Wire up
 * LocalPreprocessedAssetProvider (see docs/asset-management.md) to use
 * actual supplied/licensed images in production -- recognizable
 * content is the whole point of a *meme* puzzle.
 */

const TILE_PX = 120;

// Deterministic, NON-cryptographic PRNG (mulberry32). Only used for
// cosmetic pattern generation so the same imageId always draws the
// same picture -- never use this for anything security-relevant.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Circle {
  cx: number;
  cy: number;
  r: number;
  hue: number;
}

function circlesFor(imageId: string, grid: number): Circle[] {
  const rand = mulberry32(hashString(imageId));
  const size = TILE_PX * grid;
  const count = 10 + grid * 4;
  const circles: Circle[] = [];
  for (let i = 0; i < count; i++) {
    circles.push({
      cx: rand() * size,
      cy: rand() * size,
      r: 20 + rand() * (size / 3),
      hue: Math.floor(rand() * 360),
    });
  }
  return circles;
}

function tileSvg(imageId: string, grid: number, row: number, col: number): string {
  const size = TILE_PX * grid;
  const x = col * TILE_PX;
  const y = row * TILE_PX;
  const circles = circlesFor(imageId, grid);
  const shapes = circles
    .map((c) => `<circle cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="${c.r.toFixed(1)}" fill="hsl(${c.hue} 70% 55% / 0.55)" />`)
    .join("");
  const bgHue = hashString(imageId) % 360;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_PX}" height="${TILE_PX}" viewBox="${x} ${y} ${TILE_PX} ${TILE_PX}">` +
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="hsl(${bgHue} 30% 92%)" />` +
    shapes +
    `</svg>`
  );
}

export interface SyntheticAssetProviderOptions {
  images?: PuzzleSourceImage[];
}

export class SyntheticAssetProvider implements AssetProvider {
  private readonly images: PuzzleSourceImage[];

  constructor(options: SyntheticAssetProviderOptions = {}) {
    this.images = options.images ?? [
      { id: "demo-1", label: "Synthetic demo pattern 1" },
      { id: "demo-2", label: "Synthetic demo pattern 2" },
      { id: "demo-3", label: "Synthetic demo pattern 3" },
      { id: "demo-4", label: "Synthetic demo pattern 4" },
    ];
  }

  async listSourceImages(): Promise<PuzzleSourceImage[]> {
    return this.images;
  }

  async pickSourceImage(): Promise<PuzzleSourceImage> {
    return this.images[secureRandomInt(0, this.images.length)]!;
  }

  async getTile(loc: TileLocation): Promise<TileAsset | undefined> {
    if (!this.images.some((img) => img.id === loc.imageId)) return undefined;
    if (!Number.isInteger(loc.grid) || loc.grid < 2 || loc.grid > 6) return undefined;
    if (loc.row < 0 || loc.col < 0 || loc.row >= loc.grid || loc.col >= loc.grid) return undefined;
    const svg = tileSvg(loc.imageId, loc.grid, loc.row, loc.col);
    return { contentType: "image/svg+xml", data: Buffer.from(svg, "utf8") };
  }
}
