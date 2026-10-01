# OORABLE CAPTCHA

**Human Verification System**

A universal CAPTCHA and human-verification engine for bots (WhatsApp, Telegram, Discord), websites, mobile apps, and backend APIs. Its signature feature is the **Meme Puzzle CAPTCHA** — an interactive sliding-tile puzzle built from real images — alongside standard text and image-selection challenges.

The core engine is security-first and runs entirely server-side. Client SDKs (web widget, bot helpers) never decide whether an answer is correct; they only render a challenge and forward whatever the user submits.

This is a completely separate product from XOORA — no shared name, branding, domain, or architecture.

> **Honest framing, on purpose:** nothing here is claimed to be "unbeatable" or "AI-proof." This README says plainly what it does and does not protect against, and recommends pairing it with rate limiting, risk scoring, and your own edge/WAF.

## Table of contents

- [Features](#features)
- [Supported platforms](#supported-platforms)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [REST API reference](#rest-api-reference)
- [Configuration reference](#configuration-reference)
- [Security model](#security-model)
- [Threat model](#threat-model)
- [Storage](#storage)
- [Redis (multi-instance deployments)](#redis-multi-instance-deployments)
- [Web integration](#web-integration)
- [Bot integration](#bot-integration)
- [Mobile / native app integration](#mobile--native-app-integration)
- [Asset management (meme-puzzle images)](#asset-management-meme-puzzle-images)
- [Localization](#localization)
- [Custom challenge types](#custom-challenge-types)
- [CLI](#cli)
- [Testing](#testing)
- [Production deployment checklist](#production-deployment-checklist)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Meme Puzzle CAPTCHA** — 2x2 to 6x6 sliding tile puzzle, click/tap or full keyboard control, optional drag-and-drop, cryptographically shuffled, opaque per-challenge tile tokens (see [Threat model](#threat-model)).
- **Text CAPTCHA** — numeric (5–8 digits) or alphanumeric codes, rendered as a distorted SVG image with zero runtime dependencies; locale-aware digit rendering (Arabic-Indic, Persian, Bengali, Devanagari, ...).
- **Image CAPTCHA** — "select the matching images," server-defined answer key, your own image catalogue.
- **Provider-based** — bring your own storage (memory or Redis included), asset source, and text renderer.
- **Signed, single-use verification tokens** (HMAC-SHA-256, key rotation support) and **stateless, encrypted puzzle-tile tokens** (AES-256-GCM) that reveal nothing about tile position.
- Rate limiting, a transparent risk-scoring hook, and a REST API designed to be called from any language.

## Supported platforms

| Surface | Package | Status |
|---|---|---|
| Core engine | `@oorable/captcha` | Implemented, tested (98 tests), **zero runtime dependencies** |
| REST API (framework-agnostic + `node:http`) | `@oorable/captcha-server` | Implemented, tested (54 tests incl. real sockets) |
| HTTP client (browser/Node/bots) | `@oorable/captcha-client` | Implemented, tested (8 tests) |
| Web widget (vanilla JS) | `@oorable/captcha-web` | Implemented, tested in real Chromium (15 tests) |
| React | `@oorable/captcha-react` | Implemented, tested with real React 19 in Chromium (3 tests) |
| Express | `@oorable/captcha-express` | Implemented, tested (8 tests) |
| Fastify | `@oorable/captcha-fastify` | Implemented, tested (7 tests) |
| Redis (multi-instance deployments) | `@oorable/captcha-redis` | Implemented; contract-tested against a fake client, plus a real `ioredis` integration suite that runs when Redis is available |
| Bots (WhatsApp/Telegram/Discord) | `@oorable/captcha-bot` + `examples/` | Implemented, tested (7 tests) |
| CLI | `@oorable/captcha-cli` (`oorable-captcha`) | Implemented, tested as real subprocesses (15 tests) |
| Mobile (Kotlin, Swift, Java, Dart/Flutter, React Native, ...) | REST only — see [REST API reference](#rest-api-reference) | No native SDKs; documented REST usage |

Native SDKs exist only where listed above. Every other language talks to the REST API directly.

---

## Installation

```bash
npm install @oorable/captcha
npm install @oorable/captcha-server @oorable/captcha-express   # or -fastify
npm install @oorable/captcha-web        # browser widget
npm install @oorable/captcha-react react react-dom   # React wrapper
npm install @oorable/captcha-bot        # bot helper
npm install @oorable/captcha-redis ioredis   # production, multi-instance
npm install --save-dev @oorable/captcha-cli
npx oorable-captcha init                # generates a signing secret into .env
```

### Developing this monorepo itself

```bash
git clone <this-repo>
cd oorable-captcha
npm install
```

Requires **Node.js 22.6+** for native TypeScript execution (`node --experimental-strip-types`) during development — published packages only need Node 18+ at runtime once built. Package sources use `.ts` extensions in their own relative imports (e.g. `import { foo } from "./bar.ts"`) specifically so they can run directly under Node's native TypeScript support without a build step; `tsconfig.base.json`'s `rewriteRelativeImportExtensions` rewrites those to `.js` automatically when you run `tsc`, which is the correct extension for the published ESM output.

Run a package's tests directly (no build step needed):

```bash
node --experimental-strip-types --test packages/core/test/*.test.ts
```

Some packages have peer dependencies not installed automatically (`express`, `fastify`, `ioredis`, `react`, `sharp`) — install the ones relevant to what you're working on.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `OORABLE_CAPTCHA_SECRET` | Yes, unless you pass `keys` explicitly to `createEngine()` | HMAC/AES signing secret, 32+ bytes |
| `REDIS_URL` | Only for `packages/redis`'s integration tests | Defaults to `redis://127.0.0.1:6379` |

### Verifying your setup

```bash
npx oorable-captcha doctor
```

Checks your Node version, whether the signing secret is set and long enough (never prints its value), and whether optional peer packages for adapters you might use (`express`, `fastify`, `ioredis`, `sharp`, `react`) are resolvable.

---

## Quick start

### Server (Express)

```ts
import express from "express";
import { createEngine } from "@oorable/captcha";
import { createApi } from "@oorable/captcha-server";
import { mountOorableCaptcha } from "@oorable/captcha-express";

const engine = createEngine(); // reads OORABLE_CAPTCHA_SECRET
const api = createApi({ engine, sites: [{ siteKey: "pk_live_..." }] });

const app = express();
app.use(express.json({ limit: "16kb" }));
mountOorableCaptcha(app, api);
app.listen(3000);
```

### Server (Fastify)

```ts
import Fastify from "fastify";
import { createEngine } from "@oorable/captcha";
import { createApi } from "@oorable/captcha-server";
import { registerOorableCaptcha } from "@oorable/captcha-fastify";

const engine = createEngine();
const api = createApi({ engine, sites: [{ siteKey: "pk_live_..." }] });

const app = Fastify();
registerOorableCaptcha(app, api);
app.listen({ port: 3000 });
```

### Server (plain `node:http`, zero framework)

```ts
import { createEngine } from "@oorable/captcha";
import { createApi, startServer } from "@oorable/captcha-server";

const engine = createEngine();
const api = createApi({ engine });
const server = await startServer(api, { port: 3000 });
console.log(`listening at ${server.url}`);
```

### Web

```html
<div id="oorable-captcha"></div>
<script src="https://your-cdn/oorable-captcha.min.js"></script>
<script>
  OorableCaptcha.render("#oorable-captcha", {
    siteKey: "pk_live_...",
    type: "meme-puzzle",
  });
</script>
```

### React

```tsx
import { OorableCaptcha } from "@oorable/captcha-react";

<OorableCaptcha siteKey="pk_live_..." type="meme-puzzle" onSuccess={(token) => submitToken(token)} />;
```

### Bot (any framework)

```ts
import { createEngine } from "@oorable/captcha";
import { createBotChallenge, verifyBotAnswer, sharpToPng } from "@oorable/captcha-bot";

const engine = createEngine();
const challenge = await createBotChallenge(engine, { type: "text", length: 6, toRaster: sharpToPng });
// challenge.image.data is a PNG Buffer, ready to attach to a message

const result = await verifyBotAnswer(engine, { challengeId: challenge.challengeId, answer: replyText });
```

### Core API directly

```ts
import { createCaptcha, verifyCaptcha } from "@oorable/captcha";

const challenge = await createCaptcha({ type: "meme-puzzle", difficulty: "medium" });
const result = await verifyCaptcha({ challengeId: challenge.challengeId, answer /* from the user */ });
```

---

## Architecture

### Package map

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

Dependency direction is strictly one-way: `core` depends on nothing else in this repo; `server`, `client`, `bot`, `cli` depend only on `core`; `web` depends on `client`; `react` depends on `web`; `express`/`fastify`/`redis` depend on `server`/`core`.

### Why the core is zero-dependency

Every cryptographic primitive the engine needs — secure randomness, HMAC-SHA-256, AES-256-GCM, constant-time comparison — ships in Node's own `node:crypto`. The text-CAPTCHA renderer draws SVG by hand instead of shelling out to a native image library. This means `@oorable/captcha` has no supply-chain surface of its own, can run in restricted/offline environments, and pushes anything that genuinely needs a native library (raster image conversion, real photo cropping) to the edges as an *optional* peer dependency (`sharp`) used only where you opt in.

### Provider-based design

| Provider | Interface | Built-in implementations |
|---|---|---|
| Storage | `ChallengeStore` | `MemoryChallengeStore` (dev/single-instance), `RedisChallengeStore` (multi-instance) |
| Signing keys | `KeyProvider` | `StaticKeyProvider` (supports rotation via multiple key ids) |
| Puzzle images | `AssetProvider` | `SyntheticAssetProvider` (zero-dep placeholder art), `LocalPreprocessedAssetProvider` (real photos, pre-cropped offline) |
| Text rendering | `TextRendererProvider` | `SvgTextRenderer` (zero-dep); bring your own for raster output |

`OorableCaptchaEngine` is the one object that wires these together. The REST API, the CLI, and the bot helpers all talk to the engine, never to a specific provider directly.

### Request flow

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

### The web widget

`CaptchaWidget` owns all DOM construction, renders into a **shadow root** (so host-page CSS cannot break it and its CSS cannot leak out), and talks to the server exclusively through `@oorable/captcha-client`. `@oorable/captcha-react` does not reimplement any of this — it mounts `CaptchaWidget` into a ref'd `<div>` and forwards props/callbacks, so all of the widget's tested behavior (accessibility, i18n, drag-and-drop, state machine) is shared rather than duplicated.

### Data classification

Three things must never leave the server: the correct answer to a challenge, the signing secret, and the mapping from a puzzle tile's opaque token back to its real position (sealed inside the token itself via AES-GCM). Everything else in a challenge record (id, type, timestamps, attempt count) is safe to log. This is asserted directly in the test suites, not just claimed.

---

## REST API reference

Base path: `/v1`. All request/response bodies are JSON unless noted. Every response includes `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

### `GET /v1/health`

```json
{ "status": "ok", "version": "v1" }
```

### `POST /v1/challenges`

Request:

```json
{ "type": "meme-puzzle", "locale": "en-US", "difficulty": "medium", "siteKey": "public-site-key", "sessionId": "opaque-session-id" }
```

`type` is one of `"meme-puzzle"`, `"text"`, `"image"` (only offered if the server configured an image catalogue). `difficulty`, `locale`, `siteKey`, `sessionId` are optional. **`difficulty` is a floor a client may raise, never lower** — a site's configured minimum (default `"medium"`) always applies. There is no way to request a specific grid size, code length, or image candidates directly — those are controlled server-side.

Response (`201`):

```json
{
  "challengeId": "opaque-id",
  "type": "meme-puzzle",
  "expiresIn": 120,
  "challenge": { "grid": 3, "tiles": [{ "token": "...", "assetUrl": "/v1/assets/tile/..." }] }
}
```

Shape of `challenge` depends on `type`:
- `meme-puzzle`: `{ grid, tiles: [{ token, assetUrl }] }` — `tiles[i]` is the tile currently shown at slot `i`.
- `text`: `{ image: { contentType, data }, mode, length }` — `data` is base64.
- `image`: `{ options: [{ id, imageUrl }], select, prompt? }`.

Errors: `400 invalid_request` / `unsupported_type`, `403 invalid_site` / `origin_not_allowed`, `429 rate_limited` (with `Retry-After`), `413`/`415`/`408` for oversized/wrong-content-type/slow bodies.

### `POST /v1/challenges/verify`

Request: `{ "challengeId": "opaque-id", "answer": {}, "siteKey": "public-site-key" }`

`answer` shape depends on the challenge type: an array of tile tokens (meme-puzzle, one per slot in the arrangement the user currently has), a string (text), or an array of selected ids (image).

Response (`200`, always — a wrong answer is not an HTTP error):

```json
{ "success": true, "verificationToken": "opaque-server-issued-token", "expiresIn": 120 }
```
or
```json
{ "success": false, "reason": "incorrect" }
```

`reason` is `"incorrect"`, `"expired"`, `"too_many_attempts"`, or the catch-all `"invalid"` (used for unknown/already-used/wrong-site challenges, deliberately collapsed so the API can't be used to probe whether a challenge id exists or was already solved).

### `POST /v1/challenges/refresh`

Request: `{ "challengeId": "opaque-id", "siteKey": "public-site-key" }`. Replaces an unsolved challenge with a fresh equivalent one and discards the old one. Response: same shape as create (`201`), or `404 invalid` if unknown/already solved/expired.

### `POST /v1/tokens/verify`

**Server-to-server.** Redeems a verification token exactly once. If you configured `sites` with a `secretKey`, this requires `Authorization: Bearer <secretKey>` — never call this from a browser or app.

Request: `{ "token": "v1...", "siteKey": "...", "sessionId": "..." }`

Response: `{ "valid": true, "challengeId": "...", "type": "text", "siteKey": "...", "sessionId": "...", "issuedAt": ..., "expiresAt": ... }` or `{ "valid": false, "reason": "already_redeemed" }` (also: `invalid_token`, `expired`, `site_key_mismatch`, `session_mismatch`). `401 unauthorized` for a missing/wrong secret key.

### `GET /v1/assets/tile/:token`

Returns raw image bytes for a meme-puzzle tile. `:token` is the opaque, encrypted, single-challenge token from `challenge.tiles[i].token`. `404` for any unknown/expired/forged token.

### `GET /v1/metrics` (optional)

Only exists if you configured `metricsToken`. Requires `Authorization: Bearer <metricsToken>`. JSON by default, or Prometheus text with `Accept: text/plain` or `?format=prometheus`.

### `GET /v1/admin/assets` (optional)

Only exists if you configured `adminToken`. Returns `{ count, images: [{ id, label }] }` — ids and labels only, never solutions or challenge state. No write endpoint exists; assets are added through the offline pipeline.

### Language examples

<details>
<summary>JavaScript / TypeScript, Python, PHP, Go, Java, Kotlin, Swift, Dart/Flutter, React Native, C#</summary>

**JavaScript/TypeScript**
```ts
const res = await fetch("https://captcha.example.com/v1/challenges", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "text", siteKey: "pk_live_..." }),
});
const { challengeId, challenge } = await res.json();
```

**Python**
```python
import requests
r = requests.post("https://captcha.example.com/v1/challenges",
                   json={"type": "text", "siteKey": "pk_live_..."})
challenge_id = r.json()["challengeId"]
```

**PHP**
```php
$ch = curl_init("https://captcha.example.com/v1/challenges");
curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Content-Type: application/json"],
    CURLOPT_POSTFIELDS => json_encode(["type" => "text", "siteKey" => "pk_live_..."]),
]);
$data = json_decode(curl_exec($ch), true);
```

**Go**
```go
body, _ := json.Marshal(map[string]string{"type": "text", "siteKey": "pk_live_..."})
resp, err := http.Post("https://captcha.example.com/v1/challenges", "application/json", bytes.NewReader(body))
```

**Java**
```java
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://captcha.example.com/v1/challenges"))
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString("{\"type\":\"text\",\"siteKey\":\"pk_live_...\"}"))
    .build();
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
```

**Kotlin (Android)**
```kotlin
val body = """{"type":"text","siteKey":"pk_live_..."}""".toRequestBody("application/json".toMediaType())
val request = Request.Builder().url("https://captcha.example.com/v1/challenges").post(body).build()
OkHttpClient().newCall(request).execute().use { it.body?.string() }
```

**Swift (iOS)**
```swift
var request = URLRequest(url: URL(string: "https://captcha.example.com/v1/challenges")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONSerialization.data(withJSONObject: ["type": "text", "siteKey": "pk_live_..."])
let (data, _) = try await URLSession.shared.data(for: request)
```

**Dart / Flutter**
```dart
final res = await http.post(
  Uri.parse("https://captcha.example.com/v1/challenges"),
  headers: {"Content-Type": "application/json"},
  body: jsonEncode({"type": "text", "siteKey": "pk_live_..."}),
);
final challengeId = jsonDecode(res.body)["challengeId"];
```

**React Native** — same as the JavaScript example (`fetch` is built in), or use `@oorable/captcha-client` directly.

**C#**
```csharp
using var client = new HttpClient();
var content = new StringContent(
    JsonSerializer.Serialize(new { type = "text", siteKey = "pk_live_..." }),
    Encoding.UTF8, "application/json");
var response = await client.PostAsync("https://captcha.example.com/v1/challenges", content);
```
</details>

---

## Configuration reference

### `createEngine(options)` / `new OorableCaptchaEngine(options)`

| Option | Default | Notes |
|---|---|---|
| `store` | `new MemoryChallengeStore()` | Use `RedisChallengeStore` for multi-instance deployments |
| `keys` | `StaticKeyProvider` reading `OORABLE_CAPTCHA_SECRET` | Throws `ConfigurationError` if unset |
| `assetProvider` | `new SyntheticAssetProvider()` | Swap in `LocalPreprocessedAssetProvider` for real photos |
| `textRenderer` | `new SvgTextRenderer()` | Zero-dependency; bring your own for raster output |
| `defaultTtlMs` | `120000` (2 min) | How long a freshly issued challenge stays valid |
| `defaultMaxAttempts` | `5` | Wrong answers allowed before a challenge locks out |
| `verificationTokenTtlMs` | `120000` (2 min) | How long an issued verification token stays valid |
| `tileBaseUrl` | `"/v1/assets/tile"` | URL prefix for puzzle tile URLs |
| `onEvent` | none | Receives `{ name, challengeId, type, success? }` — non-secret metadata only |

### `createApi(options)` (in `@oorable/captcha-server`)

| Option | Default | Notes |
|---|---|---|
| `engine` | required | An `OorableCaptchaEngine` |
| `sites` | none | `{ siteKey, secretKey?, allowedOrigins?, allowedTypes?, difficulty?, text? }[]`. Omit for local dev only |
| `imageCandidates` | none | `(site) => ImageCandidate[] \| { prompt?, candidates }` — required for `type: "image"` |
| `rateLimit` | see below | `false` disables entirely (tests only) |
| `limiterFactory` | in-memory | Wire in `RedisRateLimiter` here for multi-instance deployments |
| `onLimiterError` | `"closed"` | `"open"` to fail open instead of 503 if a limiter errors |
| `risk` | none | `{ thresholds: { challenge, block }, blockSeconds }` |
| `cors` | none (same-origin only) | `{ allowedOrigins: string[] \| "*" }` |
| `exposeDetailedReasons` | `false` | Development aid — exposes specific verify failure reasons |
| `metricsToken` / `adminToken` | none | Enables the corresponding route, protected by that bearer token |
| `onEvent` | none | `{ name: "request", method, route, status, durationMs } \| { name: "error", route, errorName }` |

### Default rate limits

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

### `startServer(api, options)` (in `@oorable/captcha-server`)

| Option | Default | Notes |
|---|---|---|
| `maxBodyBytes` | `16384` (16 KiB) | Requests over this rejected with `413` before fully buffering |
| `bodyTimeoutMs` | `5000` | A client trickling its body this slowly is cut off with `408` (slowloris protection) |
| `trustProxyHops` | `0` | How many reverse proxies you operate in front of this server |

---

## Security model

### Verification token format

```
v1.<keyId>.<base64url(payload)>.<base64url(hmac-sha256(payload))>
```

`payload` is JSON: `{ challengeId, type, siteKey?, sessionId?, iat, exp, nonce, purpose }`. Never contains a solution or submitted answer.

- **Algorithm**: HMAC-SHA-256 (`node:crypto`).
- **Comparison**: `timingSafeEqual` on the signature bytes — constant-time.
- **Purpose string**: defends against cross-purpose token confusion.
- **Expiry**: inside the signed payload, can't be extended by tampering.
- **Size limit**: tokens over 2048 bytes rejected before any parsing/HMAC work.

### Puzzle-tile tokens

```
t1.<keyId>.<base64url(iv[12] || ciphertext || gcm-tag[16])>
```

Plaintext: `{ imageId, grid, row, col, exp }`, encrypted with AES-256-GCM. Key derived from the signing secret via HKDF-SHA-256 with a distinct label, so it's never the same bytes as the HMAC key.

- **Unreadable without the key** — no row/column/image-id leak from the token string.
- **Unforgeable** — GCM tag authenticated against the key id.
- **Stateless** — any server instance holding the key can resolve a token.
- **Self-expiring** — `exp` is inside the authenticated plaintext.

### Key rotation

```ts
new StaticKeyProvider({ k1: oldSecret, k2: newSecret }, "k2");
```

New tokens are always signed with the active key; retired keys still verify. Sequence: (1) add the new key alongside the old one, deploy; (2) flip the active key id, deploy again; (3) remove the old key only after waiting at least your longest TTL. Never skip straight to removal.

**Requirements** (enforced at construction, `ConfigurationError` if violated, never echoes the secret): key ids match `^[A-Za-z0-9_-]{1,32}$`; secrets must be at least 32 bytes. Generate one with `npx oorable-captcha init`.

### Rate limiting

`MemoryRateLimiter` (fixed-window, single process) and `RedisRateLimiter` (same contract, INCR+PEXPIRE, safe across instances). IPv4 clients are limited per address; IPv6 clients per **/64** (a single subscriber is commonly handed an entire /64 — per-address limiting would let one machine rotate through 2^64 addresses). `X-Forwarded-For` is ignored unless you explicitly declare how many reverse proxies you operate (`trustProxyHops`).

### What never appears in a response, log line, or error message

The correct answer to any challenge, the signing secret, the submitted answer on a failed verification, and (by default) which specific reason a verification failed — collapsed to a generic `"invalid"` so the API can't be used as an oracle for "does this challenge id exist."

---

## Threat model

### Assets protected

1. The correct answer to a challenge.
2. The signing secret.
3. Verification tokens (must not be forgeable, reusable, or transferable across sites/sessions).
4. Puzzle-tile tokens (must not reveal position, must not be forgeable into fetching arbitrary files).
5. Server capacity (creating/verifying challenges must not exhaust memory, CPU, or storage).

### Adversaries considered

| Adversary | What stops them |
|---|---|
| Scripted bot reading raw HTML/JSON | Answer never in the response; wrong-answer errors never reveal the right one; replays fail |
| Brute-force bot | `maxAttempts` per challenge, atomic and race-proof, plus IP/site/session rate limits |
| Bot rotating IPs/challenges | Per-site/session limits; risk-scoring hook can escalate difficulty or block |
| Token tampering in transit | HMAC-SHA-256 / AES-256-GCM, constant-time verified — any bit flip invalidates it |
| Token replay | Atomic "exactly one winner" consume/redeem, tested under real concurrency |
| Asset endpoint probing | Tile tokens are authenticated ciphertext; non-decrypting tokens are simply rejected |
| Challenge-creation flooding | Grid/code length clamped server-side; body-size ceiling; bounded in-memory store/limiter |
| Paid human-solving service | **Not mitigated by software.** Cost/friction problem, not a puzzle-design problem |
| Capable ML vision model | **Only partially mitigated** — see Non-goals |

### Non-goals (read before you deploy)

- **Does not prove human identity.** Raises the cost of automating an action; a motivated attacker with human labor or a good-enough model can pass any individual challenge.
- **Does not stop paid CAPTCHA-solving services.** No puzzle distinguishes "a human solving it themselves" from "a human solving it for money." Needs account-level signals instead.
- **Makes no claim of resistance to state-of-the-art ML vision models** for any challenge type. The meme-puzzle's tile tokens prevent a metadata-only attack, but tile pixels are still visible to anything that can look at an image. Rotate your image pool.
- **Does not stop distributed abuse alone.** Per-IP limiting is necessary, not sufficient, against a large residential proxy pool.
- **The risk engine is a heuristic**, not a verdict — never present its score to end users as a judgment about them.

---

## Storage

```ts
interface ChallengeStore {
  create(record): Promise<void>;
  get(id): Promise<ChallengeRecord | undefined>;
  incrementAttempts(id): Promise<ChallengeRecord | undefined>; // atomic
  tryConsume(id): Promise<boolean>;                             // atomic, one-shot
  tryRedeem(id, ttlMs): Promise<boolean>;                        // atomic, one-shot
  delete(id): Promise<void>;
}
```

**`MemoryChallengeStore`** — single-process, atomicity free from Node's single-threaded execution. Bounded by a periodic sweep plus a hard `maxEntries` cap (default 50,000). Good for dev/tests/single instance; **not** for multiple processes — it can't coordinate across them.

**`RedisChallengeStore`** — every operation is a single atomic Lua script, so the same guarantees hold across as many processes as you run.

---

## Redis (multi-instance deployments)

```ts
import Redis from "ioredis";
import { createEngine } from "@oorable/captcha";
import { RedisChallengeStore } from "@oorable/captcha-redis";

const redis = new Redis(process.env.REDIS_URL!);
const engine = createEngine({ store: new RedisChallengeStore(redis) });
```

```ts
import { RedisRateLimiter } from "@oorable/captcha-redis";
createApi({ engine, limiterFactory: (_name, policy) => new RedisRateLimiter(redis, policy.limit, policy.windowMs) });
```

Every atomic operation (`tryConsume`, `tryRedeem`, `incrementAttempts`, rate-limit `consume`) is one `EVAL` — a single round trip Redis executes indivisibly.

**What's verified, and how:** the calling contract (right keys, right options, right return shapes) is tested against a fake client. The actual Lua scripts are covered by a separate `ioredis` integration suite with real concurrency tests (25 parallel `tryConsume` calls, 20 parallel `incrementAttempts`, real TTL expiry) — it **skips itself with a clear message** if no real Redis/`ioredis` is available, rather than passing silently. Run it yourself before trusting this in production:

```bash
npm install ioredis
docker run -d -p 6379:6379 redis:7
node --experimental-strip-types --test packages/redis/test/*.test.ts
```

---

## Web integration

```html
<div id="oorable-captcha"></div>
<script src="https://your-cdn/oorable-captcha.min.js"></script>
<script>
  const handle = OorableCaptcha.render("#oorable-captcha", {
    siteKey: "pk_live_...",
    type: "meme-puzzle",
    apiBaseUrl: "https://captcha.example.com",
    theme: "auto",
    locale: "id-ID",
    onSuccess: (token) => {},
    onError: (err) => console.warn(err.code, err.message),
  });
  // handle.reset(), handle.destroy(), handle.getToken()
</script>
```

If the mount element lives inside a `<form>`, a hidden `<input name="oorable-captcha-token">` is created/kept in sync automatically — submit normally and your backend gets the token as a regular field.

### React

```tsx
import { OorableCaptcha, type OorableCaptchaRef } from "@oorable/captcha-react";
import { useRef } from "react";

const captchaRef = useRef<OorableCaptchaRef>(null);
<OorableCaptcha ref={captchaRef} siteKey="pk_live_..." type="meme-puzzle" onSuccess={(t) => setFieldValue("captchaToken", t)} />;
```

A thin wrapper — remounts only when a prop that changes *what* challenge to show changes; inline callback identity changes don't trigger a remount.

### Accessibility (verified in real Chromium via Playwright, not just asserted)

Full keyboard control (roving tabindex, arrow keys, Enter/Space to swap, Escape to cancel), `aria-live` announcements, optional drag-and-drop (`dragAndDrop: false` to disable — tap/keyboard always work), visible focus rings, `forced-colors` support, `prefers-reduced-motion` respected, 44px+ touch targets down to 320px viewports, no interaction depends on `:hover`.

### Theming

```css
#oorable-captcha {
  --oorable-bg: #fafaf7; --oorable-ink: #1b1f3b; --oorable-accent: #ff6f59;
  --oorable-primary-bg: #1b1f3b; --oorable-primary-ink: #ffffff;
  --oorable-success: #157347; --oorable-danger: #b42318; --oorable-focus: #2b4eff;
}
```

---

## Bot integration

```ts
import { createEngine } from "@oorable/captcha";
import { createBotChallenge, verifyBotAnswer, sharpToPng } from "@oorable/captcha-bot";

const engine = createEngine();
const challenge = await createBotChallenge(engine, { type: "text", mode: "numeric", length: 6, toRaster: sharpToPng });
const result = await verifyBotAnswer(engine, { challengeId: challenge.challengeId, answer: replyText });
```

Not tied to any specific bot framework — `examples/whatsapp-example.ts` (Baileys), `examples/telegram-example.ts` (`node-telegram-bot-api`), and `examples/discord-example.ts` (discord.js) show complete wiring patterns; none of those libraries are dependencies of this repo.

**Raster images**: most bot platforms need PNG/JPEG, not SVG. `sharpToPng` (optional peer dep on `sharp`) converts the generated SVG for real — not imported at the top of the package, so a web-only consumer never needs the native binding.

**Which type fits a bot**: text is the natural fit (one image, one typed reply). Image-selection also works (numbered candidates, reply with numbers). Meme-puzzle doesn't reduce to one image — `bot.raw` exposes the tile list if you want to build something creative, but composing it is up to you.

---

## Mobile / native app integration

No native SDKs — REST only. Flow: (1) `POST /v1/challenges`, (2) render natively (decode the base64 SVG for text; fetch each `tiles[i].assetUrl` and lay out a grid for meme-puzzle, implementing tap-to-swap yourself; render a selectable grid for image), (3) `POST /v1/challenges/verify` with the answer in the shapes described above, (4) on success, send `verificationToken` to your own backend, which redeems it once via `POST /v1/tokens/verify` server-to-server — **never embed the site secret key in a mobile app**.

Pass a `sessionId` when creating a challenge to bind the resulting token to your app's session, so it can't be redeemed from a different session.

---

## Asset management (meme-puzzle images)

### The two providers

- **`SyntheticAssetProvider`** (default) — zero-dependency, procedurally draws each puzzle image as overlapping circles seeded from the image id, serving each tile as an SVG crop so adjacent tiles genuinely line up. Lets the full lifecycle run with no network and no native image library. **Not** a replacement for real photos.
- **`LocalPreprocessedAssetProvider`** (production) — serves tiles cropped **offline**, ahead of time, so the engine never decodes/crops on the request path.

```ts
import { createEngine, LocalPreprocessedAssetProvider } from "@oorable/captcha";

const engine = createEngine({
  assetProvider: new LocalPreprocessedAssetProvider({
    processedDir: "./assets/processed",
    images: [{ id: "meme-1" }, { id: "meme-2" }, { id: "meme-3" }, { id: "meme-4" }],
  }),
});
```

### Turning images into real tiles

Edit `assets/manifest.json` with your own image URLs (or drop files straight into `assets/source/<id>.jpg`), then:

```bash
npm run assets:setup     # downloads manifest.json's URLs into assets/source/
npm run assets:process   # requires `sharp`: npm install --save-dev sharp
```

Slices each source image into 2x2, 3x3, and 4x4 tile sets under `assets/processed/<imageId>/<grid>/r<row>c<col>.jpg`. This pipeline has been verified end-to-end against a synthetic stand-in image (real `sharp`, correct output dimensions at every grid size) — see [Limitations](#limitations) for why the *original* supplied URLs specifically couldn't be fetched in this build environment.

### Choosing images

Prefer roughly square, visually busy photos — a piece from a mostly-empty sky is much harder for a *human* to place correctly. Rotate your pool periodically (see Threat model). **Make sure you have the rights** to use, and let end users see, any image you configure.

### Writing your own `AssetProvider`

Implement `listSourceImages()`, `pickSourceImage()`, and `getTile(location)`. Providers are deliberately stateless — the engine, not the provider, mints the opaque per-challenge tile tokens.

---

## Localization

Bundled widget UI strings: English, Indonesian, Spanish, French, German, Portuguese. Pick via `locale`, override individual strings with `messages`. RTL languages get `dir="rtl"` automatically; no RTL strings are bundled yet.

Numeric text-CAPTCHA codes are drawn in the locale's native digit system where ICU supports it (Arabic-Indic, Persian, Bengali, Devanagari, Burmese, ...) — the stored answer is always ASCII, and the check accepts the reply in *any* supported digit script, not just the one drawn:

```ts
await engine.createChallenge({ type: "text", mode: "numeric", locale: "ar-EG" });
// image shows ٠١٢٣٤٥٦٧٨٩-style digits; "012345" and "٠١٢٣٤٥" both verify
```

**Not implemented**: general complex text shaping (Arabic/Hebrew joining, Indic conjuncts, Thai line-breaking) — digit localization only, not full alphabetic shaping.

---

## Custom challenge types

```ts
interface ChallengeDefinition {
  solution: unknown;       // server-only, never sent to the client or logged
  publicPayload: unknown;  // safe to send to the client
  checkAnswer(answer: unknown, solution: unknown): boolean; // must not throw on malformed input
}
```

The three built-in types are ordinary consumers of this same interface. Example:

```ts
export async function buildMathChallenge(): Promise<ChallengeDefinition> {
  const a = Math.floor(Math.random() * 10), b = Math.floor(Math.random() * 10);
  return {
    solution: { answer: a + b },
    publicPayload: { question: `${a} + ${b} = ?` },
    checkAnswer: (answer, solution) => Number(answer) === (solution as { answer: number }).answer,
  };
}
```

Rules to keep the same security properties: never throw from `checkAnswer` on malformed input (return `false`); never put anything answer-derived in `publicPayload`; use `node:crypto` for anything that determines the answer or its ordering; keep `solution` JSON-serializable.

---

## CLI

```bash
npx oorable-captcha init       # generate a signing secret into .env (never prints it unless --show)
npx oorable-captcha generate   # create a sample challenge, print its public payload
npx oorable-captcha verify     # check an answer against a challenge generate created
npx oorable-captcha doctor     # check your environment for common setup problems
```

`generate`/`verify` use a local, file-backed dev store scoped to your project directory — for local smoke-testing only, not for talking to a remote/production API.

---

## Testing

```bash
node --experimental-strip-types --test packages/<name>/test/*.test.ts
```

Every package's tests run directly against TypeScript sources via Node's native type-stripping — no build step required. **226 tests total, 225 passing, 1 honest skip** (Redis integration, which needs real infrastructure not always available) — run against real `node:crypto`, a real Chromium browser (Playwright), real TCP sockets, real subprocesses, and real React 19, not mocked out except where a specific named piece of infrastructure was genuinely unavailable (disclosed in each case, never hidden).

| Package | Tests | How |
|---|---|---|
| `core` | 98 | Token sign/verify/tamper/rotation, full lifecycle (replay, concurrent-request races, attempt limits, expiry, site binding), meme-puzzle shuffling + tile-token sealing, text rendering + locale digits, rate limiting, risk scoring, path-traversal/SSRF/capacity hardening |
| `server` | 54 | 35 against `CaptchaApi.handle()` directly; 6 IP-parsing edge cases; 13 over real TCP sockets (slowloris, oversized/chunked bodies, malformed JSON, prototype pollution, spoofed `X-Forwarded-For`, 30 concurrent verifications) |
| `client` | 8 | Request shaping, error/timeout handling, URL scheme restrictions, one real round trip |
| `web` | 15 | Real Chromium: tap-to-swap, full keyboard, mouse drag-and-drop, wrong-answer/attempts-exhausted flows, theming, reduced-motion, 320px viewport, hostile URL rejection |
| `react` | 3 | Real React 19 + real Chromium: mount → solve → `onSuccess`, clean unmount, prop-driven remount vs. callback-identity no-op |
| `express` / `fastify` | 8 / 7 | Real adapter code (depends on the framework only for types) against a faithful fake app/router |
| `redis` | 10 + 1 skip | Fake-client contract tests, plus a real `ioredis` suite that skips with a message if infrastructure is absent |
| `bot` | 7 | Real engine wiring + real SVG→PNG conversion via actual `sharp` |
| `cli` | 15 | Real subprocesses, including a full `generate`→`verify` round trip across two separate process invocations |

---

## Production deployment checklist

- [ ] Signing secret 32+ bytes, different per environment, not in source control (`npx oorable-captcha doctor`).
- [ ] `RedisChallengeStore` if running more than one server process.
- [ ] Redis integration tests actually run against a real server at least once before relying on it.
- [ ] Real puzzle images processed via the asset pipeline — the default is a placeholder.
- [ ] `sites` configured with real `siteKey`/`secretKey`/`allowedOrigins` per site.
- [ ] Behind a reverse proxy/WAF/CDN.
- [ ] `trustProxyHops` set correctly if behind a reverse proxy.
- [ ] CORS configured if your widget calls a different origin than your API.
- [ ] Rate limits reviewed against real traffic volume.
- [ ] Metrics/admin routes, if enabled, protected by a real secret.

Every server process needs the same signing secret (and key map during rotation), the same Redis instance, and the same processed asset files. Nothing else needs to be shared.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ConfigurationError: No signing key configured` | `npx oorable-captcha init`, or pass `keys` explicitly |
| Every challenge fails with `reason: "invalid"` immediately | Check `siteKey` matches; check clock skew |
| `429 rate_limited` in development | Pass a looser `rateLimit`, or `rateLimit: false` for local dev only |
| Puzzle looks like abstract colored circles | You haven't run the asset pipeline yet — this is the intentional placeholder |
| `sharpToPng()` throws "needs sharp" | `npm install sharp` |
| Redis integration tests "skipped" | Expected without `ioredis` + a reachable Redis server |

---

## Limitations

Read this before deploying — overclaiming security is worse than not claiming it.

**Not implemented**: audio accessibility challenge (documented as a future extension, not a placeholder); math/slider/custom challenge *types* (the extension point exists, concrete types don't); general complex text shaping beyond digit localization; native mobile SDKs; bundled RTL UI translations; admin asset management beyond read-only listing; invasive risk signals (deliberately, per the original brief's request for restraint).

**Built, but with a disclosed verification gap**: this repository was built in a sandbox with no network access. The four originally-supplied meme-puzzle image URLs couldn't be fetched (confirmed no network path exists); the processing *pipeline* was verified against a synthetic stand-in instead. Redis's Lua scripts are contract-tested against a fake client; a real `ioredis` integration suite is included and will run for real once you have Redis. `express`/`fastify` aren't installed in that build environment, so their adapters (written to depend on those frameworks only for types) are tested against a faithful fake app/router rather than the real framework. `@types/react` wasn't installable either; a narrow compile-time-only shim was used for type-checking only — verified to not affect what a real consumer's own installed React types resolve to. No independent third-party security audit has been performed.

**Residual risk regardless**: a small, static, publicly reused image pool is crackable by simple hashing over time — rotate it. No CAPTCHA distinguishes a human from a human paid to solve it. No claim is made about resistance to a sufficiently capable ML vision model for any challenge type here.

---

## FAQ

**Is this unbeatable / AI-proof?** No, and it deliberately never claims that.

**Why circles instead of a meme?** Default placeholder provider until you run the asset pipeline with real photos.

**Do I need Redis?** Only for more than one server process.

**Can a client request an easier puzzle or shorter code?** No — only harder than your configured floor, never easier.

**Could a client read the puzzle answer out of the response?** No — tiles are opaque encrypted tokens with no position-encoding field. The residual risk is image content itself being visible, same as to a human.

**Can I use my own storage backend?** Yes — implement the small `ChallengeStore` interface.

**Does this work with my bot framework?** Yes — `@oorable/captcha-bot` isn't tied to any specific one.

**Is the CLI safe against a production server?** `generate`/`verify` are local dev-only tools. `init`/`doctor` are safe anywhere.

**What Node version do I need?** 18+ to run; 22.6+ to develop this monorepo.

**Where do I report a security vulnerability?** See `SECURITY.md` — not as a public issue.

---

## Contributing

Fork, branch, add tests for your change. `npm run typecheck --workspaces --if-present` and the relevant package's tests must pass. Security-relevant changes (token handling, challenge lifecycle, asset resolution) should describe their security implications in the PR. See `CONTRIBUTING.md`.

## License

MIT — see `LICENSE`.
