# Storage

The engine talks to storage only through the `ChallengeStore` interface (`packages/core/src/challenge/store.ts`):

```ts
interface ChallengeStore {
  create(record: ChallengeRecord): Promise<void>;
  get(id: string): Promise<ChallengeRecord | undefined>;
  incrementAttempts(id: string): Promise<ChallengeRecord | undefined>; // atomic
  tryConsume(id: string): Promise<boolean>;                            // atomic, one-shot
  tryRedeem(id: string, ttlMs: number): Promise<boolean>;               // atomic, one-shot
  delete(id: string): Promise<void>;
}
```

`incrementAttempts`, `tryConsume`, and `tryRedeem` **must** be atomic -- they are what make attempt limits and one-time-use hold up under concurrent requests. See `docs/threat-model.md` for exactly why the ordering matters.

## `MemoryChallengeStore`

Single-process, in-memory. Atomicity comes for free from Node's single-threaded execution (no `await` between a check and its matching write). Bounded two ways: a periodic sweep removes expired entries, and a hard `maxEntries` cap (default 50,000) makes `create`/`tryRedeem` throw `CapacityError` rather than growing without limit once full and unsweepable.

Good for: development, tests, a single server process. **Not good for**: anything running more than one process/instance -- it cannot coordinate across them, so a load-balanced deployment on this store could let a challenge be solved once *per instance* instead of once total.

## `RedisChallengeStore` (`@oorable/captcha-redis`)

Every operation is a single atomic Lua script (`EVAL`), so the same "exactly once" guarantees hold across as many server processes as you run. See `docs/redis.md` for setup and exactly what's been verified where.

## Writing your own store

Implement the interface above against whatever you already run (Postgres, DynamoDB, ...). The one property to preserve carefully: `tryConsume`/`tryRedeem` must be a single atomic "check-and-set," not a separate read followed by a separate write -- a naive `GET` then `SET` from application code has exactly the same race a concurrent-request test in this repo (`packages/core/test/races.test.ts`) was written to catch.
