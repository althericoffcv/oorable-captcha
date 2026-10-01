import { test } from "node:test";
import assert from "node:assert/strict";
import { RedisChallengeStore, RedisRateLimiter } from "../src/index.ts";
import type { ChallengeRecord } from "@oorable/captcha";

/**
 * Runs the exact Lua scripts in src/index.ts against a real Redis server via
 * `ioredis`. This is the test that actually validates the Lua -- the fake
 * client in store.test.ts only checks the calling contract.
 *
 * Neither `ioredis` nor a Redis server is available in the sandbox this
 * package was built in (no network to install/run either), so this file
 * detects that and SKIPS with an explanatory message rather than silently
 * passing. On a machine with both (`npm install ioredis` and a local/CI
 * Redis, or `REDIS_URL` pointed at one), it runs for real. See
 * docs/testing.md.
 */

let Redis: typeof import("ioredis").default | undefined;
let client: import("ioredis").Redis | undefined;
let skipReason: string | undefined;

try {
  ({ default: Redis } = await import("ioredis"));
} catch {
  skipReason = "ioredis is not installed (`npm install ioredis` in this package to enable)";
}

if (Redis && !skipReason) {
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  const candidate = new Redis(url, { lazyConnect: true, retryStrategy: () => null, connectTimeout: 500 });
  try {
    await candidate.connect();
    await candidate.ping();
    client = candidate;
  } catch (err) {
    skipReason = `could not reach a Redis server at ${url} (${err instanceof Error ? err.message : String(err)}); set REDIS_URL or start one to enable`;
    candidate.disconnect();
  }
}

if (skipReason) {
  test(`redis integration (skipped: ${skipReason})`, { skip: skipReason }, () => {});
} else {
  const redis = client!;

  function record(id: string, ttlMs: number): ChallengeRecord {
    const now = Date.now();
    return {
      id,
      type: "text",
      version: 1,
      issuedAt: now,
      expiresAt: now + ttlMs,
      attempts: 0,
      maxAttempts: 3,
      consumed: false,
      solution: { code: "REAL1" },
      publicPayload: {},
    };
  }

  test.after(async () => {
    const keys = await redis.keys("oorable-integration-test:*");
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
  });

  test("redis integration: tryConsume is atomic under real concurrent clients", async () => {
    const store = new RedisChallengeStore(redis, { keyPrefix: "oorable-integration-test:" });
    await store.create(record("race1", 60_000));
    const results = await Promise.all(Array.from({ length: 25 }, () => store.tryConsume("race1")));
    assert.equal(results.filter(Boolean).length, 1, "exactly one concurrent tryConsume wins against real Redis + real Lua");
  });

  test("redis integration: incrementAttempts is atomic and every increment is observed", async () => {
    const store = new RedisChallengeStore(redis, { keyPrefix: "oorable-integration-test:" });
    await store.create(record("race2", 60_000));
    await Promise.all(Array.from({ length: 20 }, () => store.incrementAttempts("race2")));
    const final = await store.get("race2");
    assert.equal(final?.attempts, 20, "no increments lost to a race, for real, against Redis");
  });

  test("redis integration: TTL is honored -- the key actually expires in Redis", async () => {
    const store = new RedisChallengeStore(redis, { keyPrefix: "oorable-integration-test:" });
    await store.create(record("ttl1", 50));
    assert.ok(await store.get("ttl1"));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await store.get("ttl1"), undefined);
  });

  test("redis integration: tryRedeem is atomic and one-shot against real Redis", async () => {
    const store = new RedisChallengeStore(redis, { keyPrefix: "oorable-integration-test:" });
    const results = await Promise.all(Array.from({ length: 15 }, () => store.tryRedeem("tok-race", 30_000)));
    assert.equal(results.filter(Boolean).length, 1);
  });

  test("redis integration: rate limiter enforces the limit across concurrent requests", async () => {
    const limiter = new RedisRateLimiter(redis, 5, 60_000, { keyPrefix: "oorable-integration-test:rl:" });
    const results = await Promise.all(Array.from({ length: 30 }, () => limiter.consume("burst")));
    assert.equal(results.filter((r) => r.allowed).length, 5, "real Redis INCR+PEXPIRE enforces the cap under concurrency");
  });

  test("redis integration: two RedisChallengeStore instances against the same server share state", async () => {
    const a = new RedisChallengeStore(redis, { keyPrefix: "oorable-integration-test:" });
    const b = new RedisChallengeStore(redis, { keyPrefix: "oorable-integration-test:" });
    await a.create(record("shared", 60_000));
    assert.ok(await b.get("shared"), "a second process/instance can see what the first wrote");
    assert.equal(await b.tryConsume("shared"), true);
    assert.equal(await a.tryConsume("shared"), false, "and observes the other instance's consumption");
  });
}
