// Example: Discord bot integration using discord.js v14
// (https://discord.js.org). Illustrative only -- @oorable/captcha-bot does
// not depend on discord.js or any other Discord library.
//
// Run with: npm install discord.js (not a dependency of this repo)

import { createEngine } from "@oorable/captcha";
import { createBotChallenge, verifyBotAnswer, sharpToPng } from "@oorable/captcha-bot";
// import { AttachmentBuilder, type Message } from "discord.js";

const engine = createEngine({ /* store, keys, ... -- see docs/configuration.md */ });
const pendingByUserId = new Map<string, string>();

export async function sendVerificationChallenge(channel: DiscordChannelLike, userId: string): Promise<void> {
  const challenge = await createBotChallenge(engine, {
    type: "text",
    length: 6,
    toRaster: sharpToPng, // Discord attachments are typically PNG/JPEG/GIF/WebP, not SVG
  });
  pendingByUserId.set(userId, challenge.challengeId);
  await channel.send({
    content: `<@${userId}> reply with the code in the image to verify.`,
    files: [{ attachment: challenge.image!.data, name: "captcha.png" }],
  });
}

export async function handleIncomingMessage(channel: DiscordChannelLike, userId: string, content: string): Promise<void> {
  const challengeId = pendingByUserId.get(userId);
  if (!challengeId) return;

  const result = await verifyBotAnswer(engine, { challengeId, answer: content.trim() });
  if (result.success) {
    pendingByUserId.delete(userId);
    await channel.send(`<@${userId}> verified, welcome!`);
  } else if (result.reason === "too_many_attempts" || result.reason === "expired") {
    await sendVerificationChallenge(channel, userId);
  } else {
    await channel.send(`<@${userId}> that's not it -- try again.`);
  }
}

interface DiscordChannelLike {
  send(content: string | { content?: string; files: Array<{ attachment: Buffer; name: string }> }): Promise<unknown>;
}
