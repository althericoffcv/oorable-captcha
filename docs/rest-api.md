# REST API reference

Base path: `/v1`. All request/response bodies are JSON (`Content-Type: application/json`) unless noted. Every response includes `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

This is the actual, implemented API (`packages/server/src/api.ts`) -- every endpoint below is covered by tests in `packages/server/test/api.test.ts` and, for the transport layer, `packages/server/test/http.test.ts` (real sockets).

## `GET /v1/health`

```json
{ "status": "ok", "version": "v1" }
```

## `POST /v1/challenges`

Request:

```json
{ "type": "meme-puzzle", "locale": "en-US", "difficulty": "medium", "siteKey": "public-site-key", "sessionId": "opaque-session-id" }
```

`type` is one of `"meme-puzzle"`, `"text"`, `"image"` (only offered if the server configured an image catalogue). `difficulty`, `locale`, `siteKey`, `sessionId` are all optional. **`difficulty` is a floor a client may raise, never lower** -- a site's configured minimum (default `"medium"`) always applies; see `docs/security.md`. There is no way to request a specific grid size, code length, or image candidates directly -- those are controlled server-side.

Response (`201`):

```json
{
  "challengeId": "opaque-id",
  "type": "meme-puzzle",
  "expiresIn": 120,
  "challenge": { "grid": 3, "tiles": [{ "token": "...", "assetUrl": "/v1/assets/tile/..." }] }
}
```

The response never reveals the correct answer. Shape of `challenge` depends on `type`:

- `meme-puzzle`: `{ grid, tiles: [{ token, assetUrl }] }` -- `tiles[i]` is the tile currently shown at slot `i`.
- `text`: `{ image: { contentType, data }, mode, length }` -- `data` is base64.
- `image`: `{ options: [{ id, imageUrl }], select, prompt? }`.

Errors: `400 { "error": "invalid_request" }` / `"unsupported_type"`, `403 { "error": "invalid_site" }` / `"origin_not_allowed"`, `429 { "error": "rate_limited" }` (with `Retry-After`), `413`/`415`/`408` for oversized/wrong-content-type/slow request bodies.

## `POST /v1/challenges/verify`

Request:

```json
{ "challengeId": "opaque-id", "answer": {}, "siteKey": "public-site-key" }
```

`answer` shape depends on the challenge type: an array of tile tokens (meme-puzzle, one per slot in the arrangement the user currently has), a string (text), or an array of selected ids (image).

Response (`200`, always -- a wrong answer is not an HTTP error):

```json
{ "success": true, "verificationToken": "opaque-server-issued-token", "expiresIn": 120 }
```

or

```json
{ "success": false, "reason": "incorrect" }
```

`reason` is one of `"incorrect"`, `"expired"`, `"too_many_attempts"`, or the catch-all `"invalid"` (used for unknown/already-used/wrong-site challenges, deliberately collapsed so the API can't be used to probe whether a challenge id exists or was already solved -- see `docs/security.md`).

## `POST /v1/challenges/refresh`

Request: `{ "challengeId": "opaque-id", "siteKey": "public-site-key" }`. Replaces an unsolved challenge with a fresh equivalent one (same type and difficulty) and discards the old one. Response: same shape as `POST /v1/challenges` (`201`), or `404 { "error": "invalid" }` if the challenge is unknown, already solved, or expired.

## `POST /v1/tokens/verify`

**Server-to-server.** Redeems a verification token exactly once. If you configured `sites` with a `secretKey`, this requires `Authorization: Bearer <secretKey>` -- never call this from a browser or app.

Request: `{ "token": "v1...", "siteKey": "...", "sessionId": "..." }` (`sessionId` optional; if given, the token must have been issued for it).

Response: `{ "valid": true, "challengeId": "...", "type": "text", "siteKey": "...", "sessionId": "...", "issuedAt": 172..., "expiresAt": 172... }` or `{ "valid": false, "reason": "already_redeemed" }` (also: `"invalid_token"`, `"expired"`, `"site_key_mismatch"`, `"session_mismatch"`). `401 { "error": "unauthorized" }` for a missing/wrong secret key.

## `GET /v1/assets/tile/:token`

Returns raw image bytes (`Content-Type` matches the asset, typically `image/svg+xml` or `image/jpeg`) for a meme-puzzle tile. `:token` is the opaque, encrypted, single-challenge token from `challenge.tiles[i].token` -- not something you construct. `404` for any unknown/expired/forged token.

## `GET /v1/metrics` (optional)

Only exists if you configured `metricsToken`. Requires `Authorization: Bearer <metricsToken>`. Returns JSON by default, or Prometheus text exposition format with `Accept: text/plain` or `?format=prometheus`.

## `GET /v1/admin/assets` (optional)

Only exists if you configured `adminToken`. Requires `Authorization: Bearer <adminToken>`. Returns `{ count, images: [{ id, label }] }` -- ids and labels only, never solutions, tile positions, or challenge state. There is no endpoint that returns any of that, and no write endpoint -- assets are added through the offline pipeline (`docs/asset-management.md`).

---

## Language examples

These use each language's standard HTTP client -- none are bundled SDKs (only the packages listed in the root README are implemented SDKs; everything below is "call the REST API," documented per the project brief's request).

### JavaScript / TypeScript

```ts
const res = await fetch("https://captcha.example.com/v1/challenges", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "text", siteKey: "pk_live_..." }),
});
const { challengeId, challenge } = await res.json();
```

(Or just use `@oorable/captcha-client` -- this is what it does internally.)

### Python

```python
import requests

