import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CapacityError,
  MemoryChallengeStore,
  OorableCaptchaEngine,
  StaticKeyProvider,
  type ChallengeStore,
  type RateLimiter,
} from "@oorable/captcha";
import { createApi, type ApiEvent, type ApiOptions, type ApiRequest } from "../src/index.ts";

const SECRET = "server-test-".padEnd(48, "0123456789abcdef");
const IMAGES = () => [
  { id: "a", imageUrl: "https://cdn.example/a.jpg", correct: true },
  { id: "b", imageUrl: "https://cdn.example/b.jpg", correct: false },
  { id: "c", imageUrl: "https://cdn.example/c.jpg", correct: true },
  { id: "d", imageUrl: "https://cdn.example/d.jpg", correct: false },
];

function setup(opts: Partial<ApiOptions> = {}, store: ChallengeStore = new MemoryChallengeStore({ sweepIntervalMs: 60_000 })) {
  const engine = new OorableCaptchaEngine({ store, keys: new StaticKeyProvider({ k1: SECRET }, "k1") });
  const events: ApiEvent[] = [];
  const api = createApi({ engine, onEvent: (e) => events.push(e), ...opts });
  return {
    api,
    engine,
    store: store as MemoryChallengeStore,
    events,
    close: () => {
      api.close();
      (store as MemoryChallengeStore).close?.();
    },
  };
}

const req = (method: string, path: string, body?: unknown, extra: Partial<ApiRequest> = {}): ApiRequest => ({
  method,
  path,
  headers: {},
  ip: "203.0.113.7",
  body,
  ...extra,
});
const post = (path: string, body?: unknown, extra: Partial<ApiRequest> = {}) => req("POST", path, body, extra);
const get = (path: string, extra: Partial<ApiRequest> = {}) => req("GET", path, undefined, extra);

type Created = { challengeId: string; type: string; expiresIn: number; challenge: any };

async function createMeme(h: ReturnType<typeof setup>, body: Record<string, unknown> = {}, extra: Partial<ApiRequest> = {}) {
  const res = await h.api.handle(post("/v1/challenges", { type: "meme-puzzle", ...body }, extra));
  return { res, created: res.json as Created };
}

async function solutionOf(h: ReturnType<typeof setup>, id: string) {
  return (await h.store.get(id))!.solution as any;
}

async function solve(h: ReturnType<typeof setup>, body: Record<string, unknown> = {}) {
  const { created } = await createMeme(h, body);
  const { correctOrder } = await solutionOf(h, created.challengeId);
  const res = await h.api.handle(
    post("/v1/challenges/verify", { challengeId: created.challengeId, answer: correctOrder, siteKey: body["siteKey"] }),
  );
  return { created, res, token: (res.json as any).verificationToken as string };
}

// ------------------------------------------------------------------ basics

test("health, routing and method handling", async () => {
  const h = setup();
  const ok = await h.api.handle(get("/v1/health"));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { status: "ok", version: "v1" });
  assert.equal((await h.api.handle(get("/v1/health/"))).status, 200, "trailing slash tolerated");

  assert.equal((await h.api.handle(get("/v2/health"))).status, 404);
  assert.equal((await h.api.handle(get("/nope"))).status, 404);
  assert.equal((await h.api.handle(get("/v1/assets/tile/../../etc/passwd"))).status, 404);

  const wrong = await h.api.handle(get("/v1/challenges"));
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers["Allow"], "POST");
  assert.equal((await h.api.handle(req("DELETE", "/v1/challenges"))).status, 405);
  h.close();
});

test("every response carries no-store, nosniff and the API version", async () => {
  const h = setup();
  for (const res of [await h.api.handle(get("/v1/health")), await h.api.handle(get("/nope")), await h.api.handle(post("/v1/challenges", {}))]) {
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
    assert.equal(res.headers["X-Oorable-Api-Version"], "1");
  }
  h.close();
});

test("creating a meme puzzle matches the documented response shape and leaks no solution", async () => {
  const h = setup();
  const { res, created } = await createMeme(h, { difficulty: "medium", locale: "en-US", siteKey: "public-site-key" });
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(created).sort(), ["challenge", "challengeId", "expiresIn", "type"]);
  assert.equal(created.type, "meme-puzzle");
  assert.equal(created.expiresIn, 120);
  assert.equal(created.challenge.grid, 3);
  assert.equal(created.challenge.tiles.length, 9);
  const serialized = JSON.stringify(res.json);
  assert.ok(!/correctOrder|solution|answer/i.test(serialized));
  h.close();
});

