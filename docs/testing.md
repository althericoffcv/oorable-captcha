# Testing

## Running tests

Every package's tests run directly against its TypeScript sources via Node's native type-stripping -- no build step required to run tests:

```bash
node --experimental-strip-types --test packages/<name>/test/*.test.ts
```

## What's covered, and how

| Package | Tests | How |
|---|---|---|
| `core` | 98 | `node:test` against real `node:crypto` -- no mocks. Covers token sign/verify/tamper/rotation, the full challenge lifecycle (replay, concurrent-request races, attempt limits, expiry, site binding), meme-puzzle shuffling and tile-token sealing/opening, text-CAPTCHA rendering and locale digit handling, rate limiting, risk scoring, path-traversal/SSRF/oversized-input/capacity hardening. |
| `server` | 54 | 35 against `CaptchaApi.handle()` directly (validation, sites/origins, rate limits, risk escalation, refresh, CORS, metrics, admin routes, log hygiene); 6 against IP-parsing edge cases (IPv6 /64 bucketing, X-Forwarded-For trust); 13 over **real TCP sockets** via `node:http` (slowloris timeout, oversized/chunked bodies, malformed JSON, prototype-pollution attempts, spoofed `X-Forwarded-For`, 30 concurrent verifications of one answer). |
| `client` | 8 | Request shaping (fake `fetch`), error/timeout handling, URL scheme restrictions, plus one full round-trip against a real running server. |
| `web` | 15 | **Real Chromium via Playwright**: tap-to-swap, full keyboard operation, mouse drag-and-drop, wrong-answer/attempts-exhausted flows, text and image challenge types, a broken candidate photo disabling only that one tile (a real bug this test suite caught -- see `CHANGELOG.md`), theming, `prefers-reduced-motion`, 320px viewport, `destroy()`, hostile URL scheme rejection. |
| `react` | 3 | **Real React 19** bundled with esbuild and run in real Chromium: mount → solve → `onSuccess` → hidden field, clean unmount, prop-driven remount vs. inline-callback-identity-change no-op. |
| `express` | 8 | Real execution of the actual adapter code (it depends on `express` only for types, erased at compile time) against a faithful fake app/router object, since `express` itself isn't installed in this build environment. |
| `fastify` | 7 | Same approach as `express`, for the same reason. |
| `redis` | 10 + 1 skip | 10 against a fake client (calling-contract only); a separate `ioredis`-based suite that runs for real against an actual Redis server when available, and explicitly **skips with a message** (not a silent pass) otherwise -- see `docs/redis.md`. |
| `bot` | 7 | Real engine wiring, and a real SVG→PNG conversion via the actual `sharp` library (checked by magic bytes and decoded dimensions, not just "didn't throw"). |
| `cli` | 15 | Real subprocesses (`node dist/cli.js ...`) -- not in-process function calls -- including a full `generate` → `verify` round trip across two separate process invocations, and confirming two different project directories never share dev state (a real bug this test suite caught -- see `CHANGELOG.md`). |

Total: **226 tests**, all passing, run against real cryptography, a real browser, real sockets, real subprocesses, and (where available) a real Redis server -- not mocked out except where a specific, named piece of infrastructure (a real Express/Fastify install, a real Redis server) was genuinely unavailable in the environment this was built in, which is disclosed in each case rather than hidden.

## Tests that need infrastructure you might not have

- **`packages/redis/test/integration.test.ts`**: needs `ioredis` installed and a reachable Redis (`REDIS_URL`, default `redis://127.0.0.1:6379`). Skips itself with an explanatory message otherwise.
- **`packages/web/test/browser.test.ts`**, **`packages/react/test/react.test.ts`**: need `playwright` with Chromium (`npx playwright install chromium`).

Neither of these is faked to "pass anyway" -- if the infrastructure is genuinely missing, the test run reports a skip, visibly.

## Writing new tests

Match the existing style: prefer asserting an actual security *property* (e.g., "the serialized response never contains the solution string," "N concurrent requests yield exactly 1 success") over asserting a specific implementation detail that would make refactoring painful without a security reason. See `packages/core/test/security.test.ts` and `packages/core/test/races.test.ts` for the clearest examples of this style, including the `RemoteLikeStore` wrapper in `races.test.ts` that forces genuine interleaving (an in-memory store's synchronous methods can hide races that a real out-of-process store would expose -- see that file's comment for why).
