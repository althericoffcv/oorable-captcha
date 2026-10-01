import { secureRandomId } from "../crypto/random.ts";
import { signToken, type KeyProvider } from "../crypto/token.ts";
import type { ChallengeRecord, ChallengeType, VerifyResult } from "./types.ts";
import type { ChallengeStore } from "./store.ts";

export interface ChallengeDefinition {
  /** Server-only solution data, compared against the submitted answer. Never sent to the client. */
  solution: unknown;
  /** Data safe to send to the client so it can render the challenge. */
  publicPayload: unknown;
  /**
   * Type-specific comparator. Implementations must not throw on
   * malformed input -- return false instead, so a malformed answer
   * behaves like a wrong answer rather than a 500 error.
   */
  checkAnswer(answer: unknown, solution: unknown): boolean;
}

export interface LifecycleConfig {
  store: ChallengeStore;
  keys: KeyProvider;
  /** How long a freshly issued challenge stays valid, in ms. */
  defaultTtlMs: number;
  /** How many wrong answers are allowed before the challenge is locked out. */
  defaultMaxAttempts: number;
  /** How long an issued verification token stays valid, in ms. */
  verificationTokenTtlMs: number;
  /** Optional observability hook. Receives non-secret metadata only -- never the solution or the submitted answer. */
  onEvent?: (event: LifecycleEvent) => void;
}

export type LifecycleEvent =
  | { name: "challenge_created"; challengeId: string; type: ChallengeType }
  | { name: "challenge_verified"; challengeId: string; type: ChallengeType; success: boolean };

export interface CreateChallengeInput {
  type: ChallengeType;
  siteKey?: string;
  sessionId?: string;
  ttlMs?: number;
  maxAttempts?: number;
  params?: Record<string, unknown>;
}

export async function createChallengeRecord(
  input: CreateChallengeInput,
  definition: ChallengeDefinition,
  config: LifecycleConfig,
): Promise<ChallengeRecord> {
  const now = Date.now();
  const record: ChallengeRecord = {
    id: secureRandomId(18),
    type: input.type,
    version: 1,
    issuedAt: now,
    expiresAt: now + (input.ttlMs ?? config.defaultTtlMs),
    attempts: 0,
    maxAttempts: input.maxAttempts ?? config.defaultMaxAttempts,
    consumed: false,
    siteKey: input.siteKey,
    sessionId: input.sessionId,
    params: input.params,
    solution: definition.solution,
    publicPayload: definition.publicPayload,
  };
  await config.store.create(record);
  config.onEvent?.({ name: "challenge_created", challengeId: record.id, type: record.type });
  return record;
}

export interface VerifyChallengeInput {
  challengeId: string;
  answer: unknown;
  siteKey?: string;
}

/**
 * Verifies a submitted answer against a stored challenge and, on
 * success, issues a one-time verification token.
 *
 * Ordering matters here for correctness, not just style:
 *  1. look up the record (not_found short-circuits everything else)
 *  2. reject stale/used/expired/exhausted challenges *before* touching
 *     the answer, so a client can't "retry" past those checks
 *  3. increment the attempt counter atomically and gate on the value
 *     the store returns. The pre-check in step 2 is only a cheap fast
 *     path: it runs on a copy read *before* the increment, so N
 *     parallel requests can all pass it. Only the counter returned by
 *     the atomic increment is safe to enforce the limit with -- it
 *     guarantees at most `maxAttempts` answers are ever evaluated, no
 *     matter how requests interleave. The increment happens even for
 *     a *correct* answer, so attempts and successes are not
 *     distinguishable from counters alone
 *  4. only after all of the above, compare the answer
 *  5. tryConsume() atomically -- if two requests both pass step 4 for
 *     the same challenge (e.g. a replayed correct answer), only one
 *     of them will win the consume and receive a token
 */
export async function verifyChallengeRecord(
  input: VerifyChallengeInput,
  checkAnswer: (type: ChallengeType, answer: unknown, solution: unknown) => boolean,
  config: LifecycleConfig,
): Promise<VerifyResult> {
  const record = await config.store.get(input.challengeId);

  if (!record) {
    return { success: false, reason: "not_found" };
  }
  if (record.siteKey && input.siteKey !== record.siteKey) {
    return { success: false, reason: "site_key_mismatch" };
  }
  if (record.consumed) {
    return { success: false, reason: "already_used" };
  }
  if (Date.now() > record.expiresAt) {
    return { success: false, reason: "expired" };
  }
  if (record.attempts >= record.maxAttempts) {
    return { success: false, reason: "too_many_attempts" };
  }

  const afterIncrement = await config.store.incrementAttempts(record.id);
  if (!afterIncrement) {
    return { success: false, reason: "not_found" };
  }
  if (afterIncrement.attempts > afterIncrement.maxAttempts) {
    return { success: false, reason: "too_many_attempts" };
  }

  const isCorrect = checkAnswer(record.type, input.answer, record.solution);

  if (!isCorrect) {
    config.onEvent?.({
      name: "challenge_verified",
      challengeId: record.id,
      type: record.type,
      success: false,
    });
    return { success: false, reason: "incorrect" };
  }

  const won = await config.store.tryConsume(record.id);
  if (!won) {
    // Someone else (a concurrent request replaying the same answer)
    // consumed it first. Only one caller may ever receive a token.
    return { success: false, reason: "already_used" };
  }

  const now = Date.now();
  const verificationToken = signToken(
    {
      challengeId: record.id,
      type: record.type,
      siteKey: record.siteKey,
      sessionId: record.sessionId,
      iat: now,
      exp: now + config.verificationTokenTtlMs,
    },
    config.keys,
  );

  config.onEvent?.({
    name: "challenge_verified",
    challengeId: record.id,
    type: record.type,
    success: true,
  });

  return {
    success: true,
    verificationToken,
    expiresIn: Math.round(config.verificationTokenTtlMs / 1000),
  };
}
