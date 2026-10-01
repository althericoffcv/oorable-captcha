import { test } from "node:test";
import { secretOf } from "./helpers.ts";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OorableCaptchaEngine, createCaptcha, verifyCaptcha } from "../src/engine.ts";
import { MemoryChallengeStore } from "../src/challenge/memory-store.ts";
import { StaticKeyProvider, verifyToken } from "../src/crypto/token.ts";
import { assessRisk } from "../src/security/risk-engine.ts";
import { LocalPreprocessedAssetProvider } from "../src/assets/local-asset-provider.ts";
import { ConfigurationError } from "../src/errors.ts";
import type { LifecycleEvent } from "../src/challenge/lifecycle.ts";
import type { MemePuzzlePublicPayload } from "../src/challenges/meme-puzzle.ts";
import type { ImageCaptchaPublicPayload } from "../src/challenges/image-captcha.ts";

function harness(extra: ConstructorParameters<typeof OorableCaptchaEngine>[0] = {}) {
  const store = new MemoryChallengeStore();
  const keys = new StaticKeyProvider({ k1: secretOf("unit-test-secret") }, "k1");
  const events: LifecycleEvent[] = [];
  const engine = new OorableCaptchaEngine({ store, keys, onEvent: (e) => events.push(e), ...extra });
  return { engine, store, keys, events };
}

/** Tests own the store, so they can read the server-side solution the way the server itself would. */
async function solutionOf<T>(store: MemoryChallengeStore, challengeId: string): Promise<T> {
  const record = await store.get(challengeId);
  assert.ok(record, "challenge should exist in the store");
  return record.solution as T;
}

// ---------------------------------------------------------------- risk engine

test("risk engine: escalates and blocks at configured thresholds", () => {
  const thresholds = { challenge: 0.4, block: 0.8 };
  const at = (value: number) => assessRisk([{ name: "failure_rate", weight: 1, value }], thresholds).action;
  assert.equal(at(0.1), "allow");
  assert.equal(at(0.5), "challenge");
  assert.equal(at(0.95), "block");
});

test("risk engine: clamps out-of-range values, normalizes weights, tolerates no signals", () => {
  const thresholds = { challenge: 0.4, block: 0.8 };
  const wild = assessRisk([{ name: "x", weight: 1, value: 50 }], thresholds);
  assert.equal(wild.score, 1);
  const negative = assessRisk([{ name: "x", weight: 1, value: -3 }], thresholds);
  assert.equal(negative.score, 0);

  const weighted = assessRisk(
    [
      { name: "heavy", weight: 3, value: 1 },
      { name: "light", weight: 1, value: 0 },
    ],
    thresholds,
  );
  assert.equal(weighted.score, 0.75);

  const empty = assessRisk([], thresholds);
  assert.equal(empty.score, 0);
  assert.equal(empty.action, "allow");
});

// ------------------------------------------------------------ answer leakage

test("leakage: the created text challenge does not expose the code as plain text", async () => {
  const { engine, store } = harness();
  const created = await engine.createChallenge({ type: "text", length: 8 });
  const { code } = await solutionOf<{ code: string }>(store, created.challengeId);
  const serialized = JSON.stringify(created);
  assert.ok(!serialized.includes(code));
  assert.ok(!/"(code|answer|solution)"/.test(serialized));
});

test("leakage: verification failures never echo the submitted answer or the solution", async () => {
  const { engine, store } = harness();
  const created = await engine.createChallenge({ type: "text", length: 6 });
  const { code } = await solutionOf<{ code: string }>(store, created.challengeId);
  const result = await engine.verifyChallenge({ challengeId: created.challengeId, answer: "definitely-wrong-guess" });
  assert.equal(result.success, false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("definitely-wrong-guess"));
  assert.ok(!serialized.includes(code));
});

test("leakage: lifecycle events carry only non-secret metadata", async () => {
  const { engine, store, events } = harness();
  const created = await engine.createChallenge({ type: "text", length: 6 });
  const { code } = await solutionOf<{ code: string }>(store, created.challengeId);
  await engine.verifyChallenge({ challengeId: created.challengeId, answer: "nope-nope" });
  await engine.verifyChallenge({ challengeId: created.challengeId, answer: code });

  assert.equal(events.length, 3);
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes(code));
  assert.ok(!serialized.includes("nope-nope"));
  for (const event of events) {
    assert.deepEqual(
      Object.keys(event).sort().filter((k) => !["success"].includes(k)),
      ["challengeId", "name", "type"],
    );
  }
});

