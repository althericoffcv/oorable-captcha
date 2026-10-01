import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMemePuzzleChallenge, checkMemePuzzleAnswer } from "../src/challenges/meme-puzzle.ts";
import { SyntheticAssetProvider } from "../src/assets/synthetic-asset-provider.ts";
import { openTile } from "../src/crypto/tile-token.ts";
import { memeDeps } from "./helpers.ts";

type Payload = { grid: number; tiles: { token: string; assetUrl: string }[] };
type Solution = { correctOrder: string[] };

const build = (provider: SyntheticAssetProvider, options: { grid?: number; difficulty?: "easy" | "medium" | "hard" } = {}) => {
  const deps = memeDeps(provider);
  return buildMemePuzzleChallenge({ ...options, ...deps }).then((definition) => ({ definition, deps }));
};

test("meme puzzle: grid sizes map from difficulty and are clamped to safe bounds", async () => {
  const provider = new SyntheticAssetProvider();
  const grid = async (o: Parameters<typeof build>[1]) => ((await build(provider, o)).definition.publicPayload as Payload).grid;
  assert.deepEqual([await grid({ difficulty: "easy" }), await grid({}), await grid({ difficulty: "hard" })], [2, 3, 4]);
  assert.equal(await grid({ grid: 999 }), 6);
  assert.equal(await grid({ grid: 0 }), 2);
  assert.equal(await grid({ grid: Number.NaN }), 3);
  assert.equal(await grid({ grid: Number.POSITIVE_INFINITY }), 3);
});

test("meme puzzle: the solution really does reconstruct the image (slot i holds the tile for row/col of i)", async () => {
  const provider = new SyntheticAssetProvider();
  const { definition, deps } = await build(provider, { grid: 4 });
  const sol = definition.solution as Solution;
  const imageIds = new Set<string>();
  sol.correctOrder.forEach((token, slot) => {
    const loc = openTile(token, deps.keys);
    assert.ok(loc, "every solution token must open");
    assert.equal(loc.grid, 4);
    assert.equal(loc.row, Math.floor(slot / 4));
    assert.equal(loc.col, slot % 4);
    imageIds.add(loc.imageId);
  });
  assert.equal(imageIds.size, 1, "all tiles of one puzzle come from a single source image");
});

test("meme puzzle: the starting layout is never mostly solved", async () => {
  const provider = new SyntheticAssetProvider();
  for (let i = 0; i < 50; i++) {
    const { definition } = await build(provider, { grid: 3 });
    const payload = definition.publicPayload as Payload;
    const sol = definition.solution as Solution;
    const fixed = payload.tiles.filter((t, idx) => t.token === sol.correctOrder[idx]).length;
    assert.ok(fixed <= 4, `${fixed} of 9 tiles started in their solved slot`);
  }
});

test("meme puzzle: the shuffle varies between challenges (not a fixed permutation)", async () => {
  const provider = new SyntheticAssetProvider();
  const layouts = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const { definition } = await build(provider, { grid: 3 });
    const payload = definition.publicPayload as Payload;
    const sol = definition.solution as Solution;
    layouts.add(payload.tiles.map((t) => sol.correctOrder.indexOf(t.token)).join(","));
  }
  assert.ok(layouts.size >= 38, `only ${layouts.size} distinct layouts in 40 draws (9! = 362,880 possible)`);
});

