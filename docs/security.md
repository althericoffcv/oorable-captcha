# Security

See [threat-model.md](threat-model.md) for *why* these choices were made and what they don't cover. This document is the *how*.

## Verification token format

```
v1.<keyId>.<base64url(payload)>.<base64url(hmac-sha256(payload))>
```

`payload` is JSON: `{ challengeId, type, siteKey?, sessionId?, iat, exp, nonce, purpose: "oorable-captcha-verification" }`. It never contains a challenge's solution or the submitted answer.

- **Algorithm**: HMAC-SHA-256 (`node:crypto`, `createHmac`).
- **Comparison**: `timingSafeEqual` on the signature bytes. Lengths are compared first with a plain `!==` -- this is safe because signature length is fixed by the algorithm (already public), so only the *content* comparison of equal-length buffers needs to run in constant time.
- **Purpose string**: defends against a token minted for one purpose being accepted somewhere else, if this token format is ever reused for something new.
- **Expiry**: inside the signed payload (`exp`), so it can't be extended by an attacker who can only tamper with, not forge, the token.
- **Size limit**: tokens over 2048 bytes are rejected before any parsing/HMAC work, so a client can't use an oversized token to force wasted CPU.

## Puzzle-tile tokens

```
t1.<keyId>.<base64url(iv[12] || ciphertext || gcm-tag[16])>
```

The plaintext is `{ imageId, grid, row, col, exp }`, encrypted with AES-256-GCM. The key is derived from the same signing secret via HKDF-SHA-256 with a distinct `info` label (`oorable-captcha/tile-token/v1`), so it is never the same bytes as the HMAC key. Properties:

- **Unreadable without the key**: a scraper sees only opaque ciphertext -- no row/column/image-id leak from the token string itself.
- **Unforgeable**: the GCM tag is authenticated against the key id (as AAD), so a client cannot mint a token that resolves to an arbitrary file.
- **Stateless**: any server instance holding the key can resolve a token -- no shared registry to keep in sync or that could grow without bound.
- **Self-expiring**: `exp` is inside the authenticated plaintext, so a tile URL dies with its challenge regardless of what the client does with it.

## Key rotation

`StaticKeyProvider` accepts multiple `(keyId, secret)` pairs plus one active id:

```ts
new StaticKeyProvider({ k1: oldSecret, k2: newSecret }, "k2");
```

New tokens are always signed with the active key; tokens signed under a retired key still verify as long as it remains in the map. Rotation sequence:

1. Add the new key id/secret alongside the old one; keep the old one active for now.
2. Deploy. Both keys are now accepted for verification.
3. Flip the active key id to the new one. Deploy again.
4. Once every token/tile signed under the old key is guaranteed to have expired (wait at least your longest configured TTL), remove the old key from the map.

Never skip straight to removing the old key -- any token or tile URL signed under it that a client is still holding would fail.

**Secret requirements**, enforced at construction (`ConfigurationError` if violated, and the error message never echoes the secret itself):
- Key ids must match `^[A-Za-z0-9_-]{1,32}$` (they're embedded in the dot-delimited token).
- Secrets must be at least 32 bytes -- shorter than a SHA-256 output is weaker than the primitive promises and is brute-forceable offline from a single captured token.

Generate one with `npx oorable-captcha init` (writes to `.env`, never prints the value unless you pass `--show`).

## Rate limiting

`MemoryRateLimiter` (fixed-window, single process) and `RedisRateLimiter` (same contract, INCR+PEXPIRE, safe across instances) share a `RateLimiter` interface: `consume()` (charges the budget) and `peek()` (reads it without charging -- used for the risk hook and for charging a separate "failed verification" budget only on failure). `CaptchaApi` applies, by default: per-IP creation and verification limits, per-site and per-session creation limits, a penalty budget charged only on failed verifications (so guessing is throttled harder than normal use), a penalty budget for replaying an already-used challenge, and a per-IP tile-fetch limit. See `docs/configuration.md` for the exact defaults and how to override them.

IPv4 clients are rate-limited per address; IPv6 clients are rate-limited per **/64**, because a single subscriber is commonly handed an entire /64 -- per-address limiting would let one machine rotate through 2^64 addresses and never trip a limit (`packages/server/src/ip.ts`).

`X-Forwarded-For` is ignored unless you explicitly declare how many reverse proxies you operate in front of the server (`trustProxyHops`). Without that, a client can set any `X-Forwarded-For` value it likes to fake its own address.

## What never appears in a response, log line, or error message

- The correct answer to any challenge (`code`, `correctOrder`, `correctIds`).
- The signing secret.
- The submitted answer, on a failed verification (so logs can't become an oracle either).
- Which specific reason a *verification* failed, by default (`CaptchaApi` collapses `not_found`/`already_used`/`site_key_mismatch` to a generic `"invalid"` so the API isn't an oracle for "does this challenge id exist" or "was it already solved" -- pass `exposeDetailedReasons: true` in development if you want the specific reason).

This is enforced by tests, not just described here -- see `packages/core/test/security.test.ts` and the leakage tests in `packages/server/test/api.test.ts`.

## Deployment posture

- Run behind a reverse proxy/WAF/CDN. This software does not replace network-level DDoS protection.
- Use `@oorable/captcha-redis` for anything with more than one server process -- `MemoryChallengeStore`/`MemoryRateLimiter` cannot coordinate across processes, so a load-balanced deployment on the in-memory store could let a challenge be solved once *per instance*.
- Keep the signing secret out of source control and use a different one per environment (`npx oorable-captcha doctor` checks it's set and long enough, without ever printing it).
- See `docs/deployment.md` for the full checklist.
