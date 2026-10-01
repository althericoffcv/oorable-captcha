import { randomBytes, randomInt } from "node:crypto";

/**
 * Cryptographically secure helpers used throughout the engine.
 *
 * Never use Math.random() for anything that touches challenge ids,
 * tile shuffling, token nonces, or codes -- Math.random() is not a
 * CSPRNG in Node and predictable shuffles/ids are exactly what let an
 * attacker skip solving the puzzle. Every function here is backed by
 * node:crypto.
 */

/** An opaque, URL-safe random identifier. */
export function secureRandomId(byteLength = 16): string {
  return randomBytes(byteLength).toString("base64url");
}

/** A uniformly distributed integer in [minInclusive, maxExclusive), no modulo bias. */
export function secureRandomInt(minInclusive: number, maxExclusive: number): number {
  if (maxExclusive <= minInclusive) {
    throw new RangeError("maxExclusive must be greater than minInclusive");
  }
  return minInclusive + randomInt(maxExclusive - minInclusive);
}

/**
 * Cryptographically secure Fisher-Yates shuffle. Returns a new array;
 * never mutates the input. This is what makes tile layouts and image
 * ordering unpredictable per RFC "no predictable answer mapping".
 */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** A numeric code of the given digit length, using rejection-free secure random digits. */
export function secureNumericCode(digits: number): string {
  let out = "";
  for (let i = 0; i < digits; i++) {
    out += secureRandomInt(0, 10).toString();
  }
  return out;
}

// Visually ambiguous characters are removed by default: 0 and O, 1 and
// I and L. That leaves 31 symbols (~4.95 bits per character), so the
// entropy cost is negligible next to the readability win.
const DEFAULT_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function secureAlphanumericCode(length: number, alphabet: string = DEFAULT_ALPHABET): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[secureRandomInt(0, alphabet.length)];
  }
  return out;
}
