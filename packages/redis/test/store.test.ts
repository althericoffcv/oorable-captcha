import { test } from "node:test";
import assert from "node:assert/strict";
import { RedisChallengeStore, RedisRateLimiter, type RedisLikeClient } from "../src/index.ts";
import type { ChallengeRecord } from "@oorable/captcha";

/**
 * IMPORTANT SCOPE NOTE: this file exercises the CALLING CONTRACT between the
 * store/limiter and a Redis client -- right keys, right SET options, right
 * shape of eval()'s return value -- using a plain JS object as a stand-in
 * key/value store. It does NOT execute the Lua scripts in src/index.ts
 * (there is no Redis or Lua runtime in this environment) and therefore
 * cannot catch a Lua syntax error or a subtle behavioral bug in the scripts
 * themselves. test/integration.test.ts covers that, against a real `ioredis`
 * + Redis server, and is skipped (not faked) when that infrastructure is not
 * available -- see docs/testing.md.
 */

class FakeRedis implements RedisLikeClient {
  readonly store = new Map<string, string>();
  readonly expiresAt = new Map<string, number>();
  readonly calls: Array<{ cmd: string; args: unknown[] }> = [];

  private expired(key: string): boolean {
    const exp = this.expiresAt.get(key);
    if (exp !== undefined && exp <= Date.now()) {
      this.store.delete(key);
      this.expiresAt.delete(key);
      return true;
    }
    return false;
  }

  async get(key: string): Promise<string | null> {
    this.calls.push({ cmd: "get", args: [key] });
    this.expired(key);
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: string[]): Promise<unknown> {
    this.calls.push({ cmd: "set", args: [key, value, ...args] });
    this.store.set(key, value);
    const pxIndex = args.findIndex((a) => a.toUpperCase() === "PX");
    if (pxIndex !== -1) this.expiresAt.set(key, Date.now() + Number(args[pxIndex + 1]));
    else if (!args.some((a) => a.toUpperCase() === "KEEPTTL")) this.expiresAt.delete(key);
    return "OK";
  }

  async del(key: string): Promise<unknown> {
    this.calls.push({ cmd: "del", args: [key] });
    this.store.delete(key);
    this.expiresAt.delete(key);
    return 1;
  }

  /** Re-derives, in JS, exactly what each named Lua script computes -- see the scope note above. */
  async eval(script: string, numKeys: number, ...keysAndArgs: string[]): Promise<unknown> {
    this.calls.push({ cmd: "eval", args: [script.trim().split("\n")[0], numKeys, ...keysAndArgs] });
    const keys = keysAndArgs.slice(0, numKeys);
    const argv = keysAndArgs.slice(numKeys);
    const [key] = keys as [string];

    if (script.includes("if record.consumed then return 0 end")) {
      this.expired(key);
      const raw = this.store.get(key);
      if (!raw) return 0;
      const record = JSON.parse(raw);
      if (record.consumed) return 0;
      record.consumed = true;
      this.store.set(key, JSON.stringify(record));
      return 1;
    }
    if (script.includes("record.attempts = record.attempts + 1")) {
      this.expired(key);
      const raw = this.store.get(key);
      if (!raw) return null;
      const record = JSON.parse(raw);
      record.attempts += 1;
      this.store.set(key, JSON.stringify(record));
      return JSON.stringify(record);
    }
    if (script.includes('redis.call("EXISTS"')) {
      if (!this.expired(key) && this.store.has(key)) return 0;
      this.store.set(key, "1");
      this.expiresAt.set(key, Date.now() + Number(argv[0]));
      return 1;
    }
    if (script.includes('redis.call("INCR"')) {
      this.expired(key);
      const count = Number(this.store.get(key) ?? "0") + 1;
      this.store.set(key, String(count));
      if (count === 1) this.expiresAt.set(key, Date.now() + Number(argv[1]));
      const exp = this.expiresAt.get(key);
      return [count, exp !== undefined ? Math.max(0, exp - Date.now()) : -1];
    }
    if (script.includes('redis.call("GET"')) {
      this.expired(key);
      const raw = this.store.get(key);
      const exp = this.expiresAt.get(key);
      return [raw ?? false, exp !== undefined ? Math.max(0, exp - Date.now()) : -1];
    }
    throw new Error("FakeRedis: unrecognized script");
  }
}

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
    solution: { code: "X" },
    publicPayload: {},
  };
}

