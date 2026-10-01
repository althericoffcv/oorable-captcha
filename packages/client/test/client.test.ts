import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryChallengeStore, OorableCaptchaEngine, StaticKeyProvider } from "@oorable/captcha";
import { createApi, startServer } from "@oorable/captcha-server";
import { ApiError, OorableCaptchaClient } from "../src/index.ts";

const SECRET = "client-test-".padEnd(48, "0123456789abcdef");

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string>; text?: string } | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return new Response(next.text ?? JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json", ...next.headers },
    });
  }) as typeof fetch;
  return { impl, calls };
}

test("client: requests carry the site key and session, use POST JSON, and never send credentials", async () => {
  const { impl, calls } = fakeFetch([{ body: { challengeId: "c1", type: "text", expiresIn: 120, challenge: {} } }]);
  const client = new OorableCaptchaClient({ baseUrl: "https://captcha.example.com/", siteKey: "pk", sessionId: "sess-1", fetch: impl });
  await client.createChallenge({ type: "text", locale: "id-ID" });

  assert.equal(calls[0]!.url, "https://captcha.example.com/v1/challenges", "trailing slash trimmed");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(calls[0]!.init.credentials, "omit");
  assert.equal((calls[0]!.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { type: "text", locale: "id-ID", siteKey: "pk", sessionId: "sess-1" });
});

test("client: verify and refresh send only what the user did, plus the site key", async () => {
  const { impl, calls } = fakeFetch([
    { body: { success: false, reason: "incorrect" } },
    { body: { challengeId: "c2", type: "text", expiresIn: 120, challenge: {} } },
  ]);
  const client = new OorableCaptchaClient({ siteKey: "pk", fetch: impl });
  const res = await client.verify({ challengeId: "c1", answer: ["a", "b"] });
  assert.deepEqual(res, { success: false, reason: "incorrect" });
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { challengeId: "c1", answer: ["a", "b"], siteKey: "pk" });

  await client.refresh("c1");
  assert.equal(calls[1]!.url, "/v1/challenges/refresh");
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { challengeId: "c1", siteKey: "pk" });
});

test("client: redeemToken authenticates with the secret key as a bearer token", async () => {
  const { impl, calls } = fakeFetch([{ body: { valid: true } }]);
  await new OorableCaptchaClient({ siteKey: "pk", fetch: impl }).redeemToken("tok", { secretKey: "s3cret-s3cret-s3cret-s3cret" });
  assert.equal((calls[0]!.init.headers as Record<string, string>)["Authorization"], "Bearer s3cret-s3cret-s3cret-s3cret");
});

test("client: HTTP failures become ApiError with a stable code and Retry-After", async () => {
  const { impl } = fakeFetch([
    { status: 429, body: { error: "rate_limited" }, headers: { "retry-after": "17" } },
    { status: 400, body: { error: "invalid_request" } },
    { status: 500, body: { unexpected: true } },
    { status: 502, text: "<html>bad gateway</html>" },
  ]);
  const client = new OorableCaptchaClient({ fetch: impl });

  const limited = await client.createChallenge({ type: "text" }).catch((e) => e);
  assert.ok(limited instanceof ApiError);
  assert.equal(limited.status, 429);
  assert.equal(limited.code, "rate_limited");
  assert.equal(limited.retryAfterSeconds, 17);

  const invalid = await client.createChallenge({ type: "text" }).catch((e) => e);
  assert.equal(invalid.code, "invalid_request");
  assert.equal(invalid.retryAfterSeconds, undefined);

  assert.equal((await client.createChallenge({ type: "text" }).catch((e) => e)).code, "http_error");
  assert.equal((await client.createChallenge({ type: "text" }).catch((e) => e)).code, "bad_response");
});