r = requests.post("https://captcha.example.com/v1/challenges",
                   json={"type": "text", "siteKey": "pk_live_..."})
challenge_id = r.json()["challengeId"]
```

### PHP

```php
$ch = curl_init("https://captcha.example.com/v1/challenges");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Content-Type: application/json"],
    CURLOPT_POSTFIELDS => json_encode(["type" => "text", "siteKey" => "pk_live_..."]),
]);
$data = json_decode(curl_exec($ch), true);
```

### Go

```go
body, _ := json.Marshal(map[string]string{"type": "text", "siteKey": "pk_live_..."})
resp, err := http.Post("https://captcha.example.com/v1/challenges", "application/json", bytes.NewReader(body))
```

### Java

```java
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://captcha.example.com/v1/challenges"))
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString("{\"type\":\"text\",\"siteKey\":\"pk_live_...\"}"))
    .build();
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
```

### Kotlin (Android)

```kotlin
val body = """{"type":"text","siteKey":"pk_live_..."}"""
    .toRequestBody("application/json".toMediaType())
val request = Request.Builder().url("https://captcha.example.com/v1/challenges").post(body).build()
OkHttpClient().newCall(request).execute().use { it.body?.string() }
```

### Swift (iOS)

```swift
var request = URLRequest(url: URL(string: "https://captcha.example.com/v1/challenges")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONSerialization.data(withJSONObject: ["type": "text", "siteKey": "pk_live_..."])
let (data, _) = try await URLSession.shared.data(for: request)
```

### Dart / Flutter

```dart
final res = await http.post(
  Uri.parse("https://captcha.example.com/v1/challenges"),
  headers: {"Content-Type": "application/json"},
  body: jsonEncode({"type": "text", "siteKey": "pk_live_..."}),
);
final challengeId = jsonDecode(res.body)["challengeId"];
```

### React Native

Same as the JavaScript example above (`fetch` is built in) -- or use `@oorable/captcha-client` directly, since it has no DOM/browser-only dependencies.

### C#

```csharp
using var client = new HttpClient();
var content = new StringContent(
    JsonSerializer.Serialize(new { type = "text", siteKey = "pk_live_..." }),
    Encoding.UTF8, "application/json");
var response = await client.PostAsync("https://captcha.example.com/v1/challenges", content);
```
