# Threat model

This document says plainly what OORABLE CAPTCHA defends against, how, and what it does **not** claim to solve. If you need something not covered here, treat this as a component in a larger defense (rate limiting at your edge, a WAF, account-level anomaly detection), not a complete answer.

## Assets to protect

1. **The correct answer to a challenge** (`ChallengeRecord.solution`) -- if this leaks, the challenge is worthless.
2. **The signing secret** (`KeyProvider`) -- if this leaks, an attacker can forge verification tokens and puzzle-tile tokens without ever solving anything.
3. **Verification tokens** -- proof that *a* challenge was solved; must not be forgeable, reusable, or transferable to a different site/session than they were issued for.
4. **Puzzle-tile tokens** -- must not reveal which grid position they belong to, must not be forgeable into fetching arbitrary files, and must not be reusable across challenges.
5. **Server capacity** -- creating or verifying challenges must not be a way to exhaust memory, CPU, or storage.

## Adversaries considered

| Adversary | Capability | What stops them |
|---|---|---|
| Scripted bot reading raw HTML/JSON | Parses responses, replays requests | The answer is never in the response; a wrong answer's error never reveals the right one; replayed correct answers fail (one-time consumption) |
| Bot attempting brute force | Many guesses against one challenge | `maxAttempts` per challenge (atomic, race-proof -- see below), plus IP/site/session rate limits |
| Bot rotating IPs or challenges | Many challenges, few guesses each | Per-site and per-session rate limits; the risk-scoring hook can escalate difficulty or block based on aggregate failure/replay rate |
| Attacker tampering with a token in transit | Modifies a captured verification/tile token | HMAC-SHA-256 (tokens) / AES-256-GCM (tiles) with constant-time verification -- any bit flip invalidates it |
| Attacker replaying a valid token | Reuses a token that already worked once | `tryConsume`/`tryRedeem` are atomic "exactly one winner" operations, tested under real concurrency (in-process and, for Redis, against a real server) |
| Malicious or careless site operator's client code | Reads response bodies, inspects the DOM | The public payload contains no field the checker in `packages/core/test/security.test.ts` doesn't already assert is absent (`correctOrder`, `code`, `correctIds`, raw asset paths) |
| Attacker probing the asset endpoint | Requests arbitrary paths via a crafted "tile token" | Tile tokens are authenticated ciphertext (AES-GCM); a token that doesn't decrypt and authenticate is simply rejected, and `LocalPreprocessedAssetProvider` additionally constrains path segments defensively even though its inputs never come from client data |
| Attacker flooding challenge creation | Sends huge/degenerate requests (giant grid, giant code length, giant body) | Grid and code length are clamped server-side regardless of what's requested; `node:http` transport enforces a body-size ceiling and a slow-body timeout; `MemoryChallengeStore`/`MemoryRateLimiter` have hard entry caps and evict/sweep rather than growing unbounded |
| Attacker with a paid human-solving service | Pays a human to solve the challenge | **Not mitigated by this software.** No CAPTCHA stops a human from solving it for another human. This is a cost/friction/rate-limiting problem, not a puzzle-design problem -- see "Non-goals" below |
| Attacker with a capable ML vision model | Trains or uses a model to solve text/image/puzzle challenges | **Only partially mitigated.** See "Non-goals" |

## Why the operation ordering in `verifyChallengeRecord` matters

(`packages/core/src/challenge/lifecycle.ts`)

1. Look up the record -- unknown id short-circuits everything.
2. Reject already-consumed/expired/attempts-exhausted challenges **before** touching the submitted answer, so those states can't be "retried past."
3. Atomically increment the attempt counter and **gate on the value the store itself returns** -- not on a pre-check read. A cheap pre-check can pass for many concurrent requests at once; only the atomically-incremented counter is safe to enforce a hard cap with. (An earlier version of this code gated on the pre-check instead, which a concurrency test in `packages/core/test/races.test.ts` caught immediately -- see that file's git-blame-equivalent comment for the exact failure.)
4. Only now compare the answer.
5. Atomically try to consume the challenge. If two requests both submit the correct answer concurrently (a replayed correct answer racing the legitimate one), only one may win the consume and receive a token.

## Token design

See `docs/security.md` for the byte-level format. The short version: verification tokens are HMAC-signed with a purpose string and expiry baked into the signed payload; puzzle-tile tokens are AES-256-GCM sealed (so the ciphertext also authenticates, and nothing about the plaintext -- image id, row, column -- is readable without the key). Both are stateless to verify (any server instance holding the key can check one), and both still go through a stateful **consumption** step (`tryConsume`, `tryRedeem`) so a valid signature alone is never sufficient for reuse.

## Non-goals (read this before you deploy)

- **This does not prove human identity.** It raises the cost of automating a specific action. A sufficiently motivated attacker with human labor or a good-enough model can pass any individual challenge.
- **This does not stop paid CAPTCHA-solving services.** No visual or interactive puzzle can distinguish "a human solving it themselves" from "a human solving it for someone else, for money." If this is your threat, you need account-level signals (velocity, reputation, payment risk), not a harder puzzle.
- **This does not claim resistance to state-of-the-art ML vision models** for the text or image challenge types, and makes no claim about the meme-puzzle type either. The meme-puzzle's tile tokens prevent a *metadata*-only attack (reading the answer out of the JSON), but the tile **pixels** are still visible to anything that can look at an image -- including a model. A small, static, publicly reused pool of source images is also crackable by simple image hashing/matching over time; rotate your image pool and treat the puzzle as one signal among several, not a standalone barrier.
- **This does not stop distributed abuse by itself.** Per-IP rate limiting is necessary but not sufficient against a large residential proxy pool; pair it with the risk-scoring hook, your own account/device signals, and edge-level protections (a WAF, Cloudflare Turnstile-style network reputation, etc.).
- **The risk engine (`assessRisk`) is a heuristic**, not a verdict. Feed it signals you already have a legitimate reason to collect; do not use it as a substitute for the challenge itself, and do not present its score to end users as a judgment about them.

If your threat model requires stronger guarantees than the above, treat OORABLE CAPTCHA as one layer behind a WAF/edge network and alongside account-level anomaly detection -- not as the whole solution.