test("leakage: image challenge correctness flags never reach the public payload", async () => {
  const { engine } = harness();
  const created = await engine.createChallenge({
    type: "image",
    candidates: [
      { id: "a", imageUrl: "https://cdn.example/a.jpg", correct: true },
      { id: "b", imageUrl: "https://cdn.example/b.jpg", correct: false },
      { id: "c", imageUrl: "https://cdn.example/c.jpg", correct: true },
      { id: "d", imageUrl: "https://cdn.example/d.jpg", correct: false },
    ],
  });
  const payload = created.challenge as ImageCaptchaPublicPayload;
  assert.ok(!JSON.stringify(created).includes("correct"));
  assert.equal(payload.options.length, 4);
  assert.equal(payload.select, 2);
});

// -------------------------------------------------- end-to-end lifecycles

test("meme puzzle e2e: the correct arrangement succeeds exactly once and yields a verifiable token", async () => {
  const { engine, store, keys } = harness();
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 3, siteKey: "site-1" });
  const { correctOrder } = await solutionOf<{ correctOrder: string[] }>(store, created.challengeId);

  const first = await engine.verifyChallenge({ challengeId: created.challengeId, answer: correctOrder, siteKey: "site-1" });
  assert.equal(first.success, true);
  if (first.success) {
    const checked = verifyToken(first.verificationToken, keys);
    assert.equal(checked.valid, true);
    if (checked.valid) {
      assert.equal(checked.payload.challengeId, created.challengeId);
      assert.equal(checked.payload.type, "meme-puzzle");
      assert.equal(checked.payload.siteKey, "site-1");
    }
  }

  const replay = await engine.verifyChallenge({ challengeId: created.challengeId, answer: correctOrder, siteKey: "site-1" });
  assert.equal(replay.success, false);
  if (!replay.success) assert.equal(replay.reason, "already_used");
});

test("meme puzzle e2e: submitting the still-shuffled layout fails, and attempts eventually lock the challenge", async () => {
  const { engine, store } = harness({ defaultMaxAttempts: 3 });
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 3 });
  const displayed = (created.challenge as MemePuzzlePublicPayload).tiles.map((t) => t.token);
  const { correctOrder } = await solutionOf<{ correctOrder: string[] }>(store, created.challengeId);

  // The generator guarantees the initial layout is never the solved one.
  assert.notDeepEqual(displayed, correctOrder);

  for (let i = 0; i < 3; i++) {
    const r = await engine.verifyChallenge({ challengeId: created.challengeId, answer: displayed });
    assert.equal(r.success, false);
    if (!r.success) assert.equal(r.reason, "incorrect");
  }
  const locked = await engine.verifyChallenge({ challengeId: created.challengeId, answer: correctOrder });
  assert.equal(locked.success, false);
  if (!locked.success) assert.equal(locked.reason, "too_many_attempts");
});

test("meme puzzle e2e: 20 parallel correct submissions produce exactly one token", async () => {
  const { engine, store } = harness();
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 2 });
  const { correctOrder } = await solutionOf<{ correctOrder: string[] }>(store, created.challengeId);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => engine.verifyChallenge({ challengeId: created.challengeId, answer: correctOrder })),
  );
  assert.equal(results.filter((r) => r.success).length, 1);
});

test("image e2e: only the exact correct selection passes", async () => {
  const { engine } = harness();
  const candidates = [
    { id: "a", imageUrl: "https://cdn.example/a.jpg", correct: true },
    { id: "b", imageUrl: "https://cdn.example/b.jpg", correct: false },
    { id: "c", imageUrl: "https://cdn.example/c.jpg", correct: true },
    { id: "d", imageUrl: "https://cdn.example/d.jpg", correct: false },
  ];

  const attempt = async (answer: unknown) => {
    const created = await engine.createChallenge({ type: "image", candidates });
    return engine.verifyChallenge({ challengeId: created.challengeId, answer });
  };

  assert.equal((await attempt(["a", "c"])).success, true);
  assert.equal((await attempt(["c", "a"])).success, true, "order of selection does not matter");
  assert.equal((await attempt(["a"])).success, false, "too few");
  assert.equal((await attempt(["a", "b"])).success, false, "one wrong");
  assert.equal((await attempt(["a", "b", "c", "d"])).success, false, "select-all");
  assert.equal((await attempt(["a", "a"])).success, false, "duplicates cannot pad a selection");
  assert.equal((await attempt("a,c")).success, false, "wrong shape");
});

