import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryChallengeStore } from "../src/challenge/memory-store.ts";
import { MemoryRateLimiter } from "../src/security/rate-limiter.ts";
import { CapacityError } from "../src/errors.ts";
import type { ChallengeRecord } from "../src/challenge/types.ts";

function rec(id: string, ttlMs: number): ChallengeRecord {
  const now = Date.now();

  return {
    id,
    type: "text",
    version: 1,
    issuedAt: now,
    expiresAt: now + ttlMs,
    attempts: 0,
    maxAttempts: 5,
    consumed: false,
    solution: { code: "X" },
    publicPayload: {},
  };
}

test("store: refuses to grow past maxEntries instead of exhausting memory", async () => {
  const store = new MemoryChallengeStore({
    maxEntries: 5,
    sweepIntervalMs: 60_000,
  });

  for (let i = 0; i < 5; i++) {
    await store.create(rec(`c${i}`, 60_000));
  }

  await assert.rejects(
    () => store.create(rec("overflow", 60_000)),
    CapacityError,
  );

  assert.ok(
    await store.get("c0"),
    "existing challenges are unaffected by the refusal",
  );

  store.close();
});

test("store: a full store frees space by sweeping expired entries before refusing", async () => {
  const store = new MemoryChallengeStore({
    maxEntries: 5,
    sweepIntervalMs: 60_000,
  });

  for (let i = 0; i < 5; i++) {
    await store.create(rec(`short${i}`, 50));
  }

  await new Promise((r) => setTimeout(r, 100));

  await store.create(rec("fits-after-sweep", 60_000));

  assert.ok(await store.get("fits-after-sweep"));

  store.close();
});

test("store: redemption markers count toward the cap and are swept when they expire", async () => {
  const store = new MemoryChallengeStore({
    maxEntries: 3,
    sweepIntervalMs: 60_000,
  });

  assert.equal(await store.tryRedeem("t1", 100), true);
  assert.equal(await store.tryRedeem("t2", 100), true);
  assert.equal(await store.tryRedeem("t3", 100), true);

  await assert.rejects(
    () => store.tryRedeem("t4", 60_000),
    CapacityError,
  );

  await new Promise((r) => setTimeout(r, 150));

  assert.equal(
    await store.tryRedeem("t4", 60_000),
    true,
    "expired markers were swept to make room",
  );

  store.close();
});

test("store: tryRedeem is one-shot per id until its ttl lapses", async () => {
  const store = new MemoryChallengeStore({
    sweepIntervalMs: 60_000,
  });

  assert.equal(await store.tryRedeem("tok", 100), true);
  assert.equal(await store.tryRedeem("tok", 100), false);
  assert.equal(await store.tryRedeem("other", 100), true);

  await new Promise((r) => setTimeout(r, 150));

  assert.equal(
    await store.tryRedeem("tok", 100),
    true,
    "the marker may be discarded once the token itself could no longer verify",
  );

  store.close();
});

test("store: tryConsume is one-shot and refuses unknown or expired challenges", async () => {
  const store = new MemoryChallengeStore({
    sweepIntervalMs: 60_000,
  });

  await store.create(rec("a", 60_000));
  await store.create(rec("gone", -1));

  assert.equal(await store.tryConsume("a"), true);
  assert.equal(await store.tryConsume("a"), false);
  assert.equal(await store.tryConsume("nope"), false);
  assert.equal(await store.tryConsume("gone"), false);

  store.close();
});

test("rate limiter: memory stays bounded no matter how many distinct keys an attacker rotates through", async () => {
  const limiter = new MemoryRateLimiter(5, 60_000, {
    maxKeys: 100,
    sweepIntervalMs: 60_000,
  });

  for (let i = 0; i < 5_000; i++) {
    await limiter.consume(`ip:10.0.${i >> 8}.${i & 255}`);
  }

  assert.ok(
    limiter.size <= 100,
    `tracked ${limiter.size} keys with a cap of 100`,
  );

  const fresh = await limiter.consume("ip:fresh");

  assert.equal(fresh.allowed, true);

  limiter.close();
});

test("rate limiter: expired windows are swept in the background", async () => {
  const limiter = new MemoryRateLimiter(1, 10, {
    sweepIntervalMs: 15,
  });

  for (let i = 0; i < 20; i++) {
    await limiter.consume(`k${i}`);
  }

  assert.equal(limiter.size, 20);

  await new Promise((r) => setTimeout(r, 80));

  assert.equal(limiter.size, 0);

  limiter.close();
});

test("rate limiter: peek reports without consuming", async () => {
  const limiter = new MemoryRateLimiter(2, 60_000, {
    sweepIntervalMs: 60_000,
  });

  const first = await limiter.consume("peek-test");

  assert.equal(first.allowed, true);

  const before = await limiter.peek("peek-test");

  assert.equal(before.allowed, true);
  assert.equal(before.remaining, 1);

  const after = await limiter.peek("peek-test");

  assert.equal(after.allowed, true);
  assert.equal(after.remaining, 1);

  limiter.close();
});