test("store: create sets a TTL derived from expiresAt, keyed under the configured prefix", async () => {
  const redis = new FakeRedis();
  const store = new RedisChallengeStore(redis, { keyPrefix: "test:" });
  await store.create(record("c1", 5_000));
  const setCall = redis.calls.find((c) => c.cmd === "set")!;
  assert.equal(setCall.args[0], "test:c1");
  assert.equal(setCall.args[2], "PX");
  assert.ok(Number(setCall.args[3]) <= 5_000 && Number(setCall.args[3]) > 4_000);
});

test("store: get round-trips a record and returns undefined for missing/expired keys", async () => {
  const redis = new FakeRedis();
  const store = new RedisChallengeStore(redis);
  await store.create(record("c1", 60_000));
  const fetched = await store.get("c1");
  assert.equal(fetched?.id, "c1");
  assert.equal(await store.get("nope"), undefined);

  await store.create(record("soon", 5));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await store.get("soon"), undefined);
});

test("store: tryConsume is one-shot and refuses unknown challenges", async () => {
  const redis = new FakeRedis();
  const store = new RedisChallengeStore(redis);
  await store.create(record("c1", 60_000));
  assert.equal(await store.tryConsume("c1"), true);
  assert.equal(await store.tryConsume("c1"), false);
  assert.equal(await store.tryConsume("never-created"), false);
});

test("store: incrementAttempts persists across calls and preserves other fields", async () => {
  const redis = new FakeRedis();
  const store = new RedisChallengeStore(redis);
  await store.create(record("c1", 60_000));
  await store.incrementAttempts("c1");
  const twice = await store.incrementAttempts("c1");
  assert.equal(twice?.attempts, 2);
  assert.equal(twice?.maxAttempts, 3);
  assert.equal(await store.incrementAttempts("nope"), undefined);
});

test("store: tryRedeem is one-shot per id within its ttl", async () => {
  const redis = new FakeRedis();
  const store = new RedisChallengeStore(redis);
  assert.equal(await store.tryRedeem("tok1", 50), true);
  assert.equal(await store.tryRedeem("tok1", 50), false);
  assert.equal(await store.tryRedeem("tok2", 50), true, "a different id is independent");
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(await store.tryRedeem("tok1", 50), true, "the marker may be reused once its ttl lapses");
});

test("store: delete removes the record", async () => {
  const redis = new FakeRedis();
  const store = new RedisChallengeStore(redis);
  await store.create(record("c1", 60_000));
  await store.delete("c1");
  assert.equal(await store.get("c1"), undefined);
});

test("store: two independent RedisChallengeStore instances against the same client see the same state (multi-instance simulation)", async () => {
  const redis = new FakeRedis();
  const a = new RedisChallengeStore(redis);
  const b = new RedisChallengeStore(redis);
  await a.create(record("shared", 60_000));
  assert.ok(await b.get("shared"));
  assert.equal(await a.tryConsume("shared"), true);
  assert.equal(await b.tryConsume("shared"), false, "instance B observes the consumption instance A performed");
});

test("limiter: consume increments and sets expiry only on the first hit of a window", async () => {
  const redis = new FakeRedis();
  const limiter = new RedisRateLimiter(redis, 3, 60_000);
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await limiter.consume("k"));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false, false]);
  const expireCalls = redis.calls.filter((c) => c.cmd === "eval").length;
  assert.equal(expireCalls, 5, "one eval per consume -- expiry is set inside the same atomic script, not a separate call");
});

test("limiter: peek reports usage without incrementing", async () => {
  const redis = new FakeRedis();
  const limiter = new RedisRateLimiter(redis, 2, 60_000);
  assert.equal((await limiter.peek("k")).remaining, 2);
  await limiter.consume("k");
  assert.equal((await limiter.peek("k")).remaining, 1);
  assert.equal((await limiter.peek("k")).remaining, 1, "peek does not consume");
});

test("limiter: independent keys and a shared client behave like independent buckets", async () => {
  const redis = new FakeRedis();
  const limiter = new RedisRateLimiter(redis, 1, 60_000);
  assert.equal((await limiter.consume("a")).allowed, true);
  assert.equal((await limiter.consume("b")).allowed, true);
  assert.equal((await limiter.consume("a")).allowed, false);
});
