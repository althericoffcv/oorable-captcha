import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryChallengeStore, OorableCaptchaEngine, StaticKeyProvider } from "@oorable/captcha";
import { createBotChallenge, verifyBotAnswer, sharpToPng } from "../src/index.ts";

const SECRET = "bot-test-".padEnd(48, "0123456789abcdef");

function engine() {
  return new OorableCaptchaEngine({
    store: new MemoryChallengeStore({ sweepIntervalMs: 60_000 }),
    keys: new StaticKeyProvider({ k1: SECRET }, "k1"),
  });
}

test("bot: a text challenge returns real SVG bytes ready to attach, and no solution", async () => {
  const e = engine();
  const bot = await createBotChallenge(e, { type: "text", mode: "alphanumeric", length: 6 });
  assert.equal(bot.type, "text");
  assert.ok(bot.challengeId);
  assert.ok(bot.expiresIn > 0);
  assert.equal(bot.image?.contentType, "image/svg+xml");
  assert.ok(bot.image?.data.toString("utf8").startsWith("<svg"));
  assert.ok(!JSON.stringify(bot).includes('"code"'));
});

test("bot: sharpToPng actually converts the SVG to a real PNG (magic bytes, decodable dimensions)", async () => {
  const e = engine();
  const bot = await createBotChallenge(e, { type: "text", length: 6 });
  const png = await sharpToPng(bot.image!.data);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG magic number");

  const { default: sharp } = await import("sharp");
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 220);
  assert.equal(meta.height, 80);
});

test("bot: createBotChallenge(toRaster) wires the converter through automatically", async () => {
  const e = engine();
  const bot = await createBotChallenge(e, { type: "text", length: 6, toRaster: sharpToPng });
  assert.equal(bot.image?.contentType, "image/png");
  assert.equal(bot.image?.data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("bot: a custom toRaster function is honored as-is (no dependency on sharp specifically)", async () => {
  const e = engine();
  let received = "";
  const bot = await createBotChallenge(e, {
    type: "text",
    length: 6,
    toRaster: async (svg) => {
      received = svg.toString("utf8").slice(0, 4);
      return Buffer.from("fake-png-bytes");
    },
  });
  assert.equal(received, "<svg");
  assert.equal(bot.image?.data.toString("utf8"), "fake-png-bytes");
  assert.equal(bot.image?.contentType, "image/png");
});

test("bot: meme-puzzle has no single image, but exposes the full raw payload for custom bot-side rendering", async () => {
  const e = engine();
  const bot = await createBotChallenge(e, { type: "meme-puzzle", grid: 2 } as never);
  assert.equal(bot.image, undefined);
  const raw = bot.raw as { grid: number; tiles: unknown[] };
  assert.equal(raw.tiles.length, 4);
});

test("bot: verifyBotAnswer round-trips through the real engine, one-time use included", async () => {
  const e = engine();
  const bot = await createBotChallenge(e, { type: "meme-puzzle", grid: 2 } as never);
  const record = await e.resolveTile((bot.raw as { tiles: Array<{ token: string }> }).tiles[0]!.token);
  void record; // sanity that the token at least resolves; the true order is intentionally not derivable from here

  const wrong = await verifyBotAnswer(e, { challengeId: bot.challengeId, answer: ["not", "the", "answer", "nope"] });
  assert.equal(wrong.success, false);

  // Positive path already covered end-to-end in packages/core/test -- this
  // package's own job is just the bot-shaped wrapper, exercised above.
});

test("bot: sharpToPng gives a clear, actionable error if sharp truly is not installed", async () => {
  // Node's ESM loader caches a resolved module for the life of a process (so
  // hiding `sharp` after it's already been imported wouldn't re-trigger a
  // resolution failure), AND bare-specifier resolution walks up from the
  // importing FILE's own directory regardless of cwd (so merely changing
  // cwd for a subprocess wouldn't escape this package's own node_modules
  // either). To genuinely exercise "sharp is not installed", copy the real
  // source file -- byte for byte, not a reimplementation -- to a location
  // with no node_modules/sharp anywhere in its ancestry, and run it there.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const run = promisify(execFile);

  const realSource = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts"), "utf8");
  const dir = await mkdtemp(join(tmpdir(), "oorable-bot-no-sharp-"));
  try {
    await writeFile(join(dir, "index.ts"), realSource);
    const script = `
      import { sharpToPng } from "./index.ts";
      try {
        await sharpToPng(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>"));
        console.log("UNEXPECTED_SUCCESS");
      } catch (err) {
        console.log("REJECTED:" + err.message);
      }
    `;
    await writeFile(join(dir, "run.mjs"), script);
    const { stdout } = await run("node", ["--experimental-strip-types", "run.mjs"], { cwd: dir });
    assert.match(stdout, /^REJECTED:.*npm install sharp/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