test("expiry: a challenge past its ttl cannot be solved even with the right answer", async () => {
  const { engine, store } = harness({ defaultTtlMs: 25 });
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 2 });
  const { correctOrder } = await solutionOf<{ correctOrder: string[] }>(store, created.challengeId);
  await new Promise((r) => setTimeout(r, 60));
  const result = await engine.verifyChallenge({ challengeId: created.challengeId, answer: correctOrder });
  assert.equal(result.success, false);
});

// ----------------------------------------------------------- token forgery

test("tokens: a forged, tampered, or foreign-key token never verifies", async () => {
  const { engine, store, keys } = harness();
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 2 });
  const { correctOrder } = await solutionOf<{ correctOrder: string[] }>(store, created.challengeId);
  const ok = await engine.verifyChallenge({ challengeId: created.challengeId, answer: correctOrder });
  assert.ok(ok.success);
  if (!ok.success) return;

  const [v, kid, payload, sig] = ok.verificationToken.split(".") as [string, string, string, string];
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assert.equal(verifyToken([v, kid, payload, flipped].join("."), keys).valid, false);

  const foreign = new StaticKeyProvider({ k1: secretOf("attacker-chosen-secret") }, "k1");
  assert.equal(verifyToken(ok.verificationToken, foreign).valid, false);

  // Attacker edits the payload (e.g. extends exp) and keeps the old signature.
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  decoded.exp += 10_000_000;
  const edited = Buffer.from(JSON.stringify(decoded)).toString("base64url");
  assert.equal(verifyToken([v, kid, edited, sig].join("."), keys).valid, false);
});

test("tokens: a correctly signed token with the wrong purpose is refused", () => {
  const keys = new StaticKeyProvider({ k1: secretOf("unit-test-secret") }, "k1");
  const payload = Buffer.from(
    JSON.stringify({
      challengeId: "x",
      type: "text",
      iat: Date.now(),
      exp: Date.now() + 60_000,
      nonce: "n",
      purpose: "some-other-system",
    }),
  );
  const sig = createHmac("sha256", Buffer.from(secretOf("unit-test-secret"))).update(payload).digest();
  const token = `v1.k1.${payload.toString("base64url")}.${sig.toString("base64url")}`;
  const result = verifyToken(token, keys);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "wrong_purpose");
});

test("tokens: an oversized token is rejected as malformed without being processed", () => {
  const keys = new StaticKeyProvider({ k1: secretOf("unit-test-secret") }, "k1");
  const huge = "v1.k1." + "A".repeat(1_000_000) + ".AAAA";
  const result = verifyToken(huge, keys);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "malformed");
});

// --------------------------------------------- oversized / malformed input

test("input: oversized and malformed answers fail cleanly and still count as attempts", async () => {
  const { engine, store } = harness();
  const text = await engine.createChallenge({ type: "text" });
  const big = await engine.verifyChallenge({ challengeId: text.challengeId, answer: "A".repeat(5_000_000) });
  assert.equal(big.success, false);
  assert.equal((await store.get(text.challengeId))!.attempts, 1);

  const meme = await engine.createChallenge({ type: "meme-puzzle", grid: 3 });
  const bigArray = await engine.verifyChallenge({
    challengeId: meme.challengeId,
    answer: new Array(1_000_000).fill("x"),
  });
  assert.equal(bigArray.success, false);

  for (const bad of [null, undefined, 42, {}, [], [[]], () => 1]) {
    const c = await engine.createChallenge({ type: "meme-puzzle", grid: 2 });
    const r = await engine.verifyChallenge({ challengeId: c.challengeId, answer: bad });
    assert.equal(r.success, false);
  }
});

// ------------------------------------------------------ fail-closed config

