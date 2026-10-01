import type { ChallengeRecord } from "./types.ts";

export interface ChallengeStore {
  create(record: ChallengeRecord): Promise<void>;
  get(id: string): Promise<ChallengeRecord | undefined>;
  /**
   * Atomically increments the attempt counter and returns the record
   * *after* incrementing, or undefined if no such challenge exists.
   * Implementations MUST perform the read-increment-write as a single
   * atomic operation (see MemoryChallengeStore and
   * @oorable/captcha-redis for two different but equally atomic
   * strategies).
   */
  incrementAttempts(id: string): Promise<ChallengeRecord | undefined>;
  /**
   * Atomically marks a challenge as consumed, but only if it was not
   * already consumed. Returns true iff this call performed the
   * consumption (i.e. "won the race"). This is what makes challenges
   * one-time-use even under concurrent verification requests --
   * replaying a solved challenge's answer must never mint a second
   * token.
   */
  tryConsume(id: string): Promise<boolean>;
  /**
   * Atomically records that the verification token issued for this
   * challenge has been redeemed, but only if it has not been already.
   * Returns true iff this call was the first redemption. `ttlMs` should
   * cover the token's remaining lifetime; after that the marker may be
   * discarded because the token itself can no longer verify.
   *
   * A signed token is only a statement that a challenge was solved --
   * on its own it can be replayed to many form submissions until it
   * expires. Redemption is what makes it single-use.
   */
  tryRedeem(id: string, ttlMs: number): Promise<boolean>;
  delete(id: string): Promise<void>;
}
