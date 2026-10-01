import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRateLimiter, CompositeRateLimiter } from "../src/security/rate-limiter.ts";

test("memory rate limiter allows up to the limit then blocks", async () => {
  const limiter = new MemoryRateLimiter(3, 60_000);
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await limiter.consume("ip:1"));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false, false]);
  assert.deepEqual(results.map((r) => r.remaining), [2, 1, 0, 0, 0]);
});

test("memory rate limiter tracks separate keys independently", async () => {
  const limiter = new MemoryRateLimiter(1, 60_000);
  assert.equal((await limiter.consume("ip:a")).allowed, true);
  assert.equal((await limiter.consume("ip:b")).allowed, true);
  assert.equal((await limiter.consume("ip:a")).allowed, false);
});

test("memory rate limiter cannot be bypassed by concurrent bursts", async () => {
  const limiter = new MemoryRateLimiter(5, 60_000);
  const results = await Promise.all(Array.from({ length: 50 }, () => limiter.consume("ip:burst")));
  assert.equal(results.filter((r) => r.allowed).length, 5);
});

test("memory rate limiter window resets after it elapses", async () => {
  const limiter = new MemoryRateLimiter(1, 30);
  assert.equal((await limiter.consume("k")).allowed, true);
  assert.equal((await limiter.consume("k")).allowed, false);
  await new Promise((r) => setTimeout(r, 45));
  assert.equal((await limiter.consume("k")).allowed, true);
});

test("composite limiter reports the limiter that tripped", async () => {
  const composite = new CompositeRateLimiter({
    ip: new MemoryRateLimiter(100, 60_000),
    session: new MemoryRateLimiter(1, 60_000),
  });
  await composite.consume({ ip: "1.2.3.4", session: "s1" });
  const second = await composite.consume({ ip: "1.2.3.4", session: "s1" });
  assert.equal(second.allowed, false);
  assert.equal(second.limitedBy, "session");
});

test("composite limiter skips dimensions with no key", async () => {
  const composite = new CompositeRateLimiter({
    ip: new MemoryRateLimiter(1, 60_000),
    session: new MemoryRateLimiter(1, 60_000),
  });
  assert.equal((await composite.consume({ ip: "9.9.9.9" })).allowed, true);
  assert.equal((await composite.consume({ ip: "9.9.9.9" })).allowed, false);
});
