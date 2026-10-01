// Example: WhatsApp bot integration using Baileys (https://github.com/WhiskeySockets/Baileys).
// This file is illustrative -- @oorable/captcha-bot does not depend on
// Baileys or any other WhatsApp library. Swap in whichever client you use;
// the only thing that matters is "send an image, read back a text reply".
//
// Run with: npm install @whiskeysockets/baileys (not a dependency of this repo)

import { createEngine } from "@oorable/captcha";
import { createBotChallenge, verifyBotAnswer, sharpToPng } from "@oorable/captcha-bot";
// import makeWASocket from "@whiskeysockets/baileys";

const engine = createEngine({ /* store, keys, ... -- see docs/configuration.md */ });

// Per-chat state: which challengeId is this JID currently waiting on.
const pendingByJid = new Map<string, string>();

export async function sendVerificationChallenge(sock: WhatsAppSocketLike, jid: string): Promise<void> {
  const challenge = await createBotChallenge(engine, {
    type: "text",
    mode: "alphanumeric",
    length: 6,
    toRaster: sharpToPng, // WhatsApp's media API expects a raster image, not SVG
  });
  pendingByJid.set(jid, challenge.challengeId);

  await sock.sendMessage(jid, {
    image: challenge.image!.data,
    caption: `Please reply with the ${challenge.image ? "characters shown in this image" : "code"} to continue.`,
  });
}

export async function handleIncomingText(sock: WhatsAppSocketLike, jid: string, text: string): Promise<void> {
  const challengeId = pendingByJid.get(jid);
  if (!challengeId) return;

  const result = await verifyBotAnswer(engine, { challengeId, answer: text.trim() });
  if (result.success) {
    pendingByJid.delete(jid);
    await sock.sendMessage(jid, { text: "Verified, thanks!" });
    // Hand result.verificationToken to whatever server-side flow needs proof
    // this chat was solved (see docs/rest-api.md, POST /v1/tokens/verify).
  } else if (result.reason === "too_many_attempts" || result.reason === "expired") {
    await sendVerificationChallenge(sock, jid); // fresh challenge, same as a "New code" button
  } else {
    await sock.sendMessage(jid, { text: "That's not it -- try again." });
  }
}

// Minimal shape this example needs from a WhatsApp client; Baileys' real
// socket satisfies it (and has many more methods this example doesn't use).
interface WhatsAppSocketLike {
  sendMessage(jid: string, content: { image?: Buffer; text?: string; caption?: string }): Promise<unknown>;
}