test("full flow over the API: create, solve, verify, redeem once", async () => {
  const h = setup();
  const { created, res, token } = await solve(h);
  assert.equal(res.status, 200);
  assert.equal((res.json as any).success, true);
  assert.equal((res.json as any).expiresIn, 120);
  assert.ok(token.startsWith("v1.k1."));

  const redeemed = await h.api.handle(post("/v1/tokens/verify", { token }));
  assert.equal((redeemed.json as any).valid, true);
  assert.equal((redeemed.json as any).challengeId, created.challengeId);
  const again = await h.api.handle(post("/v1/tokens/verify", { token }));
  assert.deepEqual(again.json, { valid: false, reason: "already_redeemed" });
  h.close();
});

test("verification failures collapse to non-oracle reasons unless detailed reasons are enabled", async () => {
  const h = setup();
  const { created } = await createMeme(h);
  const { correctOrder } = await solutionOf(h, created.challengeId);
  const verify = (challengeId: string, answer: unknown) => h.api.handle(post("/v1/challenges/verify", { challengeId, answer }));

  assert.deepEqual((await verify(created.challengeId, ["nope"])).json, { success: false, reason: "incorrect" });
  assert.deepEqual((await verify("does-not-exist", [])).json, { success: false, reason: "invalid" });
  assert.equal(((await verify(created.challengeId, correctOrder)).json as any).success, true);
  assert.deepEqual((await verify(created.challengeId, correctOrder)).json, { success: false, reason: "invalid" }, "replay looks like any unknown id");
  h.close();

  const detailed = setup({ exposeDetailedReasons: true });
  const c = (await createMeme(detailed)).created;
  const sol = await solutionOf(detailed, c.challengeId);
  await detailed.api.handle(post("/v1/challenges/verify", { challengeId: c.challengeId, answer: sol.correctOrder }));
  const replay = await detailed.api.handle(post("/v1/challenges/verify", { challengeId: c.challengeId, answer: sol.correctOrder }));
  assert.deepEqual(replay.json, { success: false, reason: "already_used" });
  detailed.close();
});

test("attempt limit surfaces as too_many_attempts", async () => {
  const h = setup();
  const { created } = await createMeme(h);
  const { correctOrder } = await solutionOf(h, created.challengeId);
  for (let i = 0; i < 5; i++) await h.api.handle(post("/v1/challenges/verify", { challengeId: created.challengeId, answer: ["x"] }));
  const late = await h.api.handle(post("/v1/challenges/verify", { challengeId: created.challengeId, answer: correctOrder }));
  assert.deepEqual(late.json, { success: false, reason: "too_many_attempts" });
  h.close();
});

// ------------------------------------------------------------- validation

test("malformed create requests are rejected with a generic 400", async () => {
  const h = setup();
  const bad: unknown[] = [
    undefined,
    null,
    "a string",
    42,
    [],
    {},
    { type: "audio" },
    { type: ["meme-puzzle"] },
    { type: "meme-puzzle", difficulty: "impossible" },
    { type: "meme-puzzle", difficulty: 3 },
    { type: "meme-puzzle", locale: "not a locale!" },
    { type: "meme-puzzle", locale: "x".repeat(100) },
    { type: "meme-puzzle", siteKey: "k".repeat(500) },
    { type: "meme-puzzle", sessionId: "has spaces" },
    { type: "meme-puzzle", siteKey: 123 },
  ];
  for (const body of bad) {
    const res = await h.api.handle(post("/v1/challenges", body));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(res.json, { error: "invalid_request" });
  }
  h.close();
});

