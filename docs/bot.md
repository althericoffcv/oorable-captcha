# Bot integration

`@oorable/captcha-bot` wraps the core engine in the shape a chat bot wants: bytes ready to attach to a message, not a base64 data URL or an SVG a bot platform's photo API won't accept.

```ts
import { createEngine } from "@oorable/captcha";
import { createBotChallenge, verifyBotAnswer, sharpToPng } from "@oorable/captcha-bot";

const engine = createEngine();

const challenge = await createBotChallenge(engine, {
  type: "text",
  mode: "numeric",
  length: 6,
  toRaster: sharpToPng, // see "Raster images" below
});
// challenge.image.data is a Buffer, challenge.image.contentType is "image/png"
// challenge.challengeId / challenge.expiresIn -- remember challengeId per chat/user

const result = await verifyBotAnswer(engine, { challengeId: challenge.challengeId, answer: replyText });
if (result.success) { /* result.verificationToken, if you need to prove this chat was verified elsewhere */ }
```

This package does not depend on any specific bot framework -- see `examples/whatsapp-example.ts`, `examples/telegram-example.ts`, and `examples/discord-example.ts` for complete, framework-specific wiring (using Baileys, `node-telegram-bot-api`, and discord.js respectively). None of those libraries are dependencies of this repo; the examples show the integration pattern so you can adapt it to whichever client you already use.

## Raster images

Most bot platforms' photo-send APIs (WhatsApp, Telegram, Discord) expect PNG/JPEG, not SVG. The core engine's default text renderer produces zero-dependency SVG, so `@oorable/captcha-bot` ships an **optional** real converter:

```ts
import { sharpToPng } from "@oorable/captcha-bot";
```

This calls [`sharp`](https://sharp.pixelplumbing.com/) (`npm install sharp` -- an optional peer dependency, only required if you use `sharpToPng`) to convert the generated SVG to a real PNG. It is not imported at the top of the package, so creating a *web* text challenge that stays as SVG never forces a bot consumer to install a native-binding package they don't need. Pass any function of your own instead if you'd rather use a different renderer (`resvg`, a headless-browser screenshot, etc.) -- `createBotChallenge`'s `toRaster` option accepts `(svg: Buffer) => Promise<Buffer>`.

## Which challenge type fits a chat bot

**Text** is the natural fit: one image, one typed reply. **Image-selection** also works over chat (send the numbered candidates, ask the user to reply with numbers) but you'll need to build that numbering/mapping yourself in your bot's message-handling code -- `createBotChallenge` returns the full `raw` payload (`{ options, select, prompt }`) for exactly this purpose.

**Meme-puzzle** does not reduce to a single image (`bot.image` is `undefined` for it) -- a sliding-tile puzzle is designed around click/tap/keyboard interaction, which a chat transcript doesn't have. `bot.raw` gives you the shuffled tile list if you want to build something creative (e.g., render all tiles into one composite image with numbered labels and ask the user to reply with a permutation), but this is not implemented for you -- see `docs/limitations.md`.

## Verification flow

`verifyBotAnswer` is a thin, explicitly-named wrapper around `engine.verifyChallenge` -- it exists so bot integration code reads as "verify a bot answer" rather than a bare engine call buried in platform-specific plumbing. It returns the same `VerifyResult` shape as everywhere else in this project: `{ success: true, verificationToken, expiresIn }` or `{ success: false, reason }`. On `too_many_attempts` or `expired`, the natural bot UX is to silently issue a fresh challenge (see the examples) rather than leaving the user stuck.