test("config: unsupported types and missing image candidates fail closed", async () => {
  const { engine } = harness();
  await assert.rejects(() => engine.createChallenge({ type: "audio" as never }), ConfigurationError);
  await assert.rejects(() => engine.createChallenge({ type: "image" }), ConfigurationError);
  await assert.rejects(
    () =>
      engine.createChallenge({
        type: "image",
        candidates: [{ id: "only", imageUrl: "https://cdn.example/a.jpg", correct: true }],
      }),
    /at least 2 candidates/,
  );
});

test("config: with no signing key configured the engine refuses to start", () => {
  const saved = process.env.OORABLE_CAPTCHA_SECRET;
  delete process.env.OORABLE_CAPTCHA_SECRET;
  try {
    assert.throws(() => new OorableCaptchaEngine(), ConfigurationError);
  } finally {
    if (saved !== undefined) process.env.OORABLE_CAPTCHA_SECRET = saved;
  }
});

test("config: the createCaptcha/verifyCaptcha convenience API works from OORABLE_CAPTCHA_SECRET", async () => {
  const saved = process.env.OORABLE_CAPTCHA_SECRET;
  process.env.OORABLE_CAPTCHA_SECRET = secretOf("convenience-api-test-secret");
  try {
    const created = await createCaptcha({ type: "text", length: 6 });
    assert.equal(created.type, "text");
    assert.ok(created.expiresIn > 0);
    const result = await verifyCaptcha({ challengeId: created.challengeId, answer: "definitely-wrong" });
    assert.equal(result.success, false);
  } finally {
    if (saved === undefined) delete process.env.OORABLE_CAPTCHA_SECRET;
    else process.env.OORABLE_CAPTCHA_SECRET = saved;
  }
});

// ------------------------------------------------- SSRF / traversal / DoS

test("ssrf: the engine never performs network requests, whatever URLs the catalogue contains", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    throw new Error("network access attempted");
  }) as typeof fetch;
  try {
    const { engine, store } = harness();
    await engine.createChallenge({ type: "text" });
    const meme = await engine.createChallenge({ type: "meme-puzzle", grid: 2 });
    const { correctOrder } = await solutionOf<{ correctOrder: string[] }>(store, meme.challengeId);
    await engine.verifyChallenge({ challengeId: meme.challengeId, answer: correctOrder });
    const img = await engine.createChallenge({
      type: "image",
      candidates: [
        { id: "a", imageUrl: "http://169.254.169.254/latest/meta-data/", correct: true },
        { id: "b", imageUrl: "file:///etc/passwd", correct: false },
      ],
    });
    await engine.verifyChallenge({ challengeId: img.challengeId, answer: ["a"] });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("traversal: the local asset provider cannot be steered outside its processed directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "oorable-assets-"));
  try {
    const processed = join(root, "processed");
    await mkdir(join(processed, "meme-1", "3"), { recursive: true });
    await writeFile(join(processed, "meme-1", "3", "r0c0.jpg"), "legit-tile");

    // A file *outside* processedDir that a traversal would reach.
    await mkdir(join(root, "secret", "3"), { recursive: true });
    await writeFile(join(root, "secret", "3", "r0c0.jpg"), "TOP-SECRET");

    const provider = new LocalPreprocessedAssetProvider({ processedDir: processed, images: [{ id: "meme-1" }] });

    const good = await provider.getTile({ imageId: "meme-1", grid: 3, row: 0, col: 0 });
    assert.equal(good?.data.toString(), "legit-tile");
    assert.equal(good?.contentType, "image/jpeg");

    for (const evil of ["../secret", "..\\secret", "../../secret", "/etc", "meme-1/../../secret", "secret"]) {
      const leaked = await provider.getTile({ imageId: evil, grid: 3, row: 0, col: 0 });
      assert.equal(leaked, undefined, `traversal or unlisted image via ${evil}`);
    }
    // Numeric fields are sanitized too, even if a caller hands over a string.
    const sneaky = await provider.getTile({ imageId: "meme-1", grid: "3/../../../secret" as never, row: 0, col: 0 });
    assert.equal(sneaky, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dos: creation cost is bounded -- grid and code length are clamped, so clients cannot request huge work", async () => {
  const { engine } = harness();
  const meme = await engine.createChallenge({ type: "meme-puzzle", grid: 1_000_000 });
  assert.equal((meme.challenge as MemePuzzlePublicPayload).tiles.length, 36);
  const text = await engine.createChallenge({ type: "text", length: 1_000_000 });
  const svg = Buffer.from((text.challenge as { image: { data: string } }).image.data, "base64").toString();
  assert.ok(svg.length < 20_000, "rendered SVG stays small no matter what length was requested");
});

test("dos: the in-memory store sweeps expired challenges so memory stays bounded", async () => {
  const store = new MemoryChallengeStore(15);
  const keys = new StaticKeyProvider({ k1: secretOf("unit-test-secret") }, "k1");
  const engine = new OorableCaptchaEngine({ store, keys, defaultTtlMs: 10 });
  const ids: string[] = [];
  for (let i = 0; i < 50; i++) ids.push((await engine.createChallenge({ type: "text" })).challengeId);
  await new Promise((r) => setTimeout(r, 80));
  const survivors = await Promise.all(ids.map((id) => store.get(id)));
  assert.equal(survivors.filter(Boolean).length, 0);
  store.close();
});

// ---------------------------------------------- sealed tiles through the engine

test("tiles: every issued tile token resolves through the engine; forged or tampered ones do not", async () => {
  const { engine } = harness();
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 3 });
  const tiles = (created.challenge as MemePuzzlePublicPayload).tiles;
  for (const tile of tiles) {
    const asset = await engine.resolveTile(tile.token);
    assert.ok(asset, "issued tokens must resolve");
    assert.equal(asset.contentType, "image/svg+xml");
    assert.equal(tile.assetUrl, `/v1/assets/tile/${tile.token}`);
  }
  const token = tiles[0]!.token;
  const flipped = token.slice(0, -3) + (token.endsWith("AAA") ? "BBB" : "AAA");
  assert.equal(await engine.resolveTile(flipped), undefined);
  for (const junk of ["t1.k1.AAAA", "../../etc/passwd", "", "t1..", "t1.k1.", "x".repeat(10_000)]) {
    assert.equal(await engine.resolveTile(junk), undefined);
  }
});

