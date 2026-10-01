# Production deployment

## Checklist

- [ ] **Signing secret**: `OORABLE_CAPTCHA_SECRET` set, 32+ bytes, different per environment, not in source control. `npx oorable-captcha doctor` checks this without printing the value.
- [ ] **Storage**: `RedisChallengeStore` if you run more than one server process (`docs/redis.md`). The in-memory store cannot coordinate across processes.
- [ ] **Redis integration actually verified**: run `packages/redis/test/integration.test.ts` against a real Redis server at least once before relying on it (see `docs/redis.md` -- it only ran against a fake client's calling contract in this repo's own build environment, for reasons explained there).
- [ ] **Real puzzle images**: run the asset pipeline (`docs/asset-management.md`) and configure `LocalPreprocessedAssetProvider` -- the default `SyntheticAssetProvider` is a placeholder, not meme content.
- [ ] **Site registry configured**: pass `sites: [...]` to `createApi` with real `siteKey`/`secretKey`/`allowedOrigins` per site. Without it, any (or no) site key is accepted -- fine for local development, not for production.
- [ ] **Behind a reverse proxy/WAF/CDN**: this software is not a substitute for network-level DDoS protection.
- [ ] **`trustProxyHops` set correctly** if behind a reverse proxy, matching the number of hops it adds to `X-Forwarded-For` -- otherwise client IPs (and rate limiting) are either spoofable or wrong.
- [ ] **Rate limits reviewed** against your real traffic volume -- the defaults in `docs/configuration.md` are a starting point, not a universal answer.
- [ ] **Metrics/admin routes**, if enabled, protected by a real secret (`metricsToken`/`adminToken`) and not exposed publicly.
- [ ] **CORS configured** (`cors: { allowedOrigins: [...] }`) if your web widget calls a different origin than your API.

## Horizontal scaling

Every server process needs: the same `OORABLE_CAPTCHA_SECRET` (and, during rotation, the same full key map), the same `RedisChallengeStore`/`RedisRateLimiter` pointed at the same Redis, and the same processed asset files (or a shared/replicated `assets/processed` directory, or an `AssetProvider` backed by shared storage such as S3). Nothing else needs to be shared -- there is no server-side session affinity requirement.

## Key rotation runbook

See `docs/security.md`'s "Key rotation" section for the sequence. The short version: add the new key alongside the old one and deploy, flip which key is active and deploy again, then remove the old key only after waiting at least as long as your longest token/tile TTL.

## Monitoring

`onEvent` (on both the engine and the API) gives you structured, secret-free events -- wire them into your logging/metrics pipeline. `GET /v1/metrics` (if you enable it with `metricsToken`) exposes request counts, challenge/verification/redemption outcome counts, rate-limit hits, and risk-engine decisions, in JSON or Prometheus text format.

## Capacity

`MemoryChallengeStore` and `MemoryRateLimiter` are hard-bounded (they refuse to grow past a configurable cap rather than exhausting memory) -- but that means "refuse new challenges," which is a real availability concern under sustained load on a single instance. If you're seeing `CapacityError`/`503`s, that's a signal to move to Redis and/or raise `maxEntries`/`maxKeys`, not to ignore.
