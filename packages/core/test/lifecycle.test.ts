import { test } from "node:test";
import { secretOf } from "./helpers.ts";
import assert from "node:assert/strict";
import { MemoryChallengeStore } from "../src/challenge/memory-store.ts";
import { StaticKeyProvider, verifyToken } from "../src/crypto/token.ts";
import {
  createChallengeRecord,
  verifyChallengeRecord,
  type LifecycleConfig,
} from "../src/challenge/lifecycle.ts";

function makeConfig(overrides: Partial<LifecycleConfig> = {}): LifecycleConfig {
  return {
    store: new MemoryChallengeStore(),
    keys: new StaticKeyProvider({ k1: secretOf("test-secret") }, "k1"),
    defaultTtlMs: 60_000,
    defaultMaxAttempts: 3,
    verificationTokenTtlMs: 60_000,
    ...overrides,
  };
}

const codeEquals = (_type: string, answer: unknown, solution: unknown) =>
  answer === (solution as { code: string }).code;

async function makeTextChallenge(config: LifecycleConfig, code = "ABC123") {
  return createChallengeRecord(
    { type: "text" },
    { solution: { code }, publicPayload: {}, checkAnswer: () => true },
    config,
  );
}

test("correct answer issues a verification token that verifies", async () => {
  const config = makeConfig();
  const record = await makeTextChallenge(config);
  const result = await verifyChallengeRecord({ challengeId: record.id, answer: "ABC123" }, codeEquals, config);
  assert.equal(result.success, true);
  if (result.success) {
    const checked = verifyToken(result.verificationToken, config.keys);
    assert.equal(checked.valid, true);
    if (checked.valid) assert.equal(checked.payload.challengeId, record.id);
  }
});

test("a challenge cannot be verified twice, even with the right answer both times (replay)", async () => {
  const config = makeConfig();
  const record = await makeTextChallenge(config);

  const first = await verifyChallengeRecord({ challengeId: record.id, answer: "ABC123" }, codeEquals, config);
  const second = await verifyChallengeRecord({ challengeId: record.id, answer: "ABC123" }, codeEquals, config);

  assert.equal(first.success, true);
  assert.equal(second.success, false);
  if (!second.success) assert.equal(second.reason, "already_used");
});

test("concurrent verification of the same challenge has exactly one winner", async () => {
  const config = makeConfig();
  const record = await makeTextChallenge(config);

  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      verifyChallengeRecord({ challengeId: record.id, answer: "ABC123" }, codeEquals, config),
    ),
  );

  const winners = results.filter((r) => r.success);
  assert.equal(winners.length, 1, "exactly one concurrent request may receive a token");
});

test("wrong answers count against the attempt limit and never reveal the solution", async () => {
  const config = makeConfig({ defaultMaxAttempts: 2 });
  const record = await makeTextChallenge(config, "SECRET1");

  const r1 = await verifyChallengeRecord({ challengeId: record.id, answer: "WRONG-A" }, codeEquals, config);
  assert.equal(r1.success, false);
  if (!r1.success) {
    assert.equal(r1.reason, "incorrect");
    const serialized = JSON.stringify(r1);
    assert.ok(!serialized.includes("SECRET1"), "the solution must never appear in a result");
    assert.ok(!serialized.includes("WRONG-A"), "the submitted answer must not be echoed back");
  }

  const r2 = await verifyChallengeRecord({ challengeId: record.id, answer: "WRONG-B" }, codeEquals, config);
  assert.equal(r2.success, false);

  // Attempts exhausted: even the *correct* answer is now refused.
  const r3 = await verifyChallengeRecord({ challengeId: record.id, answer: "SECRET1" }, codeEquals, config);
  assert.equal(r3.success, false);
  if (!r3.success) assert.equal(r3.reason, "too_many_attempts");
});

test("expired challenges are rejected even with the right answer", async () => {
  const config = makeConfig({ defaultTtlMs: -1000 }); // already expired at creation
  const record = await makeTextChallenge(config);
  const result = await verifyChallengeRecord({ challengeId: record.id, answer: "ABC123" }, codeEquals, config);
  assert.equal(result.success, false);
  // The store treats expired records as absent, so either reason is acceptable
  // as long as no token is issued.
  if (!result.success) assert.ok(result.reason === "expired" || result.reason === "not_found");
});

test("unknown challenge id fails as not_found", async () => {
  const config = makeConfig();
  const result = await verifyChallengeRecord(
    { challengeId: "does-not-exist", answer: "x" },
    codeEquals,
    config,
  );
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.reason, "not_found");
});

test("siteKey binding: a challenge issued for one site cannot be verified for another", async () => {
  const config = makeConfig();
  const record = await createChallengeRecord(
    { type: "text", siteKey: "site-a" },
    { solution: { code: "ABC123" }, publicPayload: {}, checkAnswer: () => true },
    config,
  );
  const wrong = await verifyChallengeRecord(
    { challengeId: record.id, answer: "ABC123", siteKey: "site-b" },
    codeEquals,
    config,
  );
  assert.equal(wrong.success, false);

  const right = await verifyChallengeRecord(
    { challengeId: record.id, answer: "ABC123", siteKey: "site-a" },
    codeEquals,
    config,
  );
  assert.equal(right.success, true);
});

test("challenge ids are unique and unpredictable-looking (no sequential pattern)", async () => {
  const config = makeConfig();
  const ids = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const record = await makeTextChallenge(config);
    assert.match(record.id, /^[A-Za-z0-9_-]{24}$/); // 18 random bytes => 24 base64url chars
    ids.add(record.id);
  }
  assert.equal(ids.size, 200, "no collisions across 200 generated ids");
});