test("tiles: tokens expire with the challenge", async () => {
  const { engine } = harness({ defaultTtlMs: 30 });
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 2 });
  const token = (created.challenge as MemePuzzlePublicPayload).tiles[0]!.token;
  assert.ok(await engine.resolveTile(token));
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(await engine.resolveTile(token), undefined);
});

test("tiles: a token minted under one signing key is useless under another", async () => {
  const a = harness();
  const b = new OorableCaptchaEngine({ keys: new StaticKeyProvider({ k1: secretOf("a-different-deployment") }, "k1") });
  const created = await a.engine.createChallenge({ type: "meme-puzzle", grid: 2 });
  const token = (created.challenge as MemePuzzlePublicPayload).tiles[0]!.token;
  assert.ok(await a.engine.resolveTile(token));
  assert.equal(await b.resolveTile(token), undefined);
});

// ------------------------------------------------------------ token redemption

async function solveOne(h = harness(), options: { sessionId?: string } = {}) {
  const created = await h.engine.createChallenge({ type: "meme-puzzle", grid: 2, siteKey: "site-1", ...options });
  const { correctOrder } = await solutionOf<{ correctOrder: string[] }>(h.store, created.challengeId);
  const result = await h.engine.verifyChallenge({
    challengeId: created.challengeId,
    answer: correctOrder,
    siteKey: "site-1",
  });
  assert.ok(result.success, "test setup: the puzzle should solve");
  return { ...h, created, token: result.success ? result.verificationToken : "" };
}

test("redeem: a verification token is single-use", async () => {
  const { engine, token, created } = await solveOne();
  const first = await engine.redeemToken(token, { siteKey: "site-1" });
  assert.equal(first.valid, true);
  if (first.valid) {
    assert.equal(first.challengeId, created.challengeId);
    assert.equal(first.type, "meme-puzzle");
    assert.equal(first.siteKey, "site-1");
  }
  const replay = await engine.redeemToken(token, { siteKey: "site-1" });
  assert.equal(replay.valid, false);
  if (!replay.valid) assert.equal(replay.reason, "already_redeemed");
});

