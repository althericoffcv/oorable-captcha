# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - Unreleased

Initial implementation.

### Added

- `@oorable/captcha`: core engine -- challenge lifecycle (create/verify, one-time consumption, attempt limits, expiry), meme-puzzle/text/image challenge types, HMAC-signed verification tokens with key rotation, AES-256-GCM sealed puzzle-tile tokens, in-memory store, rate limiter, risk-scoring helper, zero-dependency SVG text renderer with locale-aware digits.
- `@oorable/captcha-server`: framework-agnostic REST API (`/v1/challenges`, `/v1/challenges/verify`, `/v1/challenges/refresh`, `/v1/tokens/verify`, `/v1/assets/tile/:token`, `/v1/health`, optional `/v1/metrics` and `/v1/admin/assets`), a zero-dependency `node:http` transport, site-key registry with per-site secrets/origins/difficulty floors, rate limiting, an opt-in risk-escalation hook, CORS, Prometheus-format metrics.
- `@oorable/captcha-client`: small fetch-based client shared by the web widget and bots.
- `@oorable/captcha-web`: the meme-puzzle/text/image widget -- accessible (keyboard, screen-reader announcements, reduced-motion, forced-colors, 320px+), themeable (light/dark/auto via CSS custom properties), localized (English, Indonesian, Spanish, French, German, Portuguese bundled).
- `@oorable/captcha-react`: thin `<OorableCaptcha>` wrapper around the web widget.
- `@oorable/captcha-express`, `@oorable/captcha-fastify`: framework adapters.
- `@oorable/captcha-redis`: Redis-backed store and rate limiter for multi-instance deployments.
- `@oorable/captcha-bot`: bot-oriented API returning ready-to-send image bytes, plus an optional real SVG-to-PNG converter (`sharpToPng`) and WhatsApp/Telegram/Discord integration examples.
- `@oorable/captcha-cli` (`oorable-captcha`): `init`, `generate`, `verify`, `doctor` commands.
- Asset pipeline scripts (`scripts/fetch-assets.mjs`, `scripts/process-assets.mjs`) for turning the four supplied meme images into per-grid tile sets, plus a zero-dependency `SyntheticAssetProvider` fallback.
- Full documentation set under `docs/`.

### Known limitations

See [docs/limitations.md](docs/limitations.md). Notably: no audio-challenge implementation; the default puzzle images are procedurally generated placeholders until the asset pipeline is run with real photos (this build environment had no network access to fetch them); `express`, `fastify`, and `@types/react` could not be installed in the environment this was built in (peer dependencies, no network) -- `dist/` was still built for all three packages using a narrow, compile-time-only ambient type shim that does not affect what a real consumer's own installed types resolve to (verified by inspecting the emitted `.d.ts`: it only re-exports bare import specifiers). React's runtime behavior is verified against the real `react`/`react-dom` (which are present) in a real browser; the Express and Fastify adapters' runtime tests use a faithful fake app/router object in place of the real (uninstalled) framework, since their own logic depends on those frameworks only for types, not at runtime -- see each package's test file for the exact scope note.
