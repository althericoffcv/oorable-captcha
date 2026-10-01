/**
 * A small, dependency-free client for the OORABLE CAPTCHA REST API.
 *
 * It only speaks HTTP + JSON, so it runs anywhere `fetch` exists: browsers,
 * Node 18+, Deno, Bun, React Native. The web widget, the React adapter and
 * bots that talk to a remote CAPTCHA server all share it.
 *
 * It never sees or handles an answer key: it forwards what the *user*
 * submitted and returns what the server decided.
 */

export type ChallengeType = "meme-puzzle" | "text" | "image";
export type Difficulty = "easy" | "medium" | "hard";

export interface MemePuzzleChallenge {
  grid: number;
  /** In display order: tiles[i] is currently shown at slot i (row-major). */
  tiles: Array<{ token: string; assetUrl: string }>;
}

export interface TextChallenge {
  image: { contentType: string; data: string };
  mode: "numeric" | "alphanumeric";
  length: number;
}

export interface ImageChallenge {
  options: Array<{ id: string; imageUrl: string }>;
  select: number;
  prompt?: string;
}

export type CreatedChallenge =
  | { challengeId: string; type: "meme-puzzle"; expiresIn: number; challenge: MemePuzzleChallenge }
  | { challengeId: string; type: "text"; expiresIn: number; challenge: TextChallenge }
  | { challengeId: string; type: "image"; expiresIn: number; challenge: ImageChallenge };

export type VerifyFailureReason = "incorrect" | "expired" | "too_many_attempts" | "invalid";

export type VerifyResponse =
  | { success: true; verificationToken: string; expiresIn: number }
  | { success: false; reason: VerifyFailureReason | (string & {}) };

export type RedeemResponse =
  | { valid: true; challengeId: string; type: string; siteKey?: string; sessionId?: string; issuedAt: number; expiresAt: number }
  | { valid: false; reason: string };

export interface ClientOptions {
  /** Origin (and optional path prefix) of the CAPTCHA server, e.g. "https://captcha.example.com". Default: same origin. */
  baseUrl?: string;
  siteKey?: string;
  sessionId?: string;
  /** Inject a fetch implementation (tests, older runtimes). */
  fetch?: typeof fetch;
  /** Abort a request that takes longer than this. Default 10s. */
  timeoutMs?: number;
}

/** Thrown for every non-success HTTP outcome and for network failures. Never contains request content. */
export class ApiError extends Error {
  readonly status: number;
  /** Stable machine-readable code: the server's `error` value, or "network_error" / "timeout" / "bad_response". */
  readonly code: string;
  /** Seconds to wait before retrying, when the server sent Retry-After. */
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, retryAfterSeconds?: number) {
    super(`OORABLE CAPTCHA request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

const SAFE_IMAGE_TYPES = new Set(["image/svg+xml", "image/png", "image/jpeg", "image/webp", "image/gif"]);

export class OorableCaptchaClient {
  private readonly baseUrl: string;
  private readonly options: ClientOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions = {}) {
    this.options = options;
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    // Bind so that `fetch` keeps its required `this` when passed around in browsers.
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  createChallenge(input: { type: ChallengeType; difficulty?: Difficulty; locale?: string }): Promise<CreatedChallenge> {
    return this.post<CreatedChallenge>("/v1/challenges", {
      ...input,
      siteKey: this.options.siteKey,
      sessionId: this.options.sessionId,
    });
  }

  /** Replaces an unsolved challenge with a fresh equivalent one. */
  refresh(challengeId: string): Promise<CreatedChallenge> {
    return this.post<CreatedChallenge>("/v1/challenges/refresh", { challengeId, siteKey: this.options.siteKey });
  }

  /**
   * Submits the user's answer. `answer` is the user's solution as-is: an array
   * of tile tokens (meme puzzle), the typed string (text), or an array of
   * selected ids (image).
   */
  verify(input: { challengeId: string; answer: unknown }): Promise<VerifyResponse> {
    return this.post<VerifyResponse>("/v1/challenges/verify", { ...input, siteKey: this.options.siteKey });
  }

  /**
   * SERVER-SIDE ONLY. Redeems a verification token once, using the site's
   * secret key. Never call this from a browser or app: it would put the secret
   * key in the client.
   */
  redeemToken(token: string, auth: { secretKey: string }): Promise<RedeemResponse> {
    return this.post<RedeemResponse>(
      "/v1/tokens/verify",
      { token, siteKey: this.options.siteKey, sessionId: this.options.sessionId },
      { Authorization: `Bearer ${auth.secretKey}` },
    );
  }

  /**
   * Resolves a tile's `assetUrl` to something an <img> can load. Only http(s)
   * URLs and root-relative paths are accepted, so a hostile or compromised
   * server cannot hand back a `javascript:` or `file:` URL.
   */
  tileUrl(assetUrl: string): string {
    return this.safeUrl(assetUrl);
  }

  /** Builds an `<img>`-safe data URL for an inline image payload, or throws if its type is not a known image type. */
  dataUrl(image: { contentType: string; data: string }): string {
    if (!SAFE_IMAGE_TYPES.has(image.contentType) || !/^[A-Za-z0-9+/=]+$/.test(image.data)) {
      throw new ApiError(0, "bad_response");
    }
    return `data:${image.contentType};base64,${image.data}`;
  }

  safeUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("/") && !url.startsWith("//")) return `${this.baseUrl}${url}`;
    throw new ApiError(0, "bad_response");
  }

  private async post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
        // The API is cookie-free; never send ambient credentials.
        credentials: "omit",
      });
    } catch (err) {
      throw new ApiError(0, err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error");
    } finally {
      clearTimeout(timer);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(response.status, "bad_response");
    }
    if (!response.ok) {
      const code =
        typeof payload === "object" && payload !== null && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : "http_error";
      throw new ApiError(response.status, code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
    }
    return payload as T;
  }
}

export function createClient(options: ClientOptions = {}): OorableCaptchaClient {
  return new OorableCaptchaClient(options);
}