test("malformed verify requests are rejected", async () => {
  const h = setup({ rateLimit: false });
  const bad: unknown[] = [
    undefined,
    {},
    { challengeId: "abc" }, // no answer
    { answer: [] }, // no id
    { challengeId: 42, answer: [] },
    { challengeId: "has spaces", answer: [] },
    { challengeId: "x".repeat(200), answer: [] },
    { challengeId: "abc", answer: [], siteKey: 5 },
  ];
  for (const body of bad) {
    const res = await h.api.handle(post("/v1/challenges/verify", body));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  h.close();
});

test("transport-reported body problems map to the right status codes", async () => {
  const h = setup({ rateLimit: false });
  const cases: Array<[NonNullable<ApiRequest["bodyError"]>, number]> = [
    ["payload_too_large", 413],
    ["unsupported_media_type", 415],
    ["body_timeout", 408],
    ["invalid_json", 400],
  ];
  for (const [bodyError, status] of cases) {
    for (const path of ["/v1/challenges", "/v1/challenges/verify", "/v1/challenges/refresh", "/v1/tokens/verify"]) {
      assert.equal((await h.api.handle(post(path, undefined, { bodyError }))).status, status, `${path} ${bodyError}`);
    }
  }
  h.close();
});

// ---------------------------------------- clients cannot weaken the challenge

test("clients cannot choose grid size, code length, mode or image candidates", async () => {
  const h = setup({ imageCandidates: IMAGES });
  const meme = await createMeme(h, { grid: 2, difficulty: "easy" });
  assert.equal(meme.created.challenge.tiles.length, 9, "grid is ignored and the default floor (medium) applies");

  const text = await h.api.handle(post("/v1/challenges", { type: "text", length: 99, mode: "numeric" }));
  const code = (await solutionOf(h, (text.json as Created).challengeId)).code as string;
  assert.equal(code.length, 6);
  assert.match(code, /^[A-Z2-9]+$/, "site default mode (alphanumeric), not the client's numeric");

  // An attacker tries to define their own answer key for an image challenge.
  const forged = [
    { id: "x", imageUrl: "https://evil.example/1.jpg", correct: true },
    { id: "y", imageUrl: "https://evil.example/2.jpg", correct: false },
  ];
  const img = await h.api.handle(post("/v1/challenges", { type: "image", candidates: forged }));
  const payload = (img.json as Created).challenge;
  assert.deepEqual(payload.options.map((o: any) => o.id).sort(), ["a", "b", "c", "d"], "server-side catalogue only");
  const attack = await h.api.handle(post("/v1/challenges/verify", { challengeId: (img.json as Created).challengeId, answer: ["x"] }));
  assert.equal((attack.json as any).success, false);
  h.close();
});

test("difficulty: clients may raise it but never go below the site's floor", async () => {
  const tiles = async (h: ReturnType<typeof setup>, body: Record<string, unknown>) =>
    (await createMeme(h, body)).created.challenge.tiles.length;

  const none = setup({ rateLimit: false });
  assert.equal(await tiles(none, { difficulty: "easy" }), 9, "default floor is medium");
  assert.equal(await tiles(none, { difficulty: "hard" }), 16);
  assert.equal(await tiles(none, {}), 9);
  none.close();

  const hard = setup({ rateLimit: false, sites: [{ siteKey: "s", difficulty: "hard" }] });
  assert.equal(await tiles(hard, { siteKey: "s", difficulty: "easy" }), 16);
  hard.close();

  const easy = setup({ rateLimit: false, sites: [{ siteKey: "s", difficulty: "easy" }] });
  assert.equal(await tiles(easy, { siteKey: "s" }), 4, "a site can opt down to easy for itself");
  easy.close();
});

test("site-configured text challenge shape is honored", async () => {
  const h = setup({ sites: [{ siteKey: "bots", text: { mode: "numeric", length: 7 } }] });
  const res = await h.api.handle(post("/v1/challenges", { type: "text", siteKey: "bots" }));
  const code = (await solutionOf(h, (res.json as Created).challengeId)).code as string;
  assert.match(code, /^[0-9]{7}$/);
  h.close();
});

// ---------------------------------------------------------- sites and origins

test("site registry: unknown or missing site keys are refused; keys bind challenges to their site", async () => {
  const h = setup({ sites: [{ siteKey: "site-a" }, { siteKey: "site-b" }] });
  assert.equal((await h.api.handle(post("/v1/challenges", { type: "text", siteKey: "nope" }))).status, 403);
  assert.equal((await h.api.handle(post("/v1/challenges", { type: "text" }))).status, 403);
  assert.equal((await h.api.handle(post("/v1/challenges/verify", { challengeId: "abc", answer: "x", siteKey: "nope" }))).status, 403);

  const created = (await h.api.handle(post("/v1/challenges", { type: "meme-puzzle", siteKey: "site-a" }))).json as Created;
  const { correctOrder } = await solutionOf(h, created.challengeId);
  const crossSite = await h.api.handle(post("/v1/challenges/verify", { challengeId: created.challengeId, answer: correctOrder, siteKey: "site-b" }));
  assert.deepEqual(crossSite.json, { success: false, reason: "invalid" });
  const ok = await h.api.handle(post("/v1/challenges/verify", { challengeId: created.challengeId, answer: correctOrder, siteKey: "site-a" }));
  assert.equal((ok.json as any).success, true, "the wrong-site attempt neither solved nor burned it beyond an attempt");
  h.close();
});

test("site registry: allowedOrigins and allowedTypes are enforced", async () => {
  const h = setup({ sites: [{ siteKey: "s", allowedOrigins: ["https://good.example"], allowedTypes: ["meme-puzzle"] }] });
  const ask = (headers: Record<string, string>, type = "meme-puzzle") =>
    h.api.handle(post("/v1/challenges", { type, siteKey: "s" }, { headers }));

  assert.equal((await ask({ origin: "https://good.example" })).status, 201);
  assert.equal((await ask({})).status, 201, "non-browser clients send no Origin");
  const bad = await ask({ origin: "https://evil.example" });
  assert.equal(bad.status, 403);
  assert.deepEqual(bad.json, { error: "origin_not_allowed" });
  assert.equal((await ask({ origin: "null" })).status, 403);
  assert.equal((await ask({ origin: "https://good.example.evil.example" })).status, 403, "no suffix/prefix matching");
  assert.equal((await ask({ origin: "https://good.example" }, "text")).status, 400, "type not allowed for this site");
  h.close();
});

test("site registry validates its own configuration", () => {
  const engine = new OorableCaptchaEngine({ store: new MemoryChallengeStore({ sweepIntervalMs: 60_000 }), keys: new StaticKeyProvider({ k1: SECRET }, "k1") });
  assert.throws(() => createApi({ engine, sites: [{ siteKey: "dup" }, { siteKey: "dup" }] }), /duplicate/);
  assert.throws(() => createApi({ engine, sites: [{ siteKey: "bad key!" }] }), /must match/);
  assert.throws(() => createApi({ engine, sites: [{ siteKey: "s", secretKey: "short" }] }), /at least 24/);
  assert.throws(() => createApi({ engine, sites: [{ siteKey: "s", allowedOrigins: ["https://x.example/path"] }] }), /bare origin/);
  assert.throws(() => createApi({ engine, sites: [{ siteKey: "s", allowedOrigins: ["*"] }] }), /bare origin/);
});

// ------------------------------------------------------------------ image type

test("image challenges are only offered when the server has a catalogue, and verify correctly", async () => {
  const off = setup();
  assert.equal((await off.api.handle(post("/v1/challenges", { type: "image" }))).status, 400);
  off.close();

  const h = setup({ imageCandidates: IMAGES });
  const res = await h.api.handle(post("/v1/challenges", { type: "image" }));
  assert.equal(res.status, 201);
  assert.ok(!JSON.stringify(res.json).includes("correct"));
  const id = (res.json as Created).challengeId;
  const ok = await h.api.handle(post("/v1/challenges/verify", { challengeId: id, answer: ["c", "a"] }));
  assert.equal((ok.json as any).success, true);
  h.close();
});

// ------------------------------------------------------------ token redemption

const SITE_A = { siteKey: "site-a", secretKey: "a-secret-key-with-24-plus-chars!" };
const SITE_B = { siteKey: "site-b", secretKey: "b-secret-key-with-24-plus-chars!" };
const auth = (secret: string): Partial<ApiRequest> => ({ headers: { authorization: `Bearer ${secret}` } });

test("redemption is authenticated per site and bound to the site the token was issued for", async () => {
  const h = setup({ sites: [SITE_A, SITE_B] });
  const { token } = await solve(h, { siteKey: "site-a" });
  const redeem = (siteKey: string | undefined, extra: Partial<ApiRequest>) =>
    h.api.handle(post("/v1/tokens/verify", { token, siteKey }, extra));

  for (const attempt of [
    await redeem("site-a", {}), // no credentials
    await redeem("site-a", auth("wrong-secret-wrong-secret-wrong")),
    await redeem("site-a", auth(SITE_B.secretKey)), // another site's secret
    await redeem("no-such-site", auth(SITE_A.secretKey)),
    await redeem(undefined, auth(SITE_A.secretKey)),
  ]) {
    assert.equal(attempt.status, 401);
    assert.equal(attempt.headers["WWW-Authenticate"], "Bearer");
    assert.deepEqual(attempt.json, { error: "unauthorized" });
  }

  // Site B authenticates fine as itself but cannot redeem a token issued for site A -- and that does not burn it.
  const crossSite = await redeem("site-b", auth(SITE_B.secretKey));
  assert.deepEqual(crossSite.json, { valid: false, reason: "site_key_mismatch" });

  const legit = await redeem("site-a", auth(SITE_A.secretKey));
  assert.equal((legit.json as any).valid, true);
  const replay = await redeem("site-a", auth(SITE_A.secretKey));
  assert.deepEqual(replay.json, { valid: false, reason: "already_redeemed" });
  h.close();
});

test("repeated bad credentials are throttled", async () => {
  const h = setup({ sites: [SITE_A], rateLimit: { failedVerifyPerIp: { limit: 3, windowMs: 60_000 } } });
  const guess = () => h.api.handle(post("/v1/tokens/verify", { token: "x", siteKey: "site-a" }, auth("guess-guess-guess-guess-guess")));
  for (let i = 0; i < 3; i++) assert.equal((await guess()).status, 401);
  const blocked = await guess();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
  // Even the right secret is refused while the penalty window is open.
  const right = await h.api.handle(post("/v1/tokens/verify", { token: "x", siteKey: "site-a" }, auth(SITE_A.secretKey)));
  assert.equal(right.status, 429);
  h.close();
});

// -------------------------------------------------------------- rate limiting

test("create is limited per IP, and other IPs are unaffected", async () => {
  const h = setup({ rateLimit: { createPerIp: { limit: 3, windowMs: 60_000 } } });
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await createMeme(h)).res.status);
  assert.deepEqual(statuses, [201, 201, 201, 429, 429]);
  const limited = await createMeme(h);
  assert.deepEqual(limited.res.json, { error: "rate_limited" });
  assert.ok(Number(limited.res.headers["Retry-After"]) >= 1);
  assert.equal((await createMeme(h, {}, { ip: "198.51.100.9" })).res.status, 201);
  h.close();
});

