# OORABLE CAPTCHA

**Human Verification System**

A universal CAPTCHA and human-verification engine for bots (WhatsApp, Telegram, Discord), websites, mobile apps, and backend APIs. Its signature feature is the **Meme Puzzle CAPTCHA** -- an interactive sliding-tile puzzle built from real images -- alongside standard text and image-selection challenges.

The core engine is security-first and runs entirely server-side. Client SDKs (web widget, bot helpers) never decide whether an answer is correct; they only render a challenge and forward whatever the user submits.

> **Honest framing, on purpose:** nothing here is claimed to be "unbeatable" or "AI-proof." See [docs/limitations.md](docs/limitations.md) and [docs/threat-model.md](docs/threat-model.md) for what this does and does not protect against, and pair it with rate limiting, risk scoring, and your own edge/WAF.

## Features

- **Meme Puzzle CAPTCHA** -- 2x2 to 6x6 sliding tile puzzle, click/tap or full keyboard control, optional drag-and-drop, cryptographically shuffled, opaque per-challenge tile tokens (see [threat model](docs/threat-model.md)).
- **Text CAPTCHA** -- numeric (5-8 digits) or alphanumeric codes, rendered as a distorted SVG image with zero runtime dependencies; locale-aware digit rendering (Arabic-Indic, Persian, Bengali, Devanagari, ...).
- **Image CAPTCHA** -- "select the matching images," server-defined answer key, your own image catalogue.
- **Provider-based** -- bring your own storage (memory or Redis included), asset source, and text renderer.
- **Signed, single-use verification tokens** (HMAC-SHA-256, key rotation support) and **stateless, encrypted puzzle-tile tokens** (AES-256-GCM) that reveal nothing about tile position.
- Rate limiting, a transparent risk-scoring hook, and a REST API designed to be called from any language.

## Supported platforms

| Surface | Package | Status |
|---|---|---|
| Core engine | `@oorable/captcha` | Implemented, tested (98 tests) |
| REST API (framework-agnostic + `node:http`) | `@oorable/captcha-server` | Implemented, tested (54 tests incl. real sockets) |
| HTTP client (browser/Node/bots) | `@oorable/captcha-client` | Implemented, tested (8 tests) |
| Web widget (vanilla JS) | `@oorable/captcha-web` | Implemented, tested in real Chromium (15 tests) |
| React | `@oorable/captcha-react` | Implemented, tested with real React 19 in Chromium (3 tests) |
| Express | `@oorable/captcha-express` | Implemented, tested (8 tests) |
| Fastify | `@oorable/captcha-fastify` | Implemented, tested (7 tests) |
| Redis (multi-instance deployments) | `@oorable/captcha-redis` | Implemented; contract-tested against a fake client, plus a real `ioredis` integration suite that runs when Redis is available |
| Bots (WhatsApp/Telegram/Discord) | `@oorable/captcha-bot` + `examples/` | Implemented, tested (7 tests) |
| CLI | `@oorable/captcha-cli` (`oorable-captcha`) | Implemented, tested as real subprocesses (15 tests) |
| Mobile (Kotlin, Swift, Java, Dart/Flutter, React Native, ...) | REST only -- see [docs/rest-api.md](docs/rest-api.md) | No native SDKs; documented REST usage |

Native SDKs exist only where listed above. Every other language talks to the REST API directly -- see [docs/rest-api.md](docs/rest-api.md) for JavaScript, Python, PHP, Go, Java, Kotlin, Swift, Dart, and C# snippets.

## Installation

```bash
npm install @oorable/captcha
npm install @oorable/captcha-server @oorable/captcha-express   # or -fastify
npm install @oorable/captcha-web        # browser widget
npm install @oorable/captcha-react      # React wrapper
npm install @oorable/captcha-bot        # bot helper
npm install @oorable/captcha-redis ioredis   # production, multi-instance
npx oorable-captcha init                # generates a signing secret into .env
```

See [docs/installation.md](docs/installation.md) for the full monorepo dev setup.

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
import { createBotChallenge, verifyBotAnswer, sharpToPng } from "@oorable/captcha-bot";

const challenge = await createBotChallenge(engine, { type: "text", length: 6, toRaster: sharpToPng });
// send challenge.image.data (a PNG Buffer) as a photo message; on reply:
const result = await verifyBotAnswer(engine, { challengeId: challenge.challengeId, answer: replyText });
```

### Core API directly

```ts
import { createCaptcha, verifyCaptcha } from "@oorable/captcha";

const challenge = await createCaptcha({ type: "meme-puzzle", difficulty: "medium" });
const result = await verifyCaptcha({ challengeId: challenge.challengeId, answer /* from the user */ });
```

## Security model (summary)

- The server creates, stores, and validates every challenge; the client never sees or supplies a "correct" flag.
- Verification tokens and puzzle-tile tokens are cryptographically signed/encrypted (HMAC-SHA-256 / AES-256-GCM), constant-time compared, single-use, and expire with the challenge.
- Every random value (ids, shuffles, codes, tokens) comes from `node:crypto`, never `Math.random()`.
- Answers, error messages, and logs never leak the correct solution.

Full write-up: [docs/security.md](docs/security.md) and [docs/threat-model.md](docs/threat-model.md).

## Configuration, storage, deployment

See [docs/configuration.md](docs/configuration.md), [docs/storage.md](docs/storage.md), [docs/redis.md](docs/redis.md), and [docs/deployment.md](docs/deployment.md).

## Limitations

This is honest about what it doesn't do -- overclaiming security is worse than not claiming it. Read [docs/limitations.md](docs/limitations.md) before you ship. Highlights: no audio-challenge implementation yet; the meme-puzzle images shipped by default are procedurally generated placeholders until you run the asset pipeline with your own photos; this has not been through an independent security audit.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT -- see [LICENSE](LICENSE).