test("client: network failures and timeouts are distinguishable, and errors carry no request content", async () => {
  const down = fakeFetch([new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.1")]);
  const err = await new OorableCaptchaClient({ fetch: down.impl }).verify({ challengeId: "c", answer: "SECRETGUESS" }).catch((e) => e);
  assert.equal(err.code, "network_error");
  assert.ok(!err.message.includes("SECRETGUESS") && !err.message.includes("10.0.0.1"));

  const hang = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch;
  const started = Date.now();
  const timeout = await new OorableCaptchaClient({ fetch: hang, timeoutMs: 30 }).createChallenge({ type: "text" }).catch((e) => e);
  assert.equal(timeout.code, "timeout");
  assert.ok(Date.now() - started < 1000);
});

test("client: asset URLs are restricted to http(s) and root-relative paths", () => {
  const client = new OorableCaptchaClient({ baseUrl: "https://captcha.example.com" });
  assert.equal(client.tileUrl("/v1/assets/tile/abc"), "https://captcha.example.com/v1/assets/tile/abc");
  assert.equal(client.tileUrl("https://cdn.example/x.jpg"), "https://cdn.example/x.jpg");
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "//evil.example/x", "relative/path", "", "vbscript:x"]) {
    assert.throws(() => client.tileUrl(bad), (e: unknown) => e instanceof ApiError && e.code === "bad_response", bad);
  }
});

test("client: data URLs are only built for real image types with base64 bodies", () => {
  const client = new OorableCaptchaClient();
  assert.equal(client.dataUrl({ contentType: "image/png", data: "iVBORw0KGgo=" }), "data:image/png;base64,iVBORw0KGgo=");
  assert.throws(() => client.dataUrl({ contentType: "text/html", data: "PHNjcmlwdD4=" }), ApiError);
  assert.throws(() => client.dataUrl({ contentType: "image/png", data: "not base64!!" }), ApiError);
  assert.throws(() => client.dataUrl({ contentType: "image/svg+xml;charset=utf-8", data: "AAAA" }), ApiError);
});

test("client against a real server: create, solve, verify, redeem with the secret key", async () => {
  const store = new MemoryChallengeStore({ sweepIntervalMs: 60_000 });
  const engine = new OorableCaptchaEngine({ store, keys: new StaticKeyProvider({ k1: SECRET }, "k1") });
  const secretKey = "site-secret-key-with-24-chars!!";
  const api = createApi({ engine, sites: [{ siteKey: "pk_live", secretKey }] });
  const server = await startServer(api);
  try {
    const client = new OorableCaptchaClient({ baseUrl: server.url, siteKey: "pk_live" });
    const created = await client.createChallenge({ type: "meme-puzzle", difficulty: "hard" });
    assert.equal(created.type, "meme-puzzle");
    if (created.type !== "meme-puzzle") return;
    assert.equal(created.challenge.tiles.length, 16);

    const tile = await fetch(client.tileUrl(created.challenge.tiles[0]!.assetUrl));
    assert.equal(tile.status, 200);
    assert.equal(tile.headers.get("content-type"), "image/svg+xml");

    const fresh = await client.refresh(created.challengeId);
    assert.notEqual(fresh.challengeId, created.challengeId);

    const { correctOrder } = (await store.get(fresh.challengeId))!.solution as { correctOrder: string[] };
    const wrong = await client.verify({ challengeId: fresh.challengeId, answer: ["nope"] });
    assert.deepEqual(wrong, { success: false, reason: "incorrect" });
    const right = await client.verify({ challengeId: fresh.challengeId, answer: correctOrder });
    assert.equal(right.success, true);
    if (!right.success) return;

    const unauthorized = await client.redeemToken(right.verificationToken, { secretKey: "wrong-secret-wrong-secret!!" }).catch((e) => e);
    assert.ok(unauthorized instanceof ApiError);
    assert.equal(unauthorized.status, 401);

    const redeemed = await client.redeemToken(right.verificationToken, { secretKey });
    assert.equal(redeemed.valid, true);
    assert.deepEqual(await client.redeemToken(right.verificationToken, { secretKey }), { valid: false, reason: "already_redeemed" });

    const missing = await client.refresh("does-not-exist").catch((e) => e);
    assert.ok(missing instanceof ApiError);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
    api.close();
    store.close();
  }
});