test("garbage requests spend the same per-IP budget as good ones", async () => {
  const h = setup({ rateLimit: { createPerIp: { limit: 3, windowMs: 60_000 } } });
  for (let i = 0; i < 3; i++) assert.equal((await h.api.handle(post("/v1/challenges", { type: "nope" }))).status, 400);
  assert.equal((await h.api.handle(post("/v1/challenges", { type: "text" }))).status, 429);
  h.close();
});

test("IPv6 clients are limited per /64, IPv4-mapped addresses per IPv4", async () => {
  const h = setup({ rateLimit: { createPerIp: { limit: 2, windowMs: 60_000 } } });
  const from = async (ip: string) => (await createMeme(h, {}, { ip })).res.status;
  assert.equal(await from("2001:db8:abcd:12::1"), 201);
  assert.equal(await from("2001:db8:abcd:12:ffff:ffff:ffff:ffff"), 201, "same /64, shared budget");
  assert.equal(await from("2001:db8:abcd:12:1:2:3:4"), 429, "rotating the low 64 bits does not reset the limit");
  assert.equal(await from("2001:db8:abcd:13::1"), 201, "a different /64 has its own budget");

  assert.equal(await from("198.51.100.5"), 201);
  assert.equal(await from("::ffff:198.51.100.5"), 201);
  assert.equal(await from("[::ffff:c633:6405]"), 429, "mapped forms all count as the same IPv4 client");
  h.close();
});

