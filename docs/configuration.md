# Configuration reference

## `createEngine(options)` / `new OorableCaptchaEngine(options)`

| Option | Default | Notes |
|---|---|---|
| `store` | `new MemoryChallengeStore()` | Use `RedisChallengeStore` for multi-instance deployments -- see `docs/storage.md`. |
| `keys` | `StaticKeyProvider` reading `OORABLE_CAPTCHA_SECRET` | Throws `ConfigurationError` at construction if unset. |
| `assetProvider` | `new SyntheticAssetProvider()` | Swap in `LocalPreprocessedAssetProvider` for real photos -- see `docs/asset-management.md`. |
| `textRenderer` | `new SvgTextRenderer()` | Zero-dependency. Bring your own for raster output. |
| `defaultTtlMs` | `120000` (2 min) | How long a freshly issued challenge stays valid. |
| `defaultMaxAttempts` | `5` | Wrong answers allowed before a challenge locks out. |
| `verificationTokenTtlMs` | `120000` (2 min) | How long an issued verification token stays valid before redemption. |
| `tileBaseUrl` | `"/v1/assets/tile"` | URL prefix used when building puzzle tile URLs. |
| `onEvent` | none | Receives `{ name: "challenge_created" \| "challenge_verified", challengeId, type, success? }` -- non-secret metadata only. |

These are reasonable starting defaults, not a claim that they're the only correct values -- tune them to your own risk tolerance (`DEFAULTS` is exported from `@oorable/captcha` if you want to build on top of them rather than guessing your own).

## `createApi(options)` (in `@oorable/captcha-server`)

| Option | Default | Notes |
|---|---|---|
| `engine` | required | An `OorableCaptchaEngine`. |
| `sites` | none | Array of `{ siteKey, secretKey?, allowedOrigins?, allowedTypes?, difficulty?, text? }`. Omit entirely for local development (any/no site key accepted) -- `doctor` and the docs both flag this as unsuitable for production. |
| `imageCandidates` | none | `(site) => ImageCandidate[] | { prompt?, candidates }`. Required to offer `type: "image"` at all. |
| `rateLimit` | see below | Pass `false` to disable entirely (tests only). |
| `limiterFactory` | in-memory | `(name, policy) => RateLimiter` -- wire in `RedisRateLimiter` here for multi-instance deployments. |
| `onLimiterError` | `"closed"` | `"open"` to fail open (allow requests) instead of closed (503) if a limiter itself errors (e.g. Redis outage). |
| `risk` | none | `{ thresholds: { challenge, block }, blockSeconds }` -- opt-in risk escalation, see `docs/security.md`. |
| `cors` | none (same-origin only) | `{ allowedOrigins: string[] | "*" }`. |
| `exposeDetailedReasons` | `false` | Development aid -- see `docs/security.md`'s note on collapsed reasons. |
| `metricsToken` / `adminToken` | none | Set either to enable the corresponding route, protected by that bearer token. |
| `onEvent` | none | `{ name: "request", method, route, status, durationMs } \| { name: "error", route, errorName }` -- route is the path *template* (`/v1/assets/tile/:token`), never containing a real token/id. |

### Default rate limits (`DEFAULT_RATE_LIMITS`)

| Limiter | Limit | Window |
|---|---|---|
| `createPerIp` | 30 | 1 min |
| `createPerSite` | 3000 | 1 min |
| `createPerSession` | 20 | 1 min |
| `verifyPerIp` | 60 | 1 min |
| `verifyPerSite` | 6000 | 1 min |
| `failedVerifyPerIp` | 20 | 5 min |
| `replayPerIp` | 10 | 5 min |
| `tilePerIp` | 600 | 1 min |
| `redeemPerSite` | 6000 | 1 min |

Override any subset: `createApi({ engine, rateLimit: { createPerIp: { limit: 10, windowMs: 60_000 } } })`.

## `createNodeHandler(api, options)` / `startServer(api, options)` (in `@oorable/captcha-server`)

| Option | Default | Notes |
|---|---|---|
| `maxBodyBytes` | `16384` (16 KiB) | Requests over this are rejected with `413` before being fully buffered. |
| `bodyTimeoutMs` | `5000` | A client trickling its body this slowly is cut off with `408` (slowloris protection). |
| `trustProxyHops` | `0` | How many reverse proxies you operate in front of this server; see `docs/security.md`'s `X-Forwarded-For` note. |

## Environment variables

See `docs/installation.md`.
