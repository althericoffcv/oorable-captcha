// Example: Telegram bot integration using node-telegram-bot-api
// (https://github.com/yagop/node-telegram-bot-api). Illustrative only --
// @oorable/captcha-bot does not depend on this or any other Telegram
// library.
//
// Run with: npm install node-telegram-bot-api (not a dependency of this repo)

import { createEngine } from "@oorable/captcha";
import { createBotChallenge, verifyBotAnswer, sharpToPng } from "@oorable/captcha-bot";
// import TelegramBot from "node-telegram-bot-api";

const engine = createEngine({ /* store, keys, ... -- see docs/configuration.md */ });
const pendingByChatId = new Map<number, string>();

export async function sendVerificationChallenge(bot: TelegramBotLike, chatId: number): Promise<void> {
  const challenge = await createBotChallenge(engine, {
    type: "text",
    mode: "numeric",
    length: 6,
    toRaster: sharpToPng, // Telegram's sendPhoto expects PNG/JPEG, not SVG
  });
  pendingByChatId.set(chatId, challenge.challengeId);
  await bot.sendPhoto(chatId, challenge.image!.data, { caption: "Reply with the digits shown above." });
}

export async function handleIncomingMessage(bot: TelegramBotLike, chatId: number, text: string): Promise<void> {
  const challengeId = pendingByChatId.get(chatId);
  if (!challengeId) return;

  const result = await verifyBotAnswer(engine, { challengeId, answer: text.trim() });
  if (result.success) {
    pendingByChatId.delete(chatId);
    await bot.sendMessage(chatId, "Verified -- welcome!");
  } else if (result.reason === "too_many_attempts" || result.reason === "expired") {
    await sendVerificationChallenge(bot, chatId);
  } else {
    await bot.sendMessage(chatId, "Not quite -- one more try.");
  }
}

interface TelegramBotLike {
  sendPhoto(chatId: number, photo: Buffer, options?: { caption?: string }): Promise<unknown>;
  sendMessage(chatId: number, text: string): Promise<unknown>;
}
