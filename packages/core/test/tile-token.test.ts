import { test } from "node:test";
import assert from "node:assert/strict";
import { sealTile, openTile } from "../src/crypto/tile-token.ts";
import { StaticKeyProvider } from "../src/crypto/token.ts";
import { secretOf, testKeys } from "./helpers.ts";

const location = { imageId: "meme-1", grid: 3, row: 1, col: 2 };
const future = () => Date.now() + 60_000;

test("tile token: round-trips the location", () => {
  const keys = testKeys();
  assert.deepEqual(openTile(sealTile(location, future(), keys), keys), location);
});

test("tile token: sealing the same tile twice gives unrelated strings (random IV)", () => {
  const keys = testKeys();
  const a = sealTile(location, future(), keys);
  const b = sealTile(location, future(), keys);
  assert.notEqual(a, b);
  assert.notEqual(a.split(".")[2]!.slice(0, 16), b.split(".")[2]!.slice(0, 16));
});

test("tile token: the body is ciphertext, not readable JSON", () => {
  const keys = testKeys();
  const raw = Buffer.from(sealTile(location, future(), keys).split(".")[2]!, "base64url").toString("latin1");
  assert.ok(!raw.includes("meme-1"));
  assert.ok(!raw.includes('"r"'));
});

test("tile token: flipping any single character anywhere in the body invalidates it", () => {
  const keys = testKeys();
  const token = sealTile(location, future(), keys);
  const [t, kid, body] = token.split(".") as [string, string, string];
  let rejected = 0;
  for (let i = 0; i < body.length; i++) {
    const swapped = body[i] === "A" ? "B" : "A";
    const mutated = `${t}.${kid}.${body.slice(0, i)}${swapped}${body.slice(i + 1)}`;
    if (openTile(mutated, keys) === undefined) rejected++;
  }
  // The final base64url character can carry unused low bits, so a flip there may decode to identical bytes.
  assert.ok(rejected >= body.length - 1, `${rejected}/${body.length} single-character mutations rejected`);
  assert.equal(openTile(`${t}.${kid}.${body}AAAA`, keys), undefined, "extended");
  assert.equal(openTile(`${t}.${kid}.${body.slice(0, -8)}`, keys), undefined, "truncated");
});

test("tile token: the key id is authenticated, so re-labelling a token does not help", () => {
  const rotated = new StaticKeyProvider({ k1: secretOf("first"), k2: secretOf("second") }, "k1");
  const token = sealTile(location, future(), rotated);
  const relabelled = token.replace(".k1.", ".k2.");
  assert.equal(openTile(relabelled, rotated), undefined);
});

test("tile token: a different signing key cannot open it", () => {
  const token = sealTile(location, future(), testKeys("deployment-a"));
  assert.equal(openTile(token, testKeys("deployment-b")), undefined);
});

test("tile token: expiry is enforced and is inside the authenticated payload", () => {
  const keys = testKeys();
  const token = sealTile(location, 1_000, keys);
  assert.deepEqual(openTile(token, keys, 999), location);
  assert.deepEqual(openTile(token, keys, 1_000), location);
  assert.equal(openTile(token, keys, 1_001), undefined);
});

test("tile token: rotation -- old tokens open under a retired key, new ones use the active key", () => {
  const before = new StaticKeyProvider({ k1: secretOf("first") }, "k1");
  const oldToken = sealTile(location, future(), before);
  const after = new StaticKeyProvider({ k1: secretOf("first"), k2: secretOf("second") }, "k2");
  assert.deepEqual(openTile(oldToken, after), location);
  assert.ok(sealTile(location, future(), after).startsWith("t1.k2."));
});

test("tile token: malformed and oversized input returns undefined and never throws", () => {
  const keys = testKeys();
  const inputs: unknown[] = ["", "t1", "t1.k1", "t1.k1.", "t1.k1.!!!!", "t2.k1.AAAA", "a.b.c.d", "x".repeat(100_000), null, undefined, 42, {}];
  for (const input of inputs) assert.equal(openTile(input as string, keys), undefined);
});
