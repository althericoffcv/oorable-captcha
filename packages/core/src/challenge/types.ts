export type ChallengeType = "meme-puzzle" | "text" | "image";

export interface ChallengeRecord {
  id: string;
  type: ChallengeType;
  version: number;
  issuedAt: number;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  consumed: boolean;
  siteKey?: string;
  sessionId?: string;
  /** Non-secret creation options (difficulty, grid, code length...) so refresh can build an equivalent challenge. */
  params?: Record<string, unknown>;
  /**
   * Server-only solution data. NEVER include this object (or any field
   * derived from it) in an HTTP response, log line, or error message.
   */
  solution: unknown;
  /** Data safe to send to the client so it can render the challenge. */
  publicPayload: unknown;
}

export type VerifyFailureReason =
  | "not_found"
  | "expired"
  | "already_used"
  | "too_many_attempts"
  | "incorrect"
  | "site_key_mismatch";

export type VerifyResult =
  | { success: true; verificationToken: string; expiresIn: number }
  | { success: false; reason: VerifyFailureReason };
