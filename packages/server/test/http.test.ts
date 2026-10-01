import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { MemoryChallengeStore, OorableCaptchaEngine, StaticKeyProvider } from "@oorable/captcha";
import { createApi, startServer, type ApiOptions, type StartServerOptions } from "../src/index.ts";

const SECRET = "http-test-".padEnd(48, "0123456789abcdef");

async function boot(apiOptions: Partial<ApiOptions> = {}, serverOptions: StartServerOptions = {}) {
  const store = new MemoryChallengeStore({ sweepIntervalMs: 60_000 });
  const engine = new OorableCaptchaEngine({ store, keys: new StaticKeyProvider({ k1: SECRET }, "k1") });
  const api = createApi({ engine, ...apiOptions });
  const server = await startServer(api, serverOptions);
  return {
    api,
    store,
    url: server.url,
    close: async () => {
      await server.close();
      api.close();
      store.close();
    },
  };
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
  json: any;
}

function request(base: string, method: string, path: string, opts: { headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, method, path, headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const text = body.toString("utf8");
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text, json });
      });
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

const postJson = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  request(base, "POST", path, { headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** Sends `total` bytes with chunked transfer encoding and no Content-Length, so the size cannot be pre-checked. */
function chunkedPost(base: string, path: string, total: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path,
      method: "POST",
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
    });
    let answered = false;
    req.on("response", (res) => {
      answered = true;
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", (err) => {
      if (!answered) reject(err);
    });
    const chunk = Buffer.alloc(4096, "a");
    let sent = 0;
    const pump = () => {
      while (sent < total && !answered) {
        if (!req.write(chunk)) {
          req.once("drain", pump);
          return;
        }
        sent += chunk.length;
      }
      if (!answered) req.end();
    };
    pump();
  });
}

function rawExchange(base: string, payload: Buffer | string, waitMs = 1000): Promise<string> {
  return new Promise((resolve) => {
    const u = new URL(base);
    const socket = net.connect({ host: u.hostname, port: Number(u.port) }, () => socket.write(payload));
    const chunks: Buffer[] = [];
    const finish = () => {
      socket.destroy();
      resolve(Buffer.concat(chunks).toString("latin1"));
    };
    socket.on("data", (c: Buffer | string) => chunks.push(Buffer.from(c)));
    socket.on("close", finish);
    socket.on("error", finish);
    setTimeout(finish, waitMs);
  });
}

test("http: the documented flow works end to end over a real socket", async () => {
  const h = await boot();
  try {
    const created = await postJson(h.url, "/v1/challenges", { type: "meme-puzzle", difficulty: "medium", siteKey: "public-site-key" });
    assert.equal(created.status, 201);
    assert.match(String(created.headers["content-type"]), /^application\/json; charset=utf-8$/);
    assert.equal(created.headers["cache-control"], "no-store");
    assert.equal(created.headers["x-content-type-options"], "nosniff");
    assert.equal(Number(created.headers["content-length"]), created.body.length);

    const { challengeId, challenge } = created.json;
    assert.equal(challenge.tiles.length, 9);
    const solution = (await h.store.get(challengeId))!.solution as { correctOrder: string[] };

    const wrong = await postJson(h.url, "/v1/challenges/verify", { challengeId, answer: challenge.tiles.map((t: any) => t.token), siteKey: "public-site-key" });
    assert.deepEqual(wrong.json, { success: false, reason: "incorrect" });

    const right = await postJson(h.url, "/v1/challenges/verify", { challengeId, answer: solution.correctOrder, siteKey: "public-site-key" });
    assert.equal(right.json.success, true);
    assert.equal(right.json.expiresIn, 120);

    const redeemed = await postJson(h.url, "/v1/tokens/verify", { token: right.json.verificationToken, siteKey: "public-site-key" });
    assert.equal(redeemed.json.valid, true);
    assert.deepEqual((await postJson(h.url, "/v1/tokens/verify", { token: right.json.verificationToken })).json, { valid: false, reason: "already_redeemed" });
  } finally {
    await h.close();
  }
});

test("http: tiles arrive as raw bytes with matching length and hardening headers", async () => {
  const h = await boot();
  try {
    const created = (await postJson(h.url, "/v1/challenges", { type: "meme-puzzle" })).json;
    const tile = await request(h.url, "GET", created.challenge.tiles[0].assetUrl);
    assert.equal(tile.status, 200);
    assert.equal(tile.headers["content-type"], "image/svg+xml");
    assert.equal(Number(tile.headers["content-length"]), tile.body.length);
    assert.equal(tile.headers["content-security-policy"], "default-src 'none'; sandbox");
    assert.ok(tile.text.startsWith("<svg"));
    assert.equal((await request(h.url, "GET", "/v1/assets/tile/t1.k1.AAAA")).status, 404);
  } finally {
    await h.close();
  }
});

