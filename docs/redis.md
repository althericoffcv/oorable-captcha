# Redis

`@oorable/captcha-redis` provides `RedisChallengeStore` and `RedisRateLimiter` for deployments running more than one server process. Neither bundles a Redis client -- bring your own (`ioredis` is the peer dependency this was written and tested against; anything satisfying the small `RedisLikeClient` interface works).

```ts
import Redis from "ioredis";
import { createEngine } from "@oorable/captcha";
import { RedisChallengeStore } from "@oorable/captcha-redis";

const redis = new Redis(process.env.REDIS_URL!);
const engine = createEngine({ store: new RedisChallengeStore(redis) });
```

```ts
import { RedisRateLimiter } from "@oorable/captcha-redis";

createApi({
  engine,
  limiterFactory: (_name, policy) => new RedisRateLimiter(redis, policy.limit, policy.windowMs),
});
```

## Why Lua scripts

Every store/limiter operation that needs to be atomic (`tryConsume`, `tryRedeem`, `incrementAttempts`, rate-limit `consume`) is one `EVAL` -- a single round trip Redis executes as one indivisible unit, so no other client's command can interleave between the read and the write. A naive application-level `GET` then `SET` has exactly the race this avoids.

## What's been verified, and how (read this before trusting it in production)

This package was built in a sandbox with **no network access and no Redis server available**, so:

- **The calling contract** -- right keys, right `SET`/`PX`/`KEEPTTL` options, right shape of `EVAL`'s return value -- is tested against a fake in-memory client (`packages/redis/test/store.test.ts`). This catches "the store calls the client wrong," not "the Lua is wrong."
- **The Lua scripts themselves** are exercised by `packages/redis/test/integration.test.ts` against a **real** `ioredis` client and a real Redis server, including concurrency tests (25 parallel `tryConsume` calls against one challenge, 20 parallel `incrementAttempts` calls, a real TTL expiring for real). This is the test that actually matters. It could not run in the build environment (no `ioredis`, no Redis server) -- it **detects that and skips itself with a clear message**, rather than silently passing or being left out. Run it yourself:

```bash
npm install ioredis        # in packages/redis
docker run -d -p 6379:6379 redis:7
node --experimental-strip-types --test packages/redis/test/*.test.ts
```

Do this before depending on this package in production. The Lua is standard, carefully reasoned, and follows well-known atomic patterns -- but "carefully reasoned" is not the same claim as "executed," and this project does not blur that line.

## Key prefixes

`RedisChallengeStore` defaults to `oorable:challenge:` and an additional `oorable:challenge:redeemed:` for redemption markers; `RedisRateLimiter` defaults to `oorable:ratelimit:`. Override via `keyPrefix` if you share a Redis instance with other applications.
