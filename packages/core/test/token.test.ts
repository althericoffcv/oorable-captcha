import { test } from "node:test";
import { secretOf } from "./helpers.ts";
import { ConfigurationError } from "../src/errors.ts";
import assert from "node:assert/strict";
import { StaticKeyProvider, signToken, verifyToken } from "../src/crypto/token.ts";

test("signed token verifies with the correct key", () => {
  const keys = new StaticKeyProvider({ k1: secretOf("test-secret-one") }, "k1");
  const token = signToken({ challengeId: "abc", type: "text", iat: Date.now(), exp: Date.now() + 1000 }, keys);
  const result = verifyToken(token, keys);
  assert.equal(result.valid, true);
});

test("tampering with the payload invalidates the token", () => {
  const keys = new StaticKeyProvider({ k1: secretOf("test-secret-one") }, "k1");
  const token = signToken({ challengeId: "abc", type: "text", iat: Date.now(), exp: Date.now() + 1000 }, keys);
  const [v, keyId, payload, sig] = token.split(".");
  const tampered = [v, keyId, payload!.slice(0, -2) + "aa", sig].join(".");
  const result = verifyToken(tampered, keys);
  assert.equal(result.valid, false);
});

test("expired tokens are rejected", () => {
  const keys = new StaticKeyProvider({ k1: secretOf("test-secret-one") }, "k1");
  const token = signToken({ challengeId: "abc", type: "text", iat: Date.now() - 5000, exp: Date.now() - 1000 }, keys);
  const result = verifyToken(token, keys);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "expired");
});

test("rotation: old tokens still verify against a retired key, new tokens use the active key", () => {
  const keysV1 = new StaticKeyProvider({ k1: secretOf("secret-v1") }, "k1");
  const oldToken = signToken({ challengeId: "abc", type: "text", iat: Date.now(), exp: Date.now() + 60_000 }, keysV1);

  const keysV2 = new StaticKeyProvider({ k1: secretOf("secret-v1"), k2: secretOf("secret-v2") }, "k2");
  assert.equal(verifyToken(oldToken, keysV2).valid, true);

  const newToken = signToken({ challengeId: "def", type: "text", iat: Date.now(), exp: Date.now() + 60_000 }, keysV2);
  assert.ok(newToken.startsWith("v1.k2."));
});

test("unknown key id is rejected", () => {
  const keys = new StaticKeyProvider({ k1: secretOf("secret") }, "k1");
  const token = signToken({ challengeId: "abc", type: "text", iat: Date.now(), exp: Date.now() + 1000 }, keys);
  const otherKeys = new StaticKeyProvider({ other: secretOf("secret") }, "other");
  const result = verifyToken(token, otherKeys);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "unknown_key");
});

test("malformed tokens are rejected without throwing", () => {
  const keys = new StaticKeyProvider({ k1: secretOf("secret") }, "k1");
  for (const bad of ["", "not-a-token", "v1.k1.onlythree", "v2.k1.x.y"]) {
    const result = verifyToken(bad, keys);
    assert.equal(result.valid, false);
  }
});

test("key provider: refuses short secrets and malformed key ids, without echoing the secret", () => {
  const short = "short-secret";
  assert.throws(
    () => new StaticKeyProvider({ k1: short }, "k1"),
    (err: unknown) => {
      assert.ok(err instanceof ConfigurationError);
      assert.ok(!err.message.includes(short), "the secret must not appear in the error message");
      assert.match(err.message, /at least 32 bytes/);
      return true;
    },
  );
  assert.throws(() => new StaticKeyProvider({ "bad.id": secretOf("x") }, "bad.id"), ConfigurationError);
  assert.throws(() => new StaticKeyProvider({ "has space": secretOf("x") }, "has space"), ConfigurationError);
  assert.throws(() => new StaticKeyProvider({ k1: secretOf("x") }, "missing"), ConfigurationError);
  assert.doesNotThrow(() => new StaticKeyProvider({ k1: secretOf("x") }, "k1"));
  assert.doesNotThrow(() => new StaticKeyProvider({ k1: Buffer.alloc(32, 7) }, "k1"));
  assert.throws(() => new StaticKeyProvider({ k1: Buffer.alloc(31, 7) }, "k1"), ConfigurationError);
});
