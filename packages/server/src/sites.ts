import { createHash, timingSafeEqual } from "node:crypto";
import { ConfigurationError, type ChallengeType } from "@oorable/captcha";

export type Difficulty = "easy" | "medium" | "hard";

export interface SiteConfig {
  /** Public identifier, safe to embed in web pages and apps. */
  siteKey: string;
  /**
   * Server-side secret the site's own backend presents when redeeming
   * verification tokens (POST /v1/tokens/verify). Never ship it to a browser.
   * At least 24 characters.
   */
  secretKey?: string;
  /**
   * Browser origins allowed to use this site key, e.g. "https://example.com".
   * Enforced when a request carries an Origin header. This stops OTHER
   * WEBSITES from using your key in their visitors' browsers; it cannot stop
   * non-browser clients, which can send any Origin they like or none.
   */
  allowedOrigins?: string[];
  /** Challenge types this site may request. Default: every type the server has enabled. */
  allowedTypes?: ChallengeType[];
  /** Minimum meme-puzzle difficulty. Clients may ask for harder, never for easier. Default "medium". */
  difficulty?: Difficulty;
  /** Text challenge shape, chosen by the site -- never by the client. */
  text?: { mode?: "numeric" | "alphanumeric"; length?: number };
}

const SITE_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const MIN_SECRET_LENGTH = 24;

export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

export function maxDifficulty(a: Difficulty | undefined, b: Difficulty | undefined): Difficulty {
  const rank = (d: Difficulty | undefined) => (d ? DIFFICULTY_ORDER.indexOf(d) : 1);
  return DIFFICULTY_ORDER[Math.max(rank(a), rank(b))] ?? "medium";
}

export function isSiteKeyShape(value: unknown): value is string {
  return typeof value === "string" && SITE_KEY_PATTERN.test(value);
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time string comparison (both sides are hashed to equal length first). */
export function safeEqualStrings(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export class SiteRegistry {
  private readonly sites = new Map<string, SiteConfig>();

  constructor(sites: SiteConfig[]) {
    for (const site of sites) {
      if (!SITE_KEY_PATTERN.test(site.siteKey)) {
        throw new ConfigurationError(`site key "${site.siteKey}" must match ${SITE_KEY_PATTERN}`);
      }
      if (this.sites.has(site.siteKey)) {
        throw new ConfigurationError(`duplicate site key "${site.siteKey}"`);
      }
      if (site.secretKey !== undefined && site.secretKey.length < MIN_SECRET_LENGTH) {
        throw new ConfigurationError(`secretKey for site "${site.siteKey}" must be at least ${MIN_SECRET_LENGTH} characters`);
      }
      for (const origin of site.allowedOrigins ?? []) {
        let canonical: string | undefined;
        try {
          canonical = new URL(origin).origin;
        } catch {
          canonical = undefined;
        }
        if (canonical !== origin) {
          throw new ConfigurationError(`allowedOrigins entry "${origin}" for site "${site.siteKey}" must be a bare origin like https://example.com`);
        }
      }
      this.sites.set(site.siteKey, site);
    }
  }

  get(siteKey: string): SiteConfig | undefined {
    return this.sites.get(siteKey);
  }

  get size(): number {
    return this.sites.size;
  }

  /** Always performs one hash comparison, so a wrong/unknown site takes the same time as a wrong secret. */
  verifySecret(site: SiteConfig | undefined, presented: string): boolean {
    const expected = site?.secretKey ?? "\u0000no-such-secret\u0000";
    const equal = safeEqualStrings(expected, presented);
    return equal && site?.secretKey !== undefined;
  }
}
