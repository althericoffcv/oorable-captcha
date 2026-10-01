# FAQ

**Is this unbeatable / AI-proof?**
No, and the project deliberately never claims that -- see `docs/threat-model.md`. It raises the cost of automating an action; it doesn't make automation impossible.

**Why does the meme puzzle show abstract colored circles instead of a meme?**
You're seeing the default `SyntheticAssetProvider` -- a zero-dependency placeholder used until you run the asset pipeline with real photos. See `docs/asset-management.md`.

**Do I need Redis?**
Only if you run more than one server process. A single instance works fine with the default in-memory store. See `docs/storage.md`.

**Can a client request an easier puzzle or a shorter code to make it trivial?**
No. Clients may only ever request *harder* than your configured floor (default "medium" difficulty, 6-character codes), never easier -- see `docs/security.md` and the tests in `packages/server/test/api.test.ts`.

**What exactly does the client see for a meme puzzle -- could it just read the answer out of the response?**
No. Each tile is an opaque, encrypted, single-challenge token; the response contains no field that encodes which grid slot a tile belongs to. See `docs/threat-model.md`'s "puzzle-tile tokens" discussion for the full reasoning, including the residual risk that *does* exist (image content itself is still visible, same as to a human).

**Can I use my own storage backend (Postgres, DynamoDB, ...)?**
Yes -- implement the small `ChallengeStore` interface. See `docs/storage.md`.

**Can I add my own challenge type (e.g., a math problem, a slider)?**
Yes -- see `docs/custom-challenges.md`. Math and slider challenges aren't built in, but the extension point they'd use is.

**Does this work with [my bot framework]?**
`@oorable/captcha-bot` doesn't depend on any specific one -- it returns image bytes and a verify function; wire it into whatever you use. Three complete examples (WhatsApp/Baileys, Telegram, Discord) are included as a pattern to adapt.

**Why do bot images need `sharpToPng`? Why isn't PNG the default?**
The core engine's text renderer is zero-dependency SVG. Browsers render SVG natively; most bot platforms' photo-send APIs need PNG/JPEG. `sharpToPng` is an opt-in conversion so *web* consumers never need to install a native image library they don't use. See `docs/bot.md`.

**Is the CLI safe to use against a production server?**
`oorable-captcha generate`/`verify` use a local, file-backed dev store scoped to your current project directory -- meant for local smoke-testing only, not for talking to a remote/production API. `init` and `doctor` are safe anywhere (neither prints secret values by default).

**What Node.js version do I need?**
18+ to run the published packages. 22.6+ if you're developing this monorepo itself (native TypeScript execution for tests). See `docs/installation.md`.

**Where do I report a security vulnerability?**
Not as a public GitHub issue -- see `SECURITY.md`.

**Has this been audited?**
No independent third-party security audit has been performed. See `docs/limitations.md`.
