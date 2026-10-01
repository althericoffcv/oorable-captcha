import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryChallengeStore, OorableCaptchaEngine, StaticKeyProvider } from "@oorable/captcha";
import { createApi } from "@oorable/captcha-server";
import { mountOorableCaptcha, type ExpressMountTarget } from "../src/index.ts";
import type { Request, Response } from "express";

/**
 * SCOPE NOTE: `express` itself is not installed in this sandbox (a
 * peerDependency, no network access here to fetch it). That is exactly why
 * mountOorableCaptcha() is written to depend on `express` only for TYPES
 * (`import type`, erased at compile time -- see src/index.ts) rather than
 * calling into the real module at runtime: this file imports and executes
 * the real compiled src/index.ts, unmodified, and genuinely runs it -- there
 * is no fake standing in for the code under test, only for the Express
 * app/Router it would normally be handed. The REST behavior itself
 * (validation, rate limiting, CORS, tile serving, ...) is covered
 * exhaustively against the same underlying CaptchaApi in
 * packages/server/test, including over real HTTP sockets. See
 * docs/testing.md for smoke-testing this against a real Express app.
 */

const SECRET = "express-test-".padEnd(48, "0123456789abcdef");

function harness() {
  const store = new MemoryChallengeStore({ sweepIntervalMs: 60_000 });
  const engine = new OorableCaptchaEngine({ store, keys: new StaticKeyProvider({ k1: SECRET }, "k1") });
  const api = createApi({ engine, rateLimit: false });
  return { api, store, close: () => { api.close(); store.close(); } };
}

/** A minimal stand-in for an Express app/Router: captures whatever handler mountOorableCaptcha() registers. */
class FakeExpressTarget implements ExpressMountTarget {
  handler?: (req: Request, res: Response) => void | Promise<void>;
  use(handler: (req: Request, res: Response) => void | Promise<void>): unknown {
    this.handler = handler;
    return this;
  }
}

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    path: "/v1/health",
    query: {},
    headers: {},
    body: undefined,
    socket: { remoteAddress: "203.0.113.9" },
    ...overrides,
  } as Request;
}

interface CapturedResponse extends Response {
  statusCode?: number;
  headersSent: Record<string, string>;
  jsonBody?: unknown;
  sentBody?: unknown;
}

function fakeRes(): CapturedResponse {
  const res = {
    headersSent: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headersSent[name] = value;
      return res;
    },
    json(body: unknown) {
      res.jsonBody = body;
      return res;
    },
    send(body?: unknown) {
      res.sentBody = body;
      return res;
    },
  } as CapturedResponse;
  return res;
}

test("express adapter: registers exactly one handler via target.use(...)", () => {
  const h = harness();
  try {
    const target = new FakeExpressTarget();
    mountOorableCaptcha(target, h.api);
    assert.equal(typeof target.handler, "function");
  } finally {
    h.close();
  }
});

