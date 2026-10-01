# Mobile / native app integration

There are **no native SDKs** for mobile platforms in this repository -- only the REST API (`docs/rest-api.md`), which any language with an HTTP client and a JSON parser can call directly. This section is the integration *pattern*; see `docs/rest-api.md` for language-specific request snippets (Kotlin, Swift, Java, Dart/Flutter, React Native, C#, and more).

## Flow

1. **Create**: `POST /v1/challenges` with `{ type, siteKey }`. You get back `{ challengeId, type, expiresIn, challenge }`.
2. **Render natively**:
   - `type: "text"` -- `challenge.image` is `{ contentType: "image/svg+xml", data: <base64> }`. Most mobile SVG-rendering libraries (or a WebView) can display it directly; decode the base64 to bytes first.
   - `type: "meme-puzzle"` -- `challenge.tiles` is an array of `{ token, assetUrl }` in shuffled order. Fetch each `assetUrl` (relative to your API host) as an image and lay them out in a `challenge.grid` x `challenge.grid` grid. Implement swap-on-tap yourself (see `packages/web/src/widget.ts` for the reference interaction model: tap one tile to "pick up," tap another to swap).
   - `type: "image"` -- `challenge.options` is `[{ id, imageUrl }]`; render them as a selectable grid, `challenge.select` is how many the user must choose, `challenge.prompt` is the instruction text if the server set one.
3. **Submit**: `POST /v1/challenges/verify` with `{ challengeId, answer, siteKey }`. For a meme puzzle, `answer` is the array of tile tokens **in the arrangement the user currently has on screen** (one per grid slot, in reading order) -- not just the ones that moved.
4. **On success**: you get `{ success: true, verificationToken, expiresIn }`. Send `verificationToken` to your own backend, which redeems it once via `POST /v1/tokens/verify` (server-to-server, authenticated with your site's secret key -- never embed the secret key in a mobile app).

## Why no answer key ships to the client

Same reasoning as the web widget: the app never learns which arrangement or option is correct, only how to render what the server sent and how to report back what the user did. A jailbroken device or a modified APK inspecting the app's own network traffic learns nothing more than a browser's network tab would.

## Session binding

Pass a `sessionId` (e.g., derived from your app's session token, not anything from the OS device identifier) when creating a challenge; the server can bind the resulting verification token to it (`docs/rest-api.md`'s `POST /v1/tokens/verify` accepts `sessionId` too), so a token solved in one session cannot be redeemed by presenting it from a different one.
