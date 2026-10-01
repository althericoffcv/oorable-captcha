import { MemoryChallengeStore } from "./challenge/memory-store.ts";
import { StaticKeyProvider, verifyToken, type KeyProvider } from "./crypto/token.ts";
import { sealTile, openTile } from "./crypto/tile-token.ts";
import { createChallengeRecord, verifyChallengeRecord, type LifecycleConfig } from "./challenge/lifecycle.ts";
import type { ChallengeStore } from "./challenge/store.ts";
import type { ChallengeType, VerifyResult } from "./challenge/types.ts";
import { buildMemePuzzleChallenge, checkMemePuzzleAnswer } from "./challenges/meme-puzzle.ts";
import { buildTextCaptchaChallenge, checkTextCaptchaAnswer } from "./challenges/text-captcha.ts";
import {
  buildImageCaptchaChallenge,
  checkImageCaptchaAnswer,
  type ImageCandidate,
} from "./challenges/image-captcha.ts";
import { SvgTextRenderer } from "./rendering/svg-text-renderer.ts";
import { SyntheticAssetProvider } from "./assets/synthetic-asset-provider.ts";
import type { AssetProvider, TileAsset } from "./assets/asset-provider.ts";
import type { TextRendererProvider } from "./rendering/renderer-provider.ts";
import { DEFAULTS } from "./config.ts";
import { ConfigurationError } from "./errors.ts";

export interface EngineOptions {
  store?: ChallengeStore;
  keys?: KeyProvider;
  assetProvider?: AssetProvider;
  textRenderer?: TextRendererProvider;
  defaultTtlMs?: number;
  defaultMaxAttempts?: number;
  verificationTokenTtlMs?: number;
  /** URL prefix clients fetch puzzle tiles from. Default "/v1/assets/tile". */
  tileBaseUrl?: string;
  onEvent?: LifecycleConfig["onEvent"];
}

export interface CreateChallengeOptions {
  type: ChallengeType;
  difficulty?: "easy" | "medium" | "hard";
  grid?: number;
  mode?: "numeric" | "alphanumeric";
  length?: number;
  /** BCP 47 tag; localizes numeric text codes (digit glyphs). */
  locale?: string;
  /** Image challenges only. Must come from *server-side* configuration, never from a client request. */
  candidates?: ImageCandidate[];
  /** Image challenges only: the instruction shown above the images. */
  prompt?: string;
  siteKey?: string;
  sessionId?: string;
}

export interface CreatedChallenge {
  challengeId: string;
  type: ChallengeType;
  expiresIn: number;
  challenge: unknown;
}

export interface VerifyOptions {
  challengeId: string;
  answer: unknown;
  siteKey?: string;
}

export interface RedeemOptions {
  /** If given, the token must have been issued for this site. */
  siteKey?: string;
  /** If given, the token must have been issued for this session. */
  sessionId?: string;
}

export type RedeemResult =
  | {
      valid: true;
      challengeId: string;
      type: string;
      siteKey?: string;
      sessionId?: string;
      issuedAt: number;
      expiresAt: number;
    }
  | {
      valid: false;
      reason: "invalid_token" | "expired" | "already_redeemed" | "site_key_mismatch" | "session_mismatch";
    };

/** The creation options that are safe to remember and replay when refreshing a challenge. */
function paramsOf(input: CreateChallengeOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (input.difficulty !== undefined) params.difficulty = input.difficulty;
  if (input.grid !== undefined) params.grid = input.grid;
  if (input.mode !== undefined) params.mode = input.mode;
  if (input.length !== undefined) params.length = input.length;
  if (input.locale !== undefined) params.locale = input.locale;
  return params;
}

/**
 * The engine is the one object that ties a Store, a KeyProvider, an
 * AssetProvider and a TextRendererProvider together. Everything here
 * is provider-based on purpose (bring your own storage / image source
 * / renderer) -- see docs/architecture.md.
 */
