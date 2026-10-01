import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { KeyProvider } from "./token.ts";
import type { TileLocation } from "../assets/asset-provider.ts";

/**
 * Tile tokens: opaque, unforgeable, self-expiring handles for puzzle tiles.
 *
 * Format: t1.<keyId>.<base64url(iv[12] || ciphertext || gcm-tag[16])>
 *
 * Why encrypted rather than a lookup id?
 *  - The token must not reveal which grid slot a tile belongs to. AES-GCM
 *    with a random IV makes every token unique and unreadable even for the
 *    same tile, so nothing about position leaks from the string itself.
 *  - It is *stateless*: any server instance holding the signing key can
 *    resolve it, so there is no registry to grow without bound (memory
 *    DoS) or to keep consistent across processes.
 *  - The GCM tag makes it unforgeable: a client cannot mint a token that
 *    fetches an arbitrary file, only replay ones this server issued.
 *  - Expiry is inside the authenticated payload, so tile URLs die with
 *    the challenge.
 *
 * The encryption key is derived from the signing secret with HKDF using a
 * distinct `info` label, so a tile-token key is never the same bytes as
 * the HMAC key that signs verification tokens.
 */

const HKDF_INFO = Buffer.from("oorable-captcha/tile-token/v1", "utf8");
const MAX_TOKEN_LENGTH = 512;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function deriveKey(secret: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), HKDF_INFO, 32));
}

interface TilePayload {
  i: string;
  g: number;
  r: number;
  c: number;
  e: number;
}

export function sealTile(location: TileLocation, expiresAt: number, keys: KeyProvider): string {
  const key = keys.getActiveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(key.secret), iv);
  cipher.setAAD(Buffer.from(key.id, "utf8"));
  const payload: TilePayload = {
    i: location.imageId,
    g: location.grid,
    r: location.row,
    c: location.col,
    e: expiresAt,
  };
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `t1.${key.id}.${Buffer.concat([iv, ciphertext, tag]).toString("base64url")}`;
}

/** Returns the tile location, or undefined for anything malformed, forged, foreign-keyed or expired. Never throws. */
export function openTile(token: string, keys: KeyProvider, now: number = Date.now()): TileLocation | undefined {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "t1") return undefined;
  const [, keyId, body] = parts as [string, string, string];
  const key = keys.getKeyById(keyId);
  if (!key) return undefined;

  try {
    const raw = Buffer.from(body, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return undefined;
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

    const decipher = createDecipheriv("aes-256-gcm", deriveKey(key.secret), iv);
    decipher.setAAD(Buffer.from(key.id, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

    const p = JSON.parse(plaintext) as Partial<TilePayload>;
    if (
      typeof p.i !== "string" ||
      !Number.isInteger(p.g) ||
      !Number.isInteger(p.r) ||
      !Number.isInteger(p.c) ||
      typeof p.e !== "number"
    ) {
      return undefined;
    }
    if (now > p.e) return undefined;
    return { imageId: p.i, grid: p.g as number, row: p.r as number, col: p.c as number };
  } catch {
    // Bad base64, failed GCM authentication, invalid JSON: all just "not a valid token".
    return undefined;
  }
}