test("failed verifications spend a penalty budget that blocks further attempts, even correct ones", async () => {
  const h = setup({ rateLimit: { failedVerifyPerIp: { limit: 3, windowMs: 60_000 } } });
  const { created } = await createMeme(h);
  const { correctOrder } = await solutionOf(h, created.challengeId);
  const wrong = () => h.api.handle(post("/v1/challenges/verify", { challengeId: created.challengeId, answer: ["x"] }));
  for (let i = 0; i < 3; i++) assert.equal((await wrong()).status, 200);
  assert.equal((await wrong()).status, 429);
  const tooLate = await h.api.handle(post("/v1/challenges/verify", { challengeId: created.challengeId, answer: correctOrder }));
  assert.equal(tooLate.status, 429);
  h.close();
});

test("per-site and per-session budgets apply", async () => {
  const site = setup({ sites: [{ siteKey: "s" }], rateLimit: { createPerSite: { limit: 2, windowMs: 60_000 } } });
  const statuses: number[] = [];
  for (let i = 0; i < 3; i++) statuses.push((await createMeme(site, { siteKey: "s" }, { ip: `198.51.100.${i + 1}` })).res.status);
  assert.deepEqual(statuses, [201, 201, 429], "different IPs still share the site budget");
  site.close();

  const session = setup({ rateLimit: { createPerSession: { limit: 2, windowMs: 60_000 } } });
  const s: number[] = [];
  for (let i = 0; i < 3; i++) s.push((await createMeme(session, { sessionId: "sess-1" }, { ip: `198.51.100.${i + 1}` })).res.status);
  assert.deepEqual(s, [201, 201, 429]);
  assert.equal((await createMeme(session, { sessionId: "sess-2" })).res.status, 201);
  session.close();
});