export class OorableCaptchaEngine {
  private readonly lifecycleConfig: LifecycleConfig;
  private readonly assetProvider: AssetProvider;
  private readonly textRenderer: TextRendererProvider;
  private readonly tileBaseUrl: string;

  constructor(options: EngineOptions = {}) {
    this.assetProvider = options.assetProvider ?? new SyntheticAssetProvider();
    this.textRenderer = options.textRenderer ?? new SvgTextRenderer();
    this.tileBaseUrl = (options.tileBaseUrl ?? "/v1/assets/tile").replace(/\/+$/, "");
    this.lifecycleConfig = {
      store: options.store ?? new MemoryChallengeStore(),
      keys: options.keys ?? defaultKeyProviderFromEnv(),
      defaultTtlMs: options.defaultTtlMs ?? DEFAULTS.challengeTtlMs,
      defaultMaxAttempts: options.defaultMaxAttempts ?? DEFAULTS.maxAttempts,
      verificationTokenTtlMs: options.verificationTokenTtlMs ?? DEFAULTS.verificationTokenTtlMs,
      onEvent: options.onEvent,
    };
  }

  async createChallenge(input: CreateChallengeOptions): Promise<CreatedChallenge> {
    const ttlMs = this.lifecycleConfig.defaultTtlMs;
    // Tile tokens embed this expiry, so tile URLs die no later than the challenge itself.
    const expiresAt = Date.now() + ttlMs;
    const definition = await this.buildDefinition(input, expiresAt);
    const record = await createChallengeRecord(
      {
        type: input.type,
        siteKey: input.siteKey,
        sessionId: input.sessionId,
        ttlMs,
        params: paramsOf(input),
      },
      definition,
      this.lifecycleConfig,
    );
    return {
      challengeId: record.id,
      type: record.type,
      expiresIn: Math.round((record.expiresAt - record.issuedAt) / 1000),
      challenge: record.publicPayload,
    };
  }

  async verifyChallenge(input: VerifyOptions): Promise<VerifyResult> {
    return verifyChallengeRecord(input, checkAnswerByType, this.lifecycleConfig);
  }

  /**
   * Replaces an unsolved challenge with a fresh equivalent one (same type,
   * site, session and creation options) and discards the old one.
   * Returns undefined if the challenge is unknown, expired, already solved,
   * or belongs to a different site. `overrides` lets the caller re-supply
   * server-side inputs that are deliberately never stored, such as image
   * candidates.
   */
  async refreshChallenge(
    input: { challengeId: string; siteKey?: string },
    overrides: Partial<CreateChallengeOptions> = {},
  ): Promise<CreatedChallenge | undefined> {
    const store = this.lifecycleConfig.store;
    const old = await store.get(input.challengeId);
    if (!old || old.consumed) return undefined;
    if (old.siteKey && old.siteKey !== input.siteKey) return undefined;

    const fresh = await this.createChallenge({
      ...(old.params as Partial<CreateChallengeOptions> | undefined),
      ...overrides,
      type: old.type,
      siteKey: old.siteKey,
      sessionId: old.sessionId,
    });
    await store.delete(old.id);
    return fresh;
  }

  /**
   * Redeems a verification token exactly once.
   *
   * A signed token only proves "this challenge was solved". Without a
   * redemption step it could be replayed to many form submissions until it
   * expires. Relying-party backends should call this (directly, or through
   * the REST `POST /v1/tokens/verify` endpoint) instead of checking the
   * signature themselves. The atomic redemption marker is what makes a token
   * single-use across concurrent requests.
   */
  async redeemToken(token: string, options: RedeemOptions = {}): Promise<RedeemResult> {
    const checked = verifyToken(token, this.lifecycleConfig.keys);
    if (!checked.valid) {
      return { valid: false, reason: checked.reason === "expired" ? "expired" : "invalid_token" };
    }
    const claims = checked.payload;

    // Binding checks run BEFORE redemption so that presenting a token for the
    // wrong site or session does not burn it.
    if (options.siteKey !== undefined && claims.siteKey !== options.siteKey) {
      return { valid: false, reason: "site_key_mismatch" };
    }
    if (options.sessionId !== undefined && claims.sessionId !== options.sessionId) {
      return { valid: false, reason: "session_mismatch" };
    }

    const remainingMs = Math.max(1, claims.exp - Date.now());
    const first = await this.lifecycleConfig.store.tryRedeem(claims.challengeId, remainingMs);
    if (!first) return { valid: false, reason: "already_redeemed" };

    return {
      valid: true,
      challengeId: claims.challengeId,
      type: claims.type,
      siteKey: claims.siteKey,
      sessionId: claims.sessionId,
      issuedAt: claims.iat,
      expiresAt: claims.exp,
    };
  }

