import { secureAlphanumericCode, secureNumericCode } from "../crypto/random.ts";
import type { ChallengeDefinition } from "../challenge/lifecycle.ts";
import type { TextRendererProvider } from "../rendering/renderer-provider.ts";
import { localizeDigits, normalizeDigits } from "../rendering/locale-digits.ts";

export interface TextCaptchaOptions {
  mode?: "numeric" | "alphanumeric";
  length?: number;
  /** BCP 47 tag. Numeric codes are drawn with the locale's native digits (e.g. ar-EG); the answer is accepted in either script. */
  locale?: string;
  renderer: TextRendererProvider;
}

interface TextCaptchaSolution {
  code: string;
}

export interface TextCaptchaPublicPayload {
  image: { contentType: string; data: string }; // data: base64
  /** Lets a UI pick the right keyboard (numeric vs. text). Both are evident from the image itself. */
  mode: "numeric" | "alphanumeric";
  length: number;
}

function clampLength(mode: "numeric" | "alphanumeric", length?: number): number {
  if (mode === "numeric") return Math.min(8, Math.max(5, length ?? 6));
  return Math.min(10, Math.max(4, length ?? 6));
}

export async function buildTextCaptchaChallenge(options: TextCaptchaOptions): Promise<ChallengeDefinition> {
  const mode = options.mode ?? "alphanumeric";
  const length = clampLength(mode, options.length);
  const code = mode === "numeric" ? secureNumericCode(length) : secureAlphanumericCode(length);

  // The *solution* is always ASCII; only what is drawn is localized.
  const display = mode === "numeric" ? localizeDigits(code, options.locale) : code;
  const rendered = await options.renderer.render(display, { locale: options.locale });
  const publicPayload: TextCaptchaPublicPayload = {
    image: { contentType: rendered.contentType, data: rendered.data.toString("base64") },
    mode,
    length,
  };

  return {
    solution: { code } satisfies TextCaptchaSolution,
    publicPayload,
    checkAnswer: checkTextCaptchaAnswer,
  };
}

export function checkTextCaptchaAnswer(answer: unknown, solution: unknown): boolean {
  const sol = solution as TextCaptchaSolution;
  if (typeof answer !== "string") return false;
  // Codes are at most 10 chars; refuse absurdly long input in O(1) rather than normalizing it.
  if (answer.length > 64) return false;
  return normalizeDigits(answer.trim()).toUpperCase() === sol.code.toUpperCase();
}