test("when a limiter itself fails, the API fails closed by default and open only on request", async () => {
  const broken: RateLimiter = {
    consume: async () => {
      throw new Error("redis down");
    },
    peek: async () => {
      throw new Error("redis down");
    },
  };
  const closed = setup({ limiterFactory: () => broken });
  const res = await createMeme(closed);
  assert.equal(res.res.status, 503);
  assert.equal(res.res.headers["Retry-After"], "5");
  closed.close();

  const open = setup({ limiterFactory: () => broken, onLimiterError: "open" });
  assert.equal((await createMeme(open)).res.status, 201);
  open.close();
});

// ------------------------------------------------------------------------ risk

test("risk: repeated failures escalate difficulty, then block issuing new challenges", async () => {
  const h = setup({
    rateLimit: { failedVerifyPerIp: { limit: 4, windowMs: 60_000 } },
    risk: { thresholds: { challenge: 0.3, block: 0.4 }, blockSeconds: 30 },
  });
  const tilesNow = async () => (await createMeme(h)).created?.challenge?.tiles?.length;
  assert.equal(await tilesNow(), 9, "clean client gets the normal puzzle");

  const { created } = await createMeme(h);
  const wrong = () => h.api.handle(post("/v1/challenges/verify", { challengeId: created.challengeId, answer: ["x"] }));
  await wrong();
  await wrong();
  await wrong();
  assert.equal(await tilesNow(), 16, "after several failures the same client is escalated to a harder grid");

  await wrong();
  const blocked = await createMeme(h);
  assert.equal(blocked.res.status, 429);
  assert.equal(blocked.res.headers["Retry-After"], "30");
  assert.deepEqual(blocked.res.json, { error: "rate_limited" }, "the response does not reveal that a risk score was involved");

  assert.equal((await createMeme(h, {}, { ip: "198.51.100.77" })).res.status, 201, "other clients are unaffected");
  assert.ok((h.api.metrics.riskDecisions["challenge"] ?? 0) >= 1 && (h.api.metrics.riskDecisions["block"] ?? 0) >= 1);
  h.close();
});

// -------------------------------------------------------------------- refresh

test("refresh swaps in a fresh challenge and retires the old one", async () => {
  const h = setup({ sites: [{ siteKey: "s" }] });
  const { created } = await createMeme(h, { siteKey: "s", difficulty: "hard" });
  const res = await h.api.handle(post("/v1/challenges/refresh", { challengeId: created.challengeId, siteKey: "s" }));
  assert.equal(res.status, 201);
  const fresh = res.json as Created;
  assert.notEqual(fresh.challengeId, created.challengeId);
  assert.equal(fresh.challenge.tiles.length, 16, "same difficulty as the original");

  const again = await h.api.handle(post("/v1/challenges/refresh", { challengeId: created.challengeId, siteKey: "s" }));
  assert.equal(again.status, 404, "the retired challenge cannot be refreshed again");
  const wrongSite = setup({ sites: [{ siteKey: "s" }, { siteKey: "t" }] });
  const c2 = (await createMeme(wrongSite, { siteKey: "s" })).created;
  assert.equal((await wrongSite.api.handle(post("/v1/challenges/refresh", { challengeId: c2.challengeId, siteKey: "t" }))).status, 404);
  wrongSite.close();
  h.close();
});

