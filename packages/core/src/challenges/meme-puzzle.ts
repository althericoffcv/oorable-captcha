import { secureShuffle } from "../crypto/random.ts";
import type { ChallengeDefinition } from "../challenge/lifecycle.ts";
import type { AssetProvider, TileLocation } from "../assets/asset-provider.ts";

export interface MemePuzzleOptions {
  /** "easy" => 2x2, "medium" => 3x3 (default), "hard" => 4x4. */
  difficulty?: "easy" | "medium" | "hard";
  /** Explicit grid size overrides difficulty. Clamped to 2..6. */
  grid?: number;
  assetProvider: AssetProvider;
  /** Mints the opaque, unforgeable, expiring token the client will see for one tile. */
  mintTile: (location: TileLocation) => string;
  /** Builds the URL the client fetches a tile's pixels from. */
  tileUrl: (token: string) => string;
}

export interface PuzzleTile {
  /** Opaque single-use handle. Reveals nothing about the tile's correct position. */
  token: string;
  /** Where the client fetches this tile's actual pixels from. */
  assetUrl: string;
}

export interface MemePuzzlePublicPayload {
  grid: number;
  /** Tiles in shuffled DISPLAY order: tiles[i] is currently shown at slot i. */
  tiles: PuzzleTile[];
}

interface MemePuzzleSolution {
  /** correctOrder[slot] is the tile token that belongs at that slot. */
  correctOrder: string[];
}

const DIFFICULTY_GRID: Record<NonNullable<MemePuzzleOptions["difficulty"]>, number> = {
  easy: 2,
  medium: 3,
  hard: 4,
};

function clampGrid(grid: number): number {
  if (!Number.isFinite(grid)) return 3;
  return Math.min(6, Math.max(2, Math.round(grid)));
}

function countFixedPoints(a: readonly string[], b: readonly string[]): number {
  return a.reduce((n, token, i) => (token === b[i] ? n + 1 : n), 0);
}

/**
 * Builds one meme-puzzle challenge.
 *
 * Security-relevant design notes (see docs/threat-model.md):
 *  - Each tile is handed to the client as a freshly minted sealed token
 *    (AES-GCM, random IV). The string carries no readable information about
 *    position: a scraper reading the JSON learns only "N opaque strings, in
 *    this order". Recovering the correct order requires looking at the tile
 *    *images*, as a human would.
 *  - Tokens are per-challenge and never reused, expire with the challenge,
 *    and cannot be forged, so they cannot be used to fetch arbitrary files.
 *  - The shuffle is re-rolled if too many tiles land on their own solved slot
 *    by chance, so small grids can't occasionally hand out an already-solved
 *    (or nearly solved) puzzle.
 *
 * Known residual risk: tile *pixels* are fixed per (image, slot), so an
 * attacker who has downloaded the source images can match tiles by hash or
 * feature matching. A small image pool makes that cheap. See
 * docs/limitations.md for pool-size and rotation guidance.
 */
export async function buildMemePuzzleChallenge(options: MemePuzzleOptions): Promise<ChallengeDefinition> {
  const grid = clampGrid(options.grid ?? DIFFICULTY_GRID[options.difficulty ?? "medium"]);
  const cellCount = grid * grid;

  const image = await options.assetProvider.pickSourceImage();

  const correctOrder: string[] = [];
  for (let slot = 0; slot < cellCount; slot++) {
    correctOrder.push(
      options.mintTile({ imageId: image.id, grid, row: Math.floor(slot / grid), col: slot % grid }),
    );
  }

  let displayOrder = secureShuffle(correctOrder);
  let guard = 0;
  while (guard++ < 20 && countFixedPoints(displayOrder, correctOrder) > cellCount / 2) {
    displayOrder = secureShuffle(correctOrder);
  }

  const tiles: PuzzleTile[] = displayOrder.map((token) => ({ token, assetUrl: options.tileUrl(token) }));
  const publicPayload: MemePuzzlePublicPayload = { grid, tiles };
  const solution: MemePuzzleSolution = { correctOrder };

  return { solution, publicPayload, checkAnswer: checkMemePuzzleAnswer };
}

/**
 * `answer` is the array of tile tokens in the arrangement the user
 * submitted: answer[i] is whichever token the user currently has at slot i.
 */
export function checkMemePuzzleAnswer(answer: unknown, solution: unknown): boolean {
  const sol = solution as MemePuzzleSolution;
  if (!Array.isArray(answer) || answer.length !== sol.correctOrder.length) return false;
  if (!answer.every((t) => typeof t === "string")) return false;
  // A wrong guess only ever reveals "wrong" -- never which slots were wrong --
  // and attempts are capped and rate-limited regardless, so this comparison
  // does not need to be constant-time the way token signature checks do.
  return answer.every((token, i) => token === sol.correctOrder[i]);
}