test("redeem: presenting a token for the wrong site or session does not burn it", async () => {
  const { engine, token } = await solveOne(harness(), { sessionId: "sess-1" });

  const wrongSite = await engine.redeemToken(token, { siteKey: "some-other-site" });
  assert.equal(wrongSite.valid === false && wrongSite.reason, "site_key_mismatch");
  const wrongSession = await engine.redeemToken(token, { siteKey: "site-1", sessionId: "sess-2" });
  assert.equal(wrongSession.valid === false && wrongSession.reason, "session_mismatch");

  const right = await engine.redeemToken(token, { siteKey: "site-1", sessionId: "sess-1" });
  assert.equal(right.valid, true, "the legitimate redemption must still succeed after failed probes");
});

test("redeem: garbage, tampered, foreign-key and expired tokens are refused", async () => {
  const h = harness({ verificationTokenTtlMs: 40 });
  const { engine, token } = await solveOne(h);

  for (const junk of ["", "garbage", "v1.k1.a.b", "x".repeat(5000)]) {
    const r = await engine.redeemToken(junk);
    assert.equal(r.valid === false && r.reason, "invalid_token");
  }
  const [v, kid, payload, sig] = token.split(".") as [string, string, string, string];
  const tampered = await engine.redeemToken([v, kid, payload, sig.slice(0, -3) + "AAA"].join("."));
  assert.equal(tampered.valid, false);

  const other = new OorableCaptchaEngine({ keys: new StaticKeyProvider({ k1: secretOf("another-deployment") }, "k1") });
  assert.equal((await other.redeemToken(token)).valid, false);

  await new Promise((r) => setTimeout(r, 90));
  const late = await engine.redeemToken(token);
  assert.equal(late.valid === false && late.reason, "expired");
});

test("redeem: 25 parallel redemptions of one token produce exactly one success", async () => {
  const { engine, token } = await solveOne();
  const results = await Promise.all(Array.from({ length: 25 }, () => engine.redeemToken(token, { siteKey: "site-1" })));
  assert.equal(results.filter((r) => r.valid).length, 1);
});

// ---------------------------------------------------------------------- refresh

test("refresh: yields an equivalent fresh challenge and discards the old one", async () => {
  const { engine, store } = harness();
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 4, siteKey: "site-1" });
  const fresh = await engine.refreshChallenge({ challengeId: created.challengeId, siteKey: "site-1" });

  assert.ok(fresh);
  assert.notEqual(fresh.challengeId, created.challengeId);
  assert.equal((fresh.challenge as MemePuzzlePublicPayload).tiles.length, 16, "creation options carry over");
  assert.equal(await store.get(created.challengeId), undefined, "the old challenge is gone");

  const oldTokens = new Set((created.challenge as MemePuzzlePublicPayload).tiles.map((t) => t.token));
  for (const t of (fresh.challenge as MemePuzzlePublicPayload).tiles) assert.ok(!oldTokens.has(t.token));
  assert.equal((await engine.verifyChallenge({ challengeId: created.challengeId, answer: [], siteKey: "site-1" })).success, false);
});

test("refresh: refuses unknown, already-solved and foreign-site challenges, and leaves them untouched", async () => {
  const { engine, store } = harness();
  assert.equal(await engine.refreshChallenge({ challengeId: "nope", siteKey: "site-1" }), undefined);

  const solvedOne = await solveOne(harness());
  assert.equal(await solvedOne.engine.refreshChallenge({ challengeId: solvedOne.created.challengeId, siteKey: "site-1" }), undefined);

  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 2, siteKey: "site-1" });
  assert.equal(await engine.refreshChallenge({ challengeId: created.challengeId, siteKey: "site-2" }), undefined);
  assert.equal(await engine.refreshChallenge({ challengeId: created.challengeId }), undefined);
  assert.ok(await store.get(created.challengeId), "a refused refresh must not delete the original");
});

test("refresh: image challenges need their server-side candidates re-supplied, and a failed refresh keeps the original", async () => {
  const { engine, store } = harness();
  const candidates = [
    { id: "a", imageUrl: "https://cdn.example/a.jpg", correct: true },
    { id: "b", imageUrl: "https://cdn.example/b.jpg", correct: false },
  ];
  const created = await engine.createChallenge({ type: "image", candidates });

  await assert.rejects(() => engine.refreshChallenge({ challengeId: created.challengeId }), ConfigurationError);
  assert.ok(await store.get(created.challengeId), "the original survives a failed refresh");

  const fresh = await engine.refreshChallenge({ challengeId: created.challengeId }, { candidates });
  assert.ok(fresh);
  assert.equal(fresh.type, "image");
});
