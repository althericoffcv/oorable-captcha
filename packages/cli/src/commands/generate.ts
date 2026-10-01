import {
  OorableCaptchaEngine,
  StaticKeyProvider,
  type ChallengeType,
  type ImageCandidate,
} from "@oorable/captcha";
import { flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { FileChallengeStore, getDevSecret } from "../dev-store.ts";

const SAMPLE_IMAGE_CANDIDATES: ImageCandidate[] = [
  { id: "sample-a", imageUrl: "https://example.com/sample-a.jpg", correct: true },
  { id: "sample-b", imageUrl: "https://example.com/sample-b.jpg", correct: false },
  { id: "sample-c", imageUrl: "https://example.com/sample-c.jpg", correct: true },
  { id: "sample-d", imageUrl: "https://example.com/sample-d.jpg", correct: false },
];

function isChallengeType(value: string | undefined): value is ChallengeType {
  return value === "meme-puzzle" || value === "text" || value === "image";
}

/**
 * Creates one real challenge through the real engine (not a mock) and
 * prints exactly what a server would send a client: challengeId, type,
 * expiresIn, and the public payload. Never the solution -- that stays in
 * the local dev store for `verify` to check against later.
 */
export async function runGenerate(args: ParsedArgs): Promise<number> {
  const typeArg = flagString(args.flags, "type") ?? "meme-puzzle";
  if (!isChallengeType(typeArg)) {
    console.error(`Unknown --type "${typeArg}". Expected meme-puzzle, text, or image.`);
    return 1;
  }

  const engine = new OorableCaptchaEngine({
    store: new FileChallengeStore(),
    keys: new StaticKeyProvider({ dev: await getDevSecret() }, "dev"),
  });

  const created = await engine.createChallenge({
    type: typeArg,
    difficulty: flagString(args.flags, "difficulty") as "easy" | "medium" | "hard" | undefined,
    grid: flagNumber(args.flags, "grid"),
    mode: flagString(args.flags, "mode") as "numeric" | "alphanumeric" | undefined,
    length: flagNumber(args.flags, "length"),
    candidates: typeArg === "image" ? SAMPLE_IMAGE_CANDIDATES : undefined,
  });

  console.log(JSON.stringify(created, null, 2));
  console.log(`\nNext: oorable-captcha verify --challenge-id ${created.challengeId} --answer <your-answer>`);
  if (typeArg === "meme-puzzle") {
    console.log("For a meme puzzle, --answer takes a comma-separated list of tile tokens, one per grid slot.");
  } else if (typeArg === "image") {
    console.log("For an image challenge, --answer takes a comma-separated list of the candidate ids you're selecting.");
  }
  return 0;
}
