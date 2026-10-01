import { createHmac, timingSafeEqual } from "node:crypto";
import { secureRandomId } from "./random.ts";
import { ConfigurationError } from "../errors.ts";

/**
 * OORABLE CAPTCHA verification tokens.
 *
 * Format: v1.<keyId>.<base64url(payload)>.<base64url(hmac-sha256)>
 *
 * The payload NEVER contains challenge answers or other solution data --
 * only the minimum claims needed to prove "this specific challenge was
 * solved, once, before this timestamp". See docs/security.md for the
 * full token format and threat model, and docs/deployment.md for the
 * key rotation runbook.
 */

export interface TokenPayload {
  /** The challenge this token proves was solved. */
  challengeId: string;
  /** Challenge type, echoed for the relying party's convenience. */
  type: string;
  /** Optional site/application identifier the challenge was issued for. */
  siteKey?: string;
  /** Optional session binding. */
  sessionId?: string;
  /** Issued-at, unix ms. */
  iat: number;
  /** Expiry, unix ms. */
  exp: number;
  /** Random per-token nonce so two tokens for the same challenge never collide. */
  nonce: string;
  /** Fixed purpose string; defends against cross-purpose token confusion if this token format is ever reused elsewhere. */
  purpose: "oorable-captcha-verification";
}

export interface SigningKey {
  id: string;
  /** Raw secret bytes. Never log, serialize, or echo this value. */
  secret: Buffer;
}

export interface KeyProvider {
  getActiveKey(): SigningKey;
  getKeyById(id: string): SigningKey | undefined;
}

/** Key ids are embedded in dot-delimited tokens, so they must be simple, delimiter-free strings. */
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * An HMAC key shorter than its hash output is weaker than the primitive
 * promises, and a short human-chosen secret can be brute-forced offline
 * from a single captured token. Refuse to start with one.
 */
export const MIN_SECRET_BYTES = 32;

/**
 * Simple in-process key provider. Supports rotation: keep retired
 * key(s) in `keys` so tokens signed before a rotation still verify,
 * while every new token is signed with `activeKeyId`. See
 * docs/deployment.md for the recommended rotation sequence.
 */
export class StaticKeyProvider implements KeyProvider {
  private readonly keys: Map<string, Buffer>;
  private readonly activeKeyId: string;

  constructor(keys: Record<string, string | Buffer>, activeKeyId: string) {
    if (!keys[activeKeyId]) {
      throw new ConfigurationError(`StaticKeyProvider: activeKeyId "${activeKeyId}" is not present in keys`);
    }
    const parsed = new Map<string, Buffer>();
    for (const [id, secret] of Object.entries(keys)) {
      if (!KEY_ID_PATTERN.test(id)) {
        throw new ConfigurationError(`StaticKeyProvider: key id "${id}" must match ${KEY_ID_PATTERN}`);
      }
      const buf = Buffer.isBuffer(secret) ? secret : Buffer.from(secret, "utf8");
      if (buf.length < MIN_SECRET_BYTES) {
        // Deliberately reports the key *id* and the requirement, never the secret itself.
        throw new ConfigurationError(
          `StaticKeyProvider: secret for key "${id}" must be at least ${MIN_SECRET_BYTES} bytes. Run \`npx oorable-captcha init\` to generate one.`,
        );
      }
      parsed.set(id, buf);
    }
    this.keys = parsed;
    this.activeKeyId = activeKeyId;
  }

  getActiveKey(): SigningKey {
    return { id: this.activeKeyId, secret: this.keys.get(this.activeKeyId)! };
  }

  getKeyById(id: string): SigningKey | undefined {
    const secret = this.keys.get(id);
    return secret ? { id, secret } : undefined;
  }
}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

function sign(payload: Buffer, secret: Buffer): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/**
 * Constant-time buffer comparison, safe to call with attacker-controlled
 * input. Comparing lengths first does not leak the secret -- signature
 * length is fixed by the algorithm and therefore already public; only
 * the *content* comparison of equal-length buffers needs to run in
 * constant time, which is what timingSafeEqual guarantees.
 */
function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signToken(claims: Omit<TokenPayload, "nonce" | "purpose">, keys: KeyProvider): string {
  const key = keys.getActiveKey();
  const payload: TokenPayload = {
    ...claims,
    nonce: secureRandomId(12),
    purpose: "oorable-captcha-verification",
  };
  const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = sign(payloadBuf, key.secret);
  return `v1.${key.id}.${base64url(payloadBuf)}.${base64url(sig)}`;
}

export type TokenVerifyResult =
  | { valid: true; payload: TokenPayload }
  | {
      valid: false;
      reason: "malformed" | "unknown_key" | "bad_signature" | "expired" | "wrong_purpose";
    };

/** Real tokens are a few hundred bytes; anything far larger is hostile input, so refuse it before doing any work. */
const MAX_TOKEN_LENGTH = 2048;

export function verifyToken(token: string, keys: KeyProvider): TokenVerifyResult {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { valid: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    return { valid: false, reason: "malformed" };
  }
  const [, keyId, payloadB64, sigB64] = parts as [string, string, string, string];
  const key = keys.getKeyById(keyId);
  if (!key) {
    return { valid: false, reason: "unknown_key" };
  }

  let payloadBuf: Buffer;
  let providedSig: Buffer;
  try {
    payloadBuf = Buffer.from(payloadB64, "base64url");
    providedSig = Buffer.from(sigB64, "base64url");
  } catch {
    return { valid: false, reason: "malformed" };
  }

  const expectedSig = sign(payloadBuf, key.secret);
  if (!safeEqual(expectedSig, providedSig)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (payload.purpose !== "oorable-captcha-verification") {
    return { valid: false, reason: "wrong_purpose" };
  }
  if (Date.now() > payload.exp) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
