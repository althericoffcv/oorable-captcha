import { test } from "node:test";
import { secretOf } from "./helpers.ts";
import assert from "node:assert/strict";
import { MemoryChallengeStore } from "../src/challenge/memory-store.ts";
import type { ChallengeStore } from "../src/challenge/store.ts";
import type { ChallengeRecord } from "../src/challenge/types.ts";
import { StaticKeyProvider } from "../src/crypto/token.ts";
import { OorableCaptchaEngine } from "../src/engine.ts";
import {
  createChallengeRecord,
  verifyChallengeRecord,
  type LifecycleConfig,
} from "../src/challenge/lifecycle.ts";

/**
 * Behaves like an out-of-process store (Redis, SQL, ...): every read returns a
 * private copy (so callers can't accidentally share mutable state), and each
 * operation has real async latency so concurrent requests genuinely interleave.
 * The in-memory store hides races because it returns live shared objects; this
 * wrapper removes that accident.
 */
class RemoteLikeStore implements ChallengeStore {
  private readonly inner = new MemoryChallengeStore();
  private tick(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }
  async create(record: ChallengeRecord): Promise<void> {
    await this.tick();
    await this.inner.create(structuredClone(record));
  }
  async get(id: string): Promise<ChallengeRecord | undefined> {
    await this.tick();
    const record = await this.inner.get(id);
    return record ? structuredClone(record) : undefined;
  }
  async incrementAttempts(id: string): Promise<ChallengeRecord | undefined> {
    await this.tick();
    const record = await this.inner.incrementAttempts(id);
    return record ? structuredClone(record) : undefined;
  }
  async tryConsume(id: string): Promise<boolean> {
    await this.tick();
    return this.inner.tryConsume(id);
  }
  async tryRedeem(id: string, ttlMs: number): Promise<boolean> {
    await this.tick();
    return this.inner.tryRedeem(id, ttlMs);
  }
  async delete(id: string): Promise<void> {
    await this.tick();
    await this.inner.delete(id);
  }
  close(): void {
    this.inner.close();
  }
}

function makeConfig(store: ChallengeStore, maxAttempts: number): LifecycleConfig {
  return {
    store,
    keys: new StaticKeyProvider({ k1: secretOf("race-test-secret") }, "k1"),
    defaultTtlMs: 60_000,
    defaultMaxAttempts: maxAttempts,
    verificationTokenTtlMs: 60_000,
  };
}

async function newChallenge(config: LifecycleConfig) {
  return createChallengeRecord(
    { type: "text" },
    { solution: { code: "RIGHT1" }, publicPayload: {}, checkAnswer: () => true },
    config,
  );
}

test("race: the attempt limit holds under parallel guessing on an out-of-process store", async () => {
  const store = new RemoteLikeStore();
  const config = makeConfig(store, 3);
  const record = await newChallenge(config);

  let evaluations = 0;
  const countingCheck = (_type: string, answer: unknown, solution: unknown) => {
    evaluations++;
    return answer === (solution as { code: string }).code;
  };

  // An attacker fires 40 distinct guesses at once instead of one at a time.
  await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      verifyChallengeRecord({ challengeId: record.id, answer: `GUESS${i}` }, countingCheck, config),
    ),
  );

  assert.ok(evaluations <= 3, `only 3 guesses may ever be evaluated, but ${evaluations} were`);
  store.close();
});

test("race: even the correct answer is refused once parallel guesses have used up the attempts", async () => {
  const store = new RemoteLikeStore();
  const config = makeConfig(store, 3);
  const record = await newChallenge(config);
  const check = (_type: string, answer: unknown, solution: unknown) => answer === (solution as { code: string }).code;

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      verifyChallengeRecord({ challengeId: record.id, answer: `WRONG${i}` }, check, config),
    ),
  );
  const late = await verifyChallengeRecord({ challengeId: record.id, answer: "RIGHT1" }, check, config);
  assert.equal(late.success, false);
  if (!late.success) assert.equal(late.reason, "too_many_attempts");
  store.close();
});

test("race: one-time use holds on an out-of-process store under parallel correct submissions", async () => {
  const store = new RemoteLikeStore();
  const config = makeConfig(store, 50);
  const record = await newChallenge(config);
  const check = (_type: string, answer: unknown, solution: unknown) => answer === (solution as { code: string }).code;

  const results = await Promise.all(
    Array.from({ length: 25 }, () => verifyChallengeRecord({ challengeId: record.id, answer: "RIGHT1" }, check, config)),
  );
  assert.equal(results.filter((r) => r.success).length, 1);
  store.close();
});

test("race: token redemption is single-use on an out-of-process store under parallel requests", async () => {
  const store = new RemoteLikeStore();
  const engine = new OorableCaptchaEngine({ store, keys: new StaticKeyProvider({ k1: secretOf("race-redeem") }, "k1") });
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 2 });
  const { solution } = (await store.get(created.challengeId))!;
  const solved = await engine.verifyChallenge({
    challengeId: created.challengeId,
    answer: (solution as { correctOrder: string[] }).correctOrder,
  });
  assert.ok(solved.success);
  if (!solved.success) return;

  const results = await Promise.all(Array.from({ length: 30 }, () => engine.redeemToken(solved.verificationToken)));
  assert.equal(results.filter((r) => r.valid).length, 1);
  store.close();
});

test("race: parallel refreshes of the same challenge always retire the original", async () => {
  const store = new RemoteLikeStore();
  const engine = new OorableCaptchaEngine({ store, keys: new StaticKeyProvider({ k1: secretOf("race-refresh") }, "k1") });
  const created = await engine.createChallenge({ type: "meme-puzzle", grid: 2 });
  const results = await Promise.all(Array.from({ length: 10 }, () => engine.refreshChallenge({ challengeId: created.challengeId })));
  assert.equal(await store.get(created.challengeId), undefined, "the original is retired no matter how the refreshes interleave");
  assert.ok(results.some((r) => r !== undefined), "at least one refresh succeeded");
  store.close();
});