test("http: only application/json bodies are accepted", async () => {
  const h = await boot();
  try {
    const send = (contentType: string | undefined) =>
      request(h.url, "POST", "/v1/challenges", {
        headers: contentType ? { "content-type": contentType } : {},
        body: JSON.stringify({ type: "meme-puzzle" }),
      });
    assert.equal((await send("text/plain")).status, 415);
    assert.equal((await send("application/x-www-form-urlencoded")).status, 415);
    assert.equal((await send("application/jsonx")).status, 415);
    assert.equal((await send(undefined)).status, 415);
    assert.equal((await send("application/json")).status, 201);
    assert.equal((await send("application/json; charset=utf-8")).status, 201);
    assert.equal((await send("APPLICATION/JSON")).status, 201);
  } finally {
    await h.close();
  }
});

test("http: oversized bodies are refused whether or not the size is declared up front", async () => {
  const h = await boot({ rateLimit: false });
  try {
    const declared = await request(h.url, "POST", "/v1/challenges", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "meme-puzzle", pad: "x".repeat(100_000) }),
    });
    assert.equal(declared.status, 413);
    assert.deepEqual(declared.json, { error: "payload_too_large" });

    assert.equal(await chunkedPost(h.url, "/v1/challenges", 200_000), 413, "chunked upload with no Content-Length");

    // The server is still healthy afterwards.
    assert.equal((await request(h.url, "GET", "/v1/health")).status, 200);
  } finally {
    await h.close();
  }
});

test("http: the body limit is configurable", async () => {
  const h = await boot({ rateLimit: false }, { maxBodyBytes: 64 });
  try {
    assert.equal((await postJson(h.url, "/v1/challenges", { type: "meme-puzzle" })).status, 201);
    assert.equal((await postJson(h.url, "/v1/challenges", { type: "meme-puzzle", pad: "x".repeat(200) })).status, 413);
  } finally {
    await h.close();
  }
});

test("http: malformed JSON is a 400, and __proto__ keys cannot pollute anything", async () => {
  const h = await boot({ rateLimit: false });
  try {
    for (const bad of ["{bad json", "", "undefined", '{"type":', "[[[[[[[[[[[[[[["]) {
      const res = await request(h.url, "POST", "/v1/challenges", { headers: { "content-type": "application/json" }, body: bad });
      assert.equal(res.status, 400, JSON.stringify(bad));
      assert.deepEqual(res.json, { error: "invalid_request" });
    }
    const poisoned = await request(h.url, "POST", "/v1/challenges", {
      headers: { "content-type": "application/json" },
      body: '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"type":"meme-puzzle"}',
    });
    assert.equal(poisoned.status, 201);
    assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"), false);
  } finally {
    await h.close();
  }
});

test("http: a client that trickles its body is cut off with 408 (slowloris)", async () => {
  const h = await boot({}, { bodyTimeoutMs: 150 });
  try {
    const started = Date.now();
    const reply = await rawExchange(
      h.url,
      "POST /v1/challenges HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 50\r\n\r\n{",
      2000,
    );
    assert.match(reply, /^HTTP\/1\.1 408 /);
    assert.ok(Date.now() - started < 1500, "the server answered promptly instead of waiting on the client");
    assert.equal((await request(h.url, "GET", "/v1/health")).status, 200, "and it keeps serving others");
  } finally {
    await h.close();
  }
});

test("http: random garbage on the socket does not hurt the server", async () => {
  const h = await boot();
  try {
    const noise = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) & 255));
    const reply = await rawExchange(h.url, noise, 500);
    assert.ok(reply === "" || reply.startsWith("HTTP/1.1 400"), "closed or answered 400");
    await rawExchange(h.url, "GET /v1/health HTTP/1.1\r\nHost: x\r\nX-Junk: " + "a".repeat(100_000) + "\r\n\r\n", 500);
    assert.equal((await request(h.url, "GET", "/v1/health")).status, 200);
  } finally {
    await h.close();
  }
});