test("refresh spends the create budget", async () => {
  const h = setup({ rateLimit: { createPerIp: { limit: 2, windowMs: 60_000 } } });
  const { created } = await createMeme(h);
  assert.equal((await h.api.handle(post("/v1/challenges/refresh", { challengeId: created.challengeId }))).status, 201);
  assert.equal((await h.api.handle(post("/v1/challenges/refresh", { challengeId: created.challengeId }))).status, 429);
  h.close();
});

// ---------------------------------------------------------------------- tiles

test("tiles are served with hardening headers; forged tokens and traversal attempts get 404", async () => {
  const h = setup();
  const { created } = await createMeme(h);
  const tile = created.challenge.tiles[0];
  const res = await h.api.handle(get(tile.assetUrl));
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "image/svg+xml");
  assert.equal(res.headers["Content-Security-Policy"], "default-src 'none'; sandbox");
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
  assert.match(res.headers["Cache-Control"]!, /^private, max-age=\d+$/);
  assert.ok(res.raw && res.raw.toString("utf8").startsWith("<svg"));

  for (const bad of [`${tile.assetUrl}xx`, "/v1/assets/tile/t1.k1.AAAA", "/v1/assets/tile/", "/v1/assets/tile/%2e%2e%2f", `/v1/assets/tile/${"a".repeat(600)}`]) {
    assert.equal((await h.api.handle(get(bad))).status, 404, bad);
  }
  h.close();
});

test("tile fetches are rate limited per IP", async () => {
  const h = setup({ rateLimit: { tilePerIp: { limit: 3, windowMs: 60_000 } } });
  const { created } = await createMeme(h);
  const url = created.challenge.tiles[0].assetUrl;
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) codes.push((await h.api.handle(get(url))).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  h.close();
});

// ------------------------------------------------------------------------ CORS

