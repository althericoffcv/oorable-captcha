import { OorableCaptchaEngine, StaticKeyProvider } from "@oorable/captcha";
import { flagString, type ParsedArgs } from "../args.ts";
import { FileChallengeStore, getDevSecret } from "../dev-store.ts";

function parseAnswer(raw: string): unknown {
  // A bare string is a text-challenge answer; a comma-separated list is
  // treated as an array (meme-puzzle tile tokens or image candidate ids).
  return raw.includes(",") ? raw.split(",").map((s) => s.trim()) : raw;
}

/**
 * Verifies an answer against a challenge previously created by `generate`
 * in this same project (matched via the local dev store -- see
 * dev-store.ts). Prints the real VerifyResult; never the solution.
 */
export async function runVerify(args: ParsedArgs): Promise<number> {
  const challengeId = flagString(args.flags, "challenge-id");
  const answerRaw = flagString(args.flags, "answer");
  if (!challengeId || answerRaw === undefined) {
    console.error("Usage: oorable-captcha verify --challenge-id <id> --answer <answer>");
    return 1;
  }

  const engine = new OorableCaptchaEngine({
    store: new FileChallengeStore(),
    keys: new StaticKeyProvider({ dev: await getDevSecret() }, "dev"),
  });

  const result = await engine.verifyChallenge({ challengeId, answer: parseAnswer(answerRaw) });
  console.log(JSON.stringify(result, null, 2));
  return result.success ? 0 : 1;
}
