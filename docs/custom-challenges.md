# Custom challenge types

The engine's core contract for a challenge type is `ChallengeDefinition` (`packages/core/src/challenge/lifecycle.ts`):

```ts
interface ChallengeDefinition {
  solution: unknown;       // server-only. Never sent to the client, logged, or echoed in an error.
  publicPayload: unknown;  // safe to send to the client.
  checkAnswer(answer: unknown, solution: unknown): boolean; // must not throw on malformed input
}
```

The three built-in types (`packages/core/src/challenges/*.ts`) are ordinary consumers of this same interface -- there's no special-cased path a custom type doesn't get.

## Building one

```ts
import type { ChallengeDefinition } from "@oorable/captcha";
import { secureAlphanumericCode } from "@oorable/captcha";

export async function buildMathChallenge(): Promise<ChallengeDefinition> {
  const a = Math.floor(Math.random() * 10); // fine here: cosmetic difficulty, not security-relevant
  const b = Math.floor(Math.random() * 10);
  return {
    solution: { answer: a + b },
    publicPayload: { question: `${a} + ${b} = ?` },
    checkAnswer: (answer, solution) => Number(answer) === (solution as { answer: number }).answer,
  };
}
```

Then wire it into the lifecycle yourself (the engine's `createChallenge`/`verifyChallenge` are convenience wrappers around `createChallengeRecord`/`verifyChallengeRecord`, which accept any `ChallengeDefinition` and any `checkAnswer` dispatch function):

```ts
import { createChallengeRecord, verifyChallengeRecord } from "@oorable/captcha";

const record = await createChallengeRecord({ type: "math" as never }, await buildMathChallenge(), lifecycleConfig);
```

`lifecycleConfig` is the same `{ store, keys, defaultTtlMs, defaultMaxAttempts, verificationTokenTtlMs }` shape `OorableCaptchaEngine` builds internally -- construct one directly if you want full control, or open a small PR to extend `ChallengeType`/`OorableCaptchaEngine.buildDefinition` if you'd rather it feel native. Either way, you get one-time consumption, attempt limits, expiry, and signed tokens for free -- that machinery has no idea what "math" means and doesn't need to.

## Rules any custom type must follow to keep the same security properties

1. **Never throw from `checkAnswer`** for malformed input -- return `false`. A thrown error would turn "wrong answer" into a 500 and could leak stack traces.
2. **Never put anything answer-derived in `publicPayload`.** If you're not sure whether a field counts, ask: would printing it let someone skip solving the challenge? If yes, it belongs in `solution`, not `publicPayload`.
3. **Use `node:crypto` for anything that determines the answer or its presentation order** -- shuffling, random codes, tile selection. `Math.random()` is fine only for genuinely cosmetic randomness that doesn't affect correctness (see the synthetic asset provider's decorative pattern generation for an example of the distinction).
4. **Keep `solution` JSON-serializable** if you're using a `ChallengeStore` that serializes records (both built-in stores do).

## Custom asset providers and renderers

`AssetProvider` (puzzle images) and `TextRendererProvider` (text CAPTCHA rendering) are separate, smaller interfaces than a full challenge type -- see `docs/asset-management.md` and `docs/localization.md`'s closing note for when you'd implement one of those instead of a whole new challenge type.
