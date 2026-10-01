export * from "./engine.ts";
export * from "./challenge/types.ts";
export type { ChallengeStore } from "./challenge/store.ts";
export { MemoryChallengeStore } from "./challenge/memory-store.ts";
export type { MemoryChallengeStoreOptions } from "./challenge/memory-store.ts";
export type { ChallengeDefinition, LifecycleEvent } from "./challenge/lifecycle.ts";
export * from "./crypto/token.ts";
export { sealTile, openTile } from "./crypto/tile-token.ts";
export {
  secureRandomId,
  secureRandomInt,
  secureShuffle,
  secureNumericCode,
  secureAlphanumericCode,
} from "./crypto/random.ts";
export type { AssetProvider, PuzzleSourceImage, TileLocation, TileAsset } from "./assets/asset-provider.ts";
export { SyntheticAssetProvider } from "./assets/synthetic-asset-provider.ts";
export { LocalPreprocessedAssetProvider } from "./assets/local-asset-provider.ts";
export type { RenderedImage, TextRendererProvider } from "./rendering/renderer-provider.ts";
export { SvgTextRenderer } from "./rendering/svg-text-renderer.ts";
export { localizeDigits, normalizeDigits } from "./rendering/locale-digits.ts";
export type { MemePuzzlePublicPayload, PuzzleTile } from "./challenges/meme-puzzle.ts";
export type { TextCaptchaPublicPayload } from "./challenges/text-captcha.ts";
export type { ImageCandidate, ImageCaptchaPublicPayload } from "./challenges/image-captcha.ts";
export { MemoryRateLimiter, CompositeRateLimiter } from "./security/rate-limiter.ts";
export type { RateLimiter, RateLimitResult, MemoryRateLimiterOptions } from "./security/rate-limiter.ts";
export { assessRisk } from "./security/risk-engine.ts";
export type { RiskSignal, RiskAssessment, RiskThresholds } from "./security/risk-engine.ts";
export { OorableCaptchaError, ConfigurationError, CapacityError } from "./errors.ts";
export { DEFAULTS } from "./config.ts";