test("express adapter: GET /v1/health -> 200 JSON with the same headers CaptchaApi produces", async () => {
  const h = harness();
  try {
    const target = new FakeExpressTarget();
    mountOorableCaptcha(target, h.api);
    const res = fakeRes();
    await target.handler!(fakeReq({ path: "/v1/health" }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.jsonBody, { status: "ok", version: "v1" });
    assert.equal(res.headersSent["Cache-Control"], "no-store");
    assert.equal(res.headersSent["X-Content-Type-Options"], "nosniff");
  } finally {
    h.close();
  }
});

test("express adapter: POST body is forwarded through unmodified (Express is expected to have already parsed it)", async () => {
  const h = harness();
  try {
    const target = new FakeExpressTarget();
    mountOorableCaptcha(target, h.api);
    const res = fakeRes();
    await target.handler!(fakeReq({ method: "POST", path: "/v1/challenges", body: { type: "text", length: 6 } }), res);
    assert.equal(res.statusCode, 201);
    const body = res.jsonBody as { challengeId: string; type: string };
    assert.equal(body.type, "text");
    assert.ok(body.challengeId);
  } finally {
    h.close();
  }
});

test("express adapter: a full create -> verify flow through the fake target, matching the real API contract", async () => {
  const h = harness();
  try {
    const target = new FakeExpressTarget();
    mountOorableCaptcha(target, h.api);

    const createRes = fakeRes();
    await target.handler!(fakeReq({ method: "POST", path: "/v1/challenges", body: { type: "meme-puzzle" } }), createRes);
    const created = createRes.jsonBody as { challengeId: string; challenge: { tiles: Array<{ token: string }> } };
    assert.ok(created.challenge.tiles.length > 0, "puzzle sizing policy itself is covered in packages/server/test/api.test.ts -- this test only checks the adapter's plumbing");

    const record = await h.store.get(created.challengeId);
    const correctOrder = (record!.solution as { correctOrder: string[] }).correctOrder;

    const verifyRes = fakeRes();
    await target.handler!(fakeReq({ method: "POST", path: "/v1/challenges/verify", body: { challengeId: created.challengeId, answer: correctOrder } }), verifyRes);
    const result = verifyRes.jsonBody as { success: boolean; verificationToken?: string };
    assert.equal(result.success, true);
    assert.ok(result.verificationToken?.startsWith("v1."));
  } finally {
    h.close();
  }
});

test("express adapter: raw bytes (tile images) go through res.send(), not res.json()", async () => {
  const h = harness();
  try {
    const target = new FakeExpressTarget();
    mountOorableCaptcha(target, h.api);

    const createRes = fakeRes();
    await target.handler!(fakeReq({ method: "POST", path: "/v1/challenges", body: { type: "meme-puzzle", grid: 2 } }), createRes);
    const tileUrl = (createRes.jsonBody as { challenge: { tiles: Array<{ assetUrl: string }> } }).challenge.tiles[0]!.assetUrl;

    const tileRes = fakeRes();
    await target.handler!(fakeReq({ path: tileUrl }), tileRes);
    assert.equal(tileRes.statusCode, 200);
    assert.equal(tileRes.jsonBody, undefined, "tiles must not go through res.json()");
    assert.ok(Buffer.isBuffer(tileRes.sentBody));
    assert.ok(tileRes.sentBody!.toString("utf8").startsWith("<svg"));
    assert.equal(tileRes.headersSent["Content-Type"], "image/svg+xml");
  } finally {
    h.close();
  }
});

test("express adapter: client IP falls back to the socket address when no proxy is trusted, even if X-Forwarded-For is present", async () => {
  const h = harness();
  try {
    let seenIp = "";
    const spyApi = { handle: (req: Parameters<typeof h.api.handle>[0]) => ((seenIp = req.ip), h.api.handle(req)) };
    const target = new FakeExpressTarget();
    mountOorableCaptcha(target, spyApi as unknown as typeof h.api);
    await target.handler!(
      fakeReq({ headers: { "x-forwarded-for": "9.9.9.9" }, socket: { remoteAddress: "203.0.113.9" } as Request["socket"] }),
      fakeRes(),
    );
    assert.equal(seenIp, "203.0.113.9", "X-Forwarded-For is ignored without trustProxyHops");
  } finally {
    h.close();
  }
});

test("express adapter: with trustProxyHops set, the Nth-from-right forwarded entry is used", async () => {
  const h = harness();
  try {
    let seenIp = "";
    const spyApi = { handle: (req: Parameters<typeof h.api.handle>[0]) => ((seenIp = req.ip), h.api.handle(req)) };
    const target = new FakeExpressTarget();
    mountOorableCaptcha(target, spyApi as unknown as typeof h.api, { trustProxyHops: 1 });
    await target.handler!(
      fakeReq({ headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.1" }, socket: { remoteAddress: "10.0.0.1" } as Request["socket"] }),
      fakeRes(),
    );
    assert.equal(seenIp, "198.51.100.1");
  } finally {
    h.close();
  }
});

test("express adapter: malformed input still returns the API's generic 400, not a thrown error", async () => {
  const h = harness();
  try {
    const target = new FakeExpressTarget();
    mountOorableCaptcha(target, h.api);
    const res = fakeRes();
    await target.handler!(fakeReq({ method: "POST", path: "/v1/challenges", body: { type: "not-a-real-type" } }), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.jsonBody, { error: "invalid_request" });
  } finally {
    h.close();
  }
});
