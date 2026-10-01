/**
 * Reasonable starting defaults -- NOT a claim that these are the only
 * correct values for your deployment. Tune ttl/attempts/rate limits to
 * your own risk tolerance; see docs/configuration.md.
 */
export const DEFAULTS = {
  challengeTtlMs: 120_000,
  maxAttempts: 5,
  verificationTokenTtlMs: 120_000,
  rateLimit: {
    createPerIpPerMinute: 30,
    verifyPerIpPerMinute: 60,
  },
} as const;
