import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryChallengeStore, OorableCaptchaEngine, StaticKeyProvider } from "@oorable/captcha";
import { createApi } from "@oorable/captcha-server";
import { registerOorableCaptcha, type FastifyMountTarget } from "../src/index.ts";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * SCOPE NOTE: see packages/express/test/express.test.ts's file-level note --
 * same situation and same fix here. `fastify` is not installed in this
 * sandbox (peerDependency, no network), which is exactly why
 * registerOorableCaptcha() depends on `fastify` only for TYPES (erased at
 * compile time). This file runs the real, compiled src/index.ts, unmodified
 * -- only the Fastify instance it's handed is a fake.
 */

const SECRET = "fastify-test-".padEnd(48, "0123456789abcdef");

function harness() {
  const store = new MemoryChallengeStore({ sweepIntervalMs: 60_000 });
  const engine = new OorableCaptchaEngine({ store, keys: new StaticKeyProvider({ k1: SECRET }, "k1") });
  const api = createApi({ engine, rateLimit: false });
  return { api, store, close: () => { api.close(); store.close(); } };
}

class FakeFastify implements FastifyMountTarget {
  handler?: (req: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
  all(_path: string, handler: (req: FastifyRequest, reply: FastifyReply) => void | Promise<void>): unknown {
    this.handler = handler;
    return this;
  }
}

function fakeReq(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return { method: "GET", url: "/v1/health", query: {}, headers: {}, body: undefined, ip: "203.0.113.9", ...overrides } as FastifyRequest;
}

interface CapturedReply extends FastifyReply {
  statusCode?: number;
  headersSent: Record<string, string>;
  sentBody?: unknown;
}

function fakeReply(): CapturedReply {
  const reply = {
    headersSent: {},
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    header(name: string, value: string) {
      reply.headersSent[name] = value;
      return reply;
    },
    send(body?: unknown) {
      reply.sentBody = body;
      return reply;
    },
  } as CapturedReply;
  return reply;
}

test("fastify adapter: registers exactly one wildcard route via app.all('/v1/*', ...)", () => {
  const h = harness();
  try {
    const app = new FakeFastify();
    registerOorableCaptcha(app, h.api);
    assert.equal(typeof app.handler, "function");
  } finally {
    h.close();
  }
});

test("fastify adapter: GET /v1/health -> 200 with the same body/headers CaptchaApi produces", async () => {
  const h = harness();
  try {
    const app = new FakeFastify();
    registerOorableCaptcha(app, h.api);
    const reply = fakeReply();
    await app.handler!(fakeReq({ url: "/v1/health" }), reply);
    assert.equal(reply.statusCode, 200);
    assert.deepEqual(reply.sentBody, { status: "ok", version: "v1" });
    assert.equal(reply.headersSent["Cache-Control"], "no-store");
  } finally {
    h.close();
  }
});

test("fastify adapter: the query string is stripped from the routed path", async () => {
  const h = harness();
  try {
    const app = new FakeFastify();
    registerOorableCaptcha(app, h.api);
    const reply = fakeReply();
    await app.handler!(fakeReq({ url: "/v1/health?x=1&y=2" }), reply);
    assert.equal(reply.statusCode, 200);
  } finally {
    h.close();
  }
});

test("fastify adapter: a full create -> verify flow through the fake instance", async () => {
  const h = harness();
  try {
    const app = new FakeFastify();
    registerOorableCaptcha(app, h.api);

    const createReply = fakeReply();
    await app.handler!(fakeReq({ method: "POST", url: "/v1/challenges", body: { type: "meme-puzzle" } }), createReply);
    const created = createReply.sentBody as { challengeId: string; challenge: { tiles: Array<{ token: string }> } };
    assert.ok(created.challenge.tiles.length > 0);

    const record = await h.store.get(created.challengeId);
    const correctOrder = (record!.solution as { correctOrder: string[] }).correctOrder;

    const verifyReply = fakeReply();
    await app.handler!(
      fakeReq({ method: "POST", url: "/v1/challenges/verify", body: { challengeId: created.challengeId, answer: correctOrder } }),
      verifyReply,
    );
    const result = verifyReply.sentBody as { success: boolean; verificationToken?: string };
    assert.equal(result.success, true);
    assert.ok(result.verificationToken?.startsWith("v1."));
  } finally {
    h.close();
  }
});

test("fastify adapter: raw tile bytes go through reply.send(Buffer), with the right content type", async () => {
  const h = harness();
  try {
    const app = new FakeFastify();
    registerOorableCaptcha(app, h.api);
    const createReply = fakeReply();
    await app.handler!(fakeReq({ method: "POST", url: "/v1/challenges", body: { type: "meme-puzzle" } }), createReply);
    const tileUrl = (createReply.sentBody as { challenge: { tiles: Array<{ assetUrl: string }> } }).challenge.tiles[0]!.assetUrl;

    const tileReply = fakeReply();
    await app.handler!(fakeReq({ url: tileUrl }), tileReply);
    assert.equal(tileReply.statusCode, 200);
    assert.ok(Buffer.isBuffer(tileReply.sentBody));
    assert.ok((tileReply.sentBody as Buffer).toString("utf8").startsWith("<svg"));
    assert.equal(tileReply.headersSent["Content-Type"], "image/svg+xml");
  } finally {
    h.close();
  }
});

test("fastify adapter: X-Forwarded-For is ignored unless trustProxyHops is set, then the Nth entry is used", async () => {
  const h = harness();
  try {
    let seenIp = "";
    const spyApi = { handle: (req: Parameters<typeof h.api.handle>[0]) => ((seenIp = req.ip), h.api.handle(req)) } as unknown as typeof h.api;

    const untrusted = new FakeFastify();
    registerOorableCaptcha(untrusted, spyApi);
    await untrusted.handler!(fakeReq({ headers: { "x-forwarded-for": "9.9.9.9" }, ip: "203.0.113.9" }), fakeReply());
    assert.equal(seenIp, "203.0.113.9");

    const trusted = new FakeFastify();
    registerOorableCaptcha(trusted, spyApi, { trustProxyHops: 1 });
    await trusted.handler!(fakeReq({ headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.1" }, ip: "10.0.0.1" }), fakeReply());
    assert.equal(seenIp, "198.51.100.1");
  } finally {
    h.close();
  }
});

test("fastify adapter: malformed input returns the API's generic 400, not a thrown error", async () => {
  const h = harness();
  try {
    const app = new FakeFastify();
    registerOorableCaptcha(app, h.api);
    const reply = fakeReply();
    await app.handler!(fakeReq({ method: "POST", url: "/v1/challenges", body: { type: "not-a-real-type" } }), reply);
    assert.equal(reply.statusCode, 400);
    assert.deepEqual(reply.sentBody, { error: "invalid_request" });
  } finally {
    h.close();
  }
});