test("http: X-Forwarded-For cannot be used to dodge rate limits unless proxies are explicitly trusted", async () => {
  const limits = { rateLimit: { createPerIp: { limit: 2, windowMs: 60_000 } } };

  const untrusted = await boot(limits);
  try {
    const codes: number[] = [];
    for (let i = 1; i <= 4; i++) {
      codes.push((await postJson(untrusted.url, "/v1/challenges", { type: "meme-puzzle" }, { "x-forwarded-for": `198.51.100.${i}` })).status);
    }
    assert.deepEqual(codes, [201, 201, 429, 429], "rotating the header buys nothing");
  } finally {
    await untrusted.close();
  }

  const trusted = await boot(limits, { trustProxyHops: 1 });
  try {
    const distinct: number[] = [];
    for (let i = 1; i <= 4; i++) {
      distinct.push((await postJson(trusted.url, "/v1/challenges", { type: "meme-puzzle" }, { "x-forwarded-for": `198.51.100.${i}` })).status);
    }
    assert.deepEqual(distinct, [201, 201, 201, 201], "with one trusted proxy, the address it reports is the client");

    const same: number[] = [];
    for (let i = 0; i < 3; i++) {
      same.push((await postJson(trusted.url, "/v1/challenges", { type: "meme-puzzle" }, { "x-forwarded-for": "203.0.113.50" })).status);
    }
    assert.deepEqual(same, [201, 201, 429]);

    // A spoofed leftmost entry does not help: only the entry our proxy appended counts.
    const spoof: number[] = [];
    for (let i = 0; i < 3; i++) {
      spoof.push((await postJson(trusted.url, "/v1/challenges", { type: "meme-puzzle" }, { "x-forwarded-for": `6.6.6.${i}, 203.0.113.99` })).status);
    }
    assert.deepEqual(spoof, [201, 201, 429]);
  } finally {
    await trusted.close();
  }
});

test("http: unsupported methods and odd URLs get clean errors", async () => {
  const h = await boot();
  try {
    const del = await request(h.url, "DELETE", "/v1/challenges");
    assert.equal(del.status, 405);
    assert.equal(del.headers["allow"], "POST");
    assert.equal((await request(h.url, "GET", "/v1/challenges")).status, 405);
    assert.equal((await request(h.url, "PUT", "/v1/health")).status, 405);
    assert.equal((await request(h.url, "GET", "//v1/health")).status, 404);
    assert.equal((await request(h.url, "GET", "/v1/%68ealth")).status, 404, "paths are matched literally, never decoded");
    assert.equal((await request(h.url, "GET", "/v1/health?x=%zz&&=")).status, 200);
    assert.equal((await request(h.url, "GET", "/")).status, 404);
  } finally {
    await h.close();
  }
});

test("http: CORS preflight is answered without a body", async () => {
  const h = await boot({ cors: { allowedOrigins: ["https://site.example"] } });
  try {
    const pre = await request(h.url, "OPTIONS", "/v1/challenges", {
      headers: { origin: "https://site.example", "access-control-request-method": "POST" },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.body.length, 0);
    assert.equal(pre.headers["access-control-allow-origin"], "https://site.example");
    assert.match(String(pre.headers["access-control-allow-methods"]), /POST/);

    const actual = await postJson(h.url, "/v1/challenges", { type: "meme-puzzle" }, { origin: "https://site.example" });
    assert.equal(actual.headers["access-control-allow-origin"], "https://site.example");
    const foreign = await postJson(h.url, "/v1/challenges", { type: "meme-puzzle" }, { origin: "https://evil.example" });
    assert.equal(foreign.headers["access-control-allow-origin"], undefined);
  } finally {
    await h.close();
  }
});

test("http: 30 simultaneous verifications of one correct answer yield exactly one success", async () => {
  const h = await boot({ rateLimit: false });
  try {
    const created = (await postJson(h.url, "/v1/challenges", { type: "meme-puzzle" })).json;
    const { correctOrder } = (await h.store.get(created.challengeId))!.solution as { correctOrder: string[] };
    const replies = await Promise.all(
      Array.from({ length: 30 }, () => postJson(h.url, "/v1/challenges/verify", { challengeId: created.challengeId, answer: correctOrder })),
    );
    assert.equal(replies.filter((r) => r.json.success === true).length, 1);
    assert.equal(replies.filter((r) => r.status !== 200).length, 0);
  } finally {
    await h.close();
  }
});

test("http: internal failures return a generic 500 body", async () => {
  const h = await boot();
  try {
    h.store.create = async () => {
      throw new Error("database password is hunter2");
    };
    const res = await postJson(h.url, "/v1/challenges", { type: "meme-puzzle" });
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: "internal_error" });
    assert.ok(!res.text.includes("hunter2"));
  } finally {
    await h.close();
  }
});