  /** The configured puzzle source images (ids and labels only -- never solutions). */
  async listSourceImages() {
    return this.assetProvider.listSourceImages();
  }

  /** Resolves a client-supplied tile token to pixels; undefined if forged, expired or unknown. */
  async resolveTile(token: string): Promise<TileAsset | undefined> {
    const location = openTile(token, this.lifecycleConfig.keys);
    if (!location) return undefined;
    return this.assetProvider.getTile(location);
  }

  private async buildDefinition(input: CreateChallengeOptions, expiresAt: number) {
    switch (input.type) {
      case "meme-puzzle":
        return buildMemePuzzleChallenge({
          difficulty: input.difficulty,
          grid: input.grid,
          assetProvider: this.assetProvider,
          mintTile: (location) => sealTile(location, expiresAt, this.lifecycleConfig.keys),
          tileUrl: (token) => `${this.tileBaseUrl}/${token}`,
        });
      case "text":
        return buildTextCaptchaChallenge({
          mode: input.mode,
          length: input.length,
          locale: input.locale,
          renderer: this.textRenderer,
        });
      case "image":
        if (!input.candidates) {
          throw new ConfigurationError('type "image" requires `candidates`');
        }
        return buildImageCaptchaChallenge({ candidates: input.candidates, prompt: input.prompt });
      default: {
        const exhaustiveCheck: never = input.type;
        throw new ConfigurationError(`Unsupported challenge type: ${String(exhaustiveCheck)}`);
      }
    }
  }
}

function checkAnswerByType(type: ChallengeType, answer: unknown, solution: unknown): boolean {
  switch (type) {
    case "meme-puzzle":
      return checkMemePuzzleAnswer(answer, solution);
    case "text":
      return checkTextCaptchaAnswer(answer, solution);
    case "image":
      return checkImageCaptchaAnswer(answer, solution);
    default:
      return false;
  }
}

function defaultKeyProviderFromEnv(): KeyProvider {
  const secret = process.env.OORABLE_CAPTCHA_SECRET;
  if (!secret) {
    throw new ConfigurationError(
      "No signing key configured. Set OORABLE_CAPTCHA_SECRET, or pass `keys` to createEngine()/OorableCaptchaEngine. " +
        "Run `npx oorable-captcha init` to generate one. Never commit this value.",
    );
  }
  return new StaticKeyProvider({ default: secret }, "default");
}

let sharedEngine: OorableCaptchaEngine | undefined;
function getSharedEngine(): OorableCaptchaEngine {
  sharedEngine ??= new OorableCaptchaEngine();
  return sharedEngine;
}

/**
 * Quick-start convenience API matching the README examples. This
 * lazily creates one shared engine per process using default
 * providers. For production, prefer `createEngine()` with explicit
 * store/keys/asset configuration.
 */
export async function createCaptcha(input: CreateChallengeOptions): Promise<CreatedChallenge> {
  return getSharedEngine().createChallenge(input);
}

export async function verifyCaptcha(input: VerifyOptions): Promise<VerifyResult> {
  return getSharedEngine().verifyChallenge(input);
}

export function createEngine(options: EngineOptions = {}): OorableCaptchaEngine {
  return new OorableCaptchaEngine(options);
}
