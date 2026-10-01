import type {
  ChallengeType,
  CreateChallengeOptions,
  OorableCaptchaEngine,
  TextCaptchaPublicPayload,
  VerifyResult,
} from "@oorable/captcha";

export interface BotChallenge {
  challengeId: string;
  type: ChallengeType;
  expiresIn: number;
  image?: { contentType: string; data: Buffer };
  raw: unknown;
}

export interface CreateBotChallengeOptions extends CreateChallengeOptions {
  toRaster?: (svg: Buffer) => Promise<Buffer>;
}

export async function createBotChallenge(
  engine: OorableCaptchaEngine,
  options: CreateBotChallengeOptions,
): Promise<BotChallenge> {
  const { toRaster, ...engineOptions } = options;
  const created = await engine.createChallenge(engineOptions);

  let image: BotChallenge["image"];

  if (created.type === "text") {
    const payload = created.challenge as TextCaptchaPublicPayload;
    const svgBytes = Buffer.from(payload.image.data, "base64");

    image = toRaster
      ? {
          contentType: "image/png",
          data: await toRaster(svgBytes),
        }
      : {
          contentType: payload.image.contentType,
          data: svgBytes,
        };
  }

  return {
    challengeId: created.challengeId,
    type: created.type,
    expiresIn: created.expiresIn,
    image,
    raw: created.challenge,
  };
}

export interface VerifyBotAnswerOptions {
  challengeId: string;
  answer: unknown;
}

export async function verifyBotAnswer(
  engine: OorableCaptchaEngine,
  options: VerifyBotAnswerOptions,
): Promise<VerifyResult> {
  return engine.verifyChallenge(options);
}

export async function sharpToPng(svg: Buffer): Promise<Buffer> {
  let sharp: typeof import("sharp").default;

  try {
    ({ default: sharp } = await import("sharp"));
  } catch (err) {
    throw new Error(
      "sharpToPng() needs the optional `sharp` package. Run `npm install sharp` (requires network) and try again.",
      { cause: err },
    );
  }

  return sharp(svg).png().toBuffer();
}