test("meme puzzle: only the exact correct arrangement passes", async () => {
  const { definition } = await build(new SyntheticAssetProvider(), { grid: 3 });
  const sol = definition.solution as Solution;

  assert.equal(checkMemePuzzleAnswer(sol.correctOrder, definition.solution), true);

  const swapped = [...sol.correctOrder];
  [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
  assert.equal(checkMemePuzzleAnswer(swapped, definition.solution), false);
  assert.equal(checkMemePuzzleAnswer(sol.correctOrder.slice(1), definition.solution), false, "too short");
  assert.equal(checkMemePuzzleAnswer([...sol.correctOrder, "extra"], definition.solution), false, "too long");
  assert.equal(checkMemePuzzleAnswer(Array(9).fill(sol.correctOrder[0]), definition.solution), false, "one token repeated");
});

test("meme puzzle: malformed answers are rejected without throwing", async () => {
  const { definition } = await build(new SyntheticAssetProvider(), { grid: 2 });
  for (const bad of [null, undefined, 42, "str", {}, [1, 2, 3, 4], [null, null, null, null]]) {
    assert.equal(checkMemePuzzleAnswer(bad, definition.solution), false);
  }
});

test("meme puzzle: public payload carries only opaque tokens and asset URLs", async () => {
  const { definition } = await build(new SyntheticAssetProvider(), { grid: 3 });
  const payload = definition.publicPayload as Payload;

  const serialized = JSON.stringify(payload);
  assert.ok(!/correct|solution|answer|imageId|"row"|"col"/i.test(serialized), "no answer-ish keys in the public payload");

  for (const tile of payload.tiles) {
    assert.match(tile.token, /^t1\.k1\.[A-Za-z0-9_-]+$/, "sealed token format");
    assert.ok(tile.assetUrl.endsWith(tile.token));
    // The ciphertext must not contain readable position or image information.
    const raw = Buffer.from(tile.token.split(".")[2]!, "base64url").toString("latin1");
    assert.ok(!/demo-\d|"r"|"c"|"g"/.test(raw), "token body must not contain plaintext fields");
  }
  assert.equal(new Set(payload.tiles.map((t) => t.token)).size, 9, "tokens are unique within a challenge");
});

test("meme puzzle: tokens are never reused across challenges", async () => {
  const provider = new SyntheticAssetProvider();
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const { definition } = await build(provider, { grid: 3 });
    for (const tile of (definition.publicPayload as Payload).tiles) {
      assert.ok(!seen.has(tile.token), "token reuse across challenges");
      seen.add(tile.token);
    }
  }
  assert.equal(seen.size, 270);
});

test("meme puzzle: every issued token resolves to a real tile; out-of-range locations do not", async () => {
  const provider = new SyntheticAssetProvider();
  const { definition, deps } = await build(provider, { grid: 3 });
  for (const tile of (definition.publicPayload as Payload).tiles) {
    const loc = openTile(tile.token, deps.keys);
    assert.ok(loc);
    const asset = await provider.getTile(loc);
    assert.ok(asset, "issued tokens must resolve");
    assert.equal(asset.contentType, "image/svg+xml");
    assert.ok(asset.data.toString("utf8").startsWith("<svg"));
  }
  assert.equal(await provider.getTile({ imageId: "demo-1", grid: 3, row: 3, col: 0 }), undefined);
  assert.equal(await provider.getTile({ imageId: "demo-1", grid: 3, row: -1, col: 0 }), undefined);
  assert.equal(await provider.getTile({ imageId: "demo-1", grid: 99, row: 0, col: 0 }), undefined);
  assert.equal(await provider.getTile({ imageId: "not-in-catalogue", grid: 3, row: 0, col: 0 }), undefined);
});

test("synthetic tiles of one image genuinely line up: they are crops of one shared picture", async () => {
  const provider = new SyntheticAssetProvider({ images: [{ id: "fixed-image" }] });
  const { definition, deps } = await build(provider, { grid: 2 });
  const sol = definition.solution as Solution;

  const svgs = await Promise.all(
    sol.correctOrder.map(async (t) => (await provider.getTile(openTile(t, deps.keys)!))!.data.toString("utf8")),
  );
  const circlesOf = (svg: string) => svg.match(/<circle [^>]*>/g)!.join("");
  const [first, ...rest] = svgs.map(circlesOf);
  for (const other of rest) assert.equal(other, first, "same circles in every tile");
  assert.equal(new Set(svgs.map((s) => s.match(/viewBox="([^"]+)"/)![1])).size, 4, "four distinct crops");
});
