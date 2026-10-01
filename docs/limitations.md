# Limitations

Read this before deploying. Overclaiming security is worse than not claiming it -- see also `docs/threat-model.md` for the non-goals that apply regardless of how this software is built.

## Not implemented

- **Audio accessibility challenge.** The project brief explicitly allows documenting this as a future extension rather than shipping an unusable placeholder -- that's what this is. `docs/custom-challenges.md` shows how to add a challenge type using the same interface the built-in ones use, if you want to build one.
- **Math and slider challenges**, and other custom developer-defined types beyond meme-puzzle/text/image, are supported *as an extension point* (`docs/custom-challenges.md`) but none ship as a concrete built-in type.
- **General complex text shaping** (Arabic/Hebrew letter joining and RTL reordering, Indic conjuncts, Thai line breaking) in the text-CAPTCHA renderer. Digit *localization* (Arabic-Indic, Persian, Bengali, Devanagari, Burmese numerals) is implemented and tested; full alphabetic shaping for those scripts is not. See `docs/localization.md`.
- **Native mobile SDKs.** Mobile platforms get documented REST usage (`docs/mobile.md`, `docs/rest-api.md`), not a packaged SDK.
- **Bundled RTL UI translations.** RTL layout direction (`dir="rtl"`) is applied automatically; no RTL language's strings are bundled yet (`docs/localization.md`).
- **Admin asset management beyond a read-only listing.** `GET /v1/admin/assets` returns ids/labels only; there is no upload/write endpoint -- assets are added through the offline pipeline (`docs/asset-management.md`) by design, not as a gap to be filled later.
- **Invasive risk signals** (device fingerprinting, behavioral biometrics) are deliberately not included in `assessRisk` -- the project brief asked for this restraint explicitly, and it's a design choice, not an oversight. Feed it signals you already have a legitimate reason to collect.

## Built, but not independently verified in the way described

This repository was built in a sandboxed environment with **no network access** (confirmed by a blocked direct HTTP request and a failed npm registry fetch) and without several packages pre-installed. Rather than skip testing those parts or silently fake a pass, each case below is handled explicitly and disclosed:

- **The four supplied meme-puzzle image URLs** could not be fetched, downloaded, or inspected -- there was no network path to do so (see `docs/asset-management.md` for exactly how this was confirmed). The asset-processing *pipeline* that would turn them into tiles was verified end-to-end against a synthetic stand-in image instead, using the real `sharp` library. Run `npm run assets:setup && npm run assets:process` yourself once you have network access.
- **Redis.** No Redis server and no `ioredis` package were available. The store/limiter logic is tested against a fake client for calling-contract correctness; the actual Lua scripts are covered by a separate integration suite that runs for real when `ioredis` and a Redis server are available, and **skips itself with an explicit message** otherwise rather than passing silently. See `docs/redis.md`.
- **Express and Fastify.** Neither framework is installed in this environment (peer dependencies, no network to fetch them). Both adapters are written to depend on their framework only for *types* (`import type`, erased at compile time) rather than at runtime, specifically so their own logic could still be exercised for real -- their tests run the actual compiled adapter code against a faithful fake app/router object standing in for the real framework. This verifies the adapter's own translation logic; it does not verify Express's or Fastify's own routing/middleware behavior (which is Express's and Fastify's own well-established test coverage, not this project's to re-verify).
- **React's TypeScript types (`@types/react`).** Not installed (no network); a narrow, compile-time-only ambient shim was used to type-check `packages/react` locally. This does **not** affect real consumers: the emitted `.d.ts` only re-exports bare `import ... from "react"` specifiers (verified by inspecting the actual build output), which a real project resolves against its own, real, installed React types. React's *runtime* behavior is verified against the real `react`/`react-dom` packages (which, unlike Express/Fastify, genuinely are present in this environment) in an actual Chromium browser.
- **ESLint.** A config is included (`.eslintrc.cjs`), but `eslint` itself could not be installed (the npm registry was unreachable) and so linting was not actually run in this build. Run `npm install eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin` and `npm run lint` yourself.
- **No independent third-party security audit.** Internal reasoning and extensive automated testing (226 tests, including real-concurrency race tests) are not a substitute for one. Treat everything in `docs/security.md` and `docs/threat-model.md` as this project's own claims about itself.

## Residual risk even where everything above is verified

- A small, static, publicly reused pool of meme-puzzle source images is crackable by simple image hashing/matching over time -- rotate your image pool (`docs/threat-model.md`, `docs/asset-management.md`).
- No visual or interactive CAPTCHA -- this one included -- distinguishes "a human solving it" from "a human solving it for someone else, for money." If paid solving services are your threat, you need account/behavioral signals in addition to this.
- No claim is made about resistance to a sufficiently capable ML vision model for any challenge type here, including the meme puzzle. See `docs/threat-model.md`'s "Non-goals" section in full before deciding this is sufficient on its own for a high-value target.

## What *is* solid

The core engine (`@oorable/captcha`) has zero runtime dependencies and its security-critical properties (one-time use, atomicity under real concurrency, no answer leakage, token forgery/tampering resistance, path-traversal/SSRF/capacity hardening) are covered by tests that assert the property, not just the happy path -- several genuine bugs were caught and fixed by these tests during development (a TOCTOU race in the original attempt-limit check, a hash-collision bug in the CLI's project-scoping, a fragile error-isolation bug in the image-challenge widget) rather than written once and assumed correct; see `CHANGELOG.md` and the comments in the relevant test files for specifics. The web widget's accessibility and interaction behavior is verified in a real browser, not asserted from a DOM simulation.