test("CORS: off by default; allow-listed origins only; preflight answered", async () => {
  const none = setup();
  const plain = await none.api.handle(get("/v1/health", { headers: { origin: "https://site.example" } }));
  assert.equal(plain.headers["Access-Control-Allow-Origin"], undefined);
  none.close();

  const h = setup({ cors: { allowedOrigins: ["https://site.example"] } });
  const allowed = await h.api.handle(get("/v1/health", { headers: { origin: "https://site.example" } }));
  assert.equal(allowed.headers["Access-Control-Allow-Origin"], "https://site.example");
  assert.equal(allowed.headers["Vary"], "Origin");
  assert.equal(allowed.headers["Access-Control-Allow-Credentials"], undefined, "credentials are never allowed");
  const denied = await h.api.handle(get("/v1/health", { headers: { origin: "https://evil.example" } }));
  assert.equal(denied.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(denied.headers["Vary"], "Origin");

  const pre = await h.api.handle(req("OPTIONS", "/v1/challenges", undefined, { headers: { origin: "https://site.example", "access-control-request-method": "POST" } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers["Access-Control-Allow-Origin"], "https://site.example");
  assert.match(pre.headers["Access-Control-Allow-Headers"]!, /Content-Type/);
  const preDenied = await h.api.handle(req("OPTIONS", "/v1/challenges", undefined, { headers: { origin: "https://evil.example" } }));
  assert.equal(preDenied.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(preDenied.headers["Access-Control-Allow-Methods"], undefined);
  h.close();

  const star = setup({ cors: { allowedOrigins: "*" } });
  assert.equal((await star.api.handle(get("/v1/health", { headers: { origin: "https://any.example" } }))).headers["Access-Control-Allow-Origin"], "*");
  star.close();
});

// ------------------------------------------------- metrics and admin routes

test("metrics: hidden unless configured, token protected, JSON and Prometheus formats", async () => {
  const off = setup();
  assert.equal((await off.api.handle(get("/v1/metrics"))).status, 404);
  off.close();

  const h = setup({ metricsToken: "metrics-token-metrics-token" });
  assert.equal((await h.api.handle(get("/v1/metrics"))).status, 401);
  assert.equal((await h.api.handle(get("/v1/metrics", { headers: { authorization: "Bearer wrong" } }))).status, 401);

  await solve(h);
  await createMeme(h);
  const ok = await h.api.handle(get("/v1/metrics", { headers: { authorization: "Bearer metrics-token-metrics-token" } }));
  assert.equal(ok.status, 200);
  const m = ok.json as any;
  assert.equal(m.challengesCreated["meme-puzzle"], 2);
  assert.equal(m.verifications["success"], 1);

  const prom = await h.api.handle(get("/v1/metrics", { headers: { authorization: "Bearer metrics-token-metrics-token" }, query: { format: "prometheus" } }));
  const text = prom.raw!.toString("utf8");
  assert.match(text, /oorable_challenges_created_total\{type="meme-puzzle"\} 2/);
  assert.match(text, /# TYPE oorable_verifications_total counter/);
  h.close();
});

test("admin asset listing exposes ids and labels only and needs its own token", async () => {
  const off = setup();
  assert.equal((await off.api.handle(get("/v1/admin/assets"))).status, 404);
  off.close();

  const h = setup({ adminToken: "admin-token-admin-token-admin" });
  assert.equal((await h.api.handle(get("/v1/admin/assets"))).status, 401);
  const ok = await h.api.handle(get("/v1/admin/assets", { headers: { authorization: "Bearer admin-token-admin-token-admin" } }));
  assert.equal(ok.status, 200);
  const body = ok.json as any;
  assert.equal(body.count, 4);
  assert.deepEqual(Object.keys(body.images[0]).sort(), ["id", "label"]);
  assert.ok(!/solution|correct|tile|token|answer/i.test(JSON.stringify(body)));
  // There is deliberately no route that could return solutions, and no write route.
  for (const path of ["/v1/admin/solutions", "/v1/admin/challenges", "/v1/admin/assets/upload"]) {
    assert.equal((await h.api.handle(get(path, { headers: { authorization: "Bearer admin-token-admin-token-admin" } }))).status, 404);
  }
  h.close();
});

// ------------------------------------------------- errors and log hygiene

test("internal failures return a generic 500 and never leak the underlying error", async () => {
  const store = new MemoryChallengeStore({ sweepIntervalMs: 60_000 });
  store.create = async () => {
    throw new Error("secret-internal-detail: db password hunter2");
  };
  const h = setup({}, store);
  const res = await createMeme(h);
  assert.equal(res.res.status, 500);
  assert.deepEqual(res.res.json, { error: "internal_error" });
  assert.ok(!JSON.stringify(res.res).includes("hunter2"));
  const errorEvent = h.events.find((e) => e.name === "error");
  assert.deepEqual(errorEvent, { name: "error", route: "/v1/challenges", errorName: "Error" }, "events carry the error class, not its message");
  h.close();
});

test("a full store surfaces as 503 with Retry-After, not a crash", async () => {
  const store = new MemoryChallengeStore({ sweepIntervalMs: 60_000 });
  store.create = async () => {
    throw new CapacityError("full");
  };
  const h = setup({}, store);
  const res = await createMeme(h);
  assert.equal(res.res.status, 503);
  assert.equal(res.res.headers["Retry-After"], "5");
  h.close();
});

test("request events never contain answers, tokens, tile tokens or challenge ids", async () => {
  const h = setup();
  const { created, token } = await solve(h);
  const tile = created.challenge.tiles[0];
  await h.api.handle(get(tile.assetUrl));
  await h.api.handle(post("/v1/tokens/verify", { token }));

  const serialized = JSON.stringify(h.events);
  assert.ok(!serialized.includes(token), "verification token");
  assert.ok(!serialized.includes(tile.token), "tile token");
  assert.ok(!serialized.includes(created.challengeId), "challenge id");
  assert.ok(!serialized.includes("203.0.113.7"), "client address");
  assert.ok(serialized.includes("/v1/assets/tile/:token"), "routes are logged as templates");
  for (const e of h.events) assert.ok(["request", "error"].includes(e.name));
  h.close();
});
