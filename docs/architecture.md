# Architecture

## Package map

```
packages/
  core/      @oorable/captcha           Engine: lifecycle, challenge types, tokens, providers. Zero runtime deps.
  server/    @oorable/captcha-server    Framework-agnostic REST API + a zero-dep node:http transport.
  client/    @oorable/captcha-client    Small fetch-based HTTP client (browser/Node/bots).
  web/       @oorable/captcha-web       The interactive widget (vanilla JS/DOM + shadow DOM styling).
  react/     @oorable/captcha-react     <OorableCaptcha> -- thin wrapper around captcha-web.
  express/   @oorable/captcha-express   mountOorableCaptcha(app, api) for Express.
  fastify/   @oorable/captcha-fastify   registerOorableCaptcha(app, api) for Fastify.
  redis/     @oorable/captcha-redis     RedisChallengeStore / RedisRateLimiter for multi-instance deployments.
  bot/       @oorable/captcha-bot       createBotChallenge/verifyBotAnswer + sharpToPng + framework examples.
  cli/       @oorable/captcha-cli       `oorable-captcha` (init/generate/verify/doctor).
```

Dependency direction is strictly one-way: `core` depends on nothing else in this repo; `server`, `client`, `bot`, `cli` depend only on `core`; `web` depends on `client`; `react` depends on `web`; `express`/`fastify`/`redis` depend on `server`/`core`. Nothing depends "up" the list.

## Why the core is zero-dependency

Every cryptographic primitive the engine needs -- secure randomness, HMAC-SHA-256, AES-256-GCM, constant-time comparison -- ships in Node's own `node:crypto`. The text-CAPTCHA renderer draws SVG by hand instead of shelling out to a native image library. This means:

- `@oorable/captcha` has **zero runtime dependencies**, so it has no supply-chain surface of its own and nothing to audit beyond this repo and Node itself.
- The engine can run in restricted/offline environments (this repo was built in exactly such an environment -- see `docs/limitations.md`).
- Anything that genuinely needs a native library (raster image conversion, real photo cropping) is pushed to the *edges* -- an optional peer dependency (`sharp`) used only where you opt in (`sharpToPng`, `scripts/process-assets.mjs`) -- rather than baked into the core.

## Provider-based design

The engine takes four collaborators, each swappable:

| Provider | Interface | Built-in implementations |
|---|---|---|
| Storage | `ChallengeStore` | `MemoryChallengeStore` (dev/single-instance), `RedisChallengeStore` (multi-instance) |
| Signing keys | `KeyProvider` | `StaticKeyProvider` (supports rotation via multiple key ids) |
| Puzzle images | `AssetProvider` | `SyntheticAssetProvider` (zero-dep placeholder art), `LocalPreprocessedAssetProvider` (real photos, pre-cropped offline) |
| Text rendering | `TextRendererProvider` | `SvgTextRenderer` (zero-dep); bring your own for raster output |

`OorableCaptchaEngine` (in `packages/core/src/engine.ts`) is the one object that wires these together. Everything downstream -- the REST API, the CLI, the bot helpers -- talks to the engine, never to a specific provider directly.

## Request flow

```
Client                    Your server                         Engine
------                    -----------                          ------
POST /v1/challenges  -->  CaptchaApi.handle()  ---------->  createChallenge()
                          (validate, rate-limit,               |  picks a challenge type,
                           resolve site, risk check)            |  builds public payload +
                                                                 |  server-only solution,
                     <--  { challengeId, challenge }  <---------|  stores the record

(user solves it in the widget)

POST /v1/challenges/verify --> CaptchaApi.handle() ------>  verifyChallenge()
                                                                 |  checks expiry/attempts/
                                                                 |  consumed, compares answer,
                     <-- { success, verificationToken } <-------|  atomically consumes once,
                                                                    signs a token

Your backend: POST /v1/tokens/verify (with your site secret) --> redeemToken()
                     <-- { valid: true, ... }  <-------------------  atomically redeems once
```

See `docs/rest-api.md` for the full endpoint reference and `docs/threat-model.md` for why each step is ordered the way it is.

## The web widget

`CaptchaWidget` (in `packages/web/src/widget.ts`) owns all DOM construction, renders into a **shadow root** (so host-page CSS cannot break it and its CSS cannot leak out), and talks to the server exclusively through `@oorable/captcha-client`. Theming is CSS custom properties on the shadow root's host, so a page can override colors without piercing the shadow boundary. `@oorable/captcha-react` does not reimplement any of this -- it mounts `CaptchaWidget` into a ref'd `<div>` and forwards props/callbacks, so all of the widget's tested behavior (accessibility, i18n, drag-and-drop, state machine) is shared rather than duplicated.

## Data classification

Three things must never leave the server: the correct answer to a challenge (`ChallengeRecord.solution`), the signing secret (`KeyProvider`), and the mapping from a puzzle tile's opaque token back to its real position (sealed inside the token itself via AES-GCM, never in a lookup table the server exposes). Everything else in a `ChallengeRecord` (id, type, timestamps, attempt count) is safe to log; the three items above never appear in a log line, error message, or HTTP response -- this is asserted directly in the test suites (`packages/core/test/security.test.ts`, `packages/server/test/api.test.ts`), not just claimed here.
