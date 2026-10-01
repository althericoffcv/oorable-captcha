import { secureShuffle } from "../crypto/random.ts";
import type { ChallengeDefinition } from "../challenge/lifecycle.ts";

export interface ImageCandidate {
  id: string;
  imageUrl: string;
  /** Server-only correctness flag -- stripped before this ever reaches publicPayload. */
  correct: boolean;
}

export interface ImageCaptchaOptions {
  /** Full candidate pool (including which ones are correct); the engine randomizes order and strips `correct` before it reaches the client. */
  candidates: ImageCandidate[];
  /** How many candidates the user must select. Defaults to however many are marked correct. */
  requiredSelections?: number;
  /** Human-readable instruction, e.g. "Select every picture of a bicycle". Localize it yourself. */
  prompt?: string;
}

interface ImageCaptchaSolution {
  correctIds: string[];
}

export interface ImageCaptchaPublicPayload {
  options: Array<{ id: string; imageUrl: string }>;
  select: number;
  prompt?: string;
}

export async function buildImageCaptchaChallenge(options: ImageCaptchaOptions): Promise<ChallengeDefinition> {
  if (options.candidates.length < 2) {
    throw new Error("buildImageCaptchaChallenge: at least 2 candidates are required");
  }
  const shuffled = secureShuffle(options.candidates);
  const correctIds = shuffled.filter((c) => c.correct).map((c) => c.id);
  const select = options.requiredSelections ?? correctIds.length;

  const publicPayload: ImageCaptchaPublicPayload = {
    options: shuffled.map(({ id, imageUrl }) => ({ id, imageUrl })),
    select,
    ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
  };

  return {
    solution: { correctIds } satisfies ImageCaptchaSolution,
    publicPayload,
    checkAnswer: checkImageCaptchaAnswer,
  };
}

export function checkImageCaptchaAnswer(answer: unknown, solution: unknown): boolean {
  const sol = solution as ImageCaptchaSolution;
  if (!Array.isArray(answer) || answer.length !== sol.correctIds.length) return false;
  if (!answer.every((a) => typeof a === "string")) return false;
  const submitted = new Set(answer);
  return sol.correctIds.every((id) => submitted.has(id)) && submitted.size === sol.correctIds.length;
}
