import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTextCaptchaChallenge, checkTextCaptchaAnswer } from "../src/challenges/text-captcha.ts";
import { SvgTextRenderer } from "../src/rendering/svg-text-renderer.ts";

const renderer = new SvgTextRenderer();

test("text captcha: renders an SVG image and keeps the code out of the public payload", async () => {
  const { publicPayload, solution } = await buildTextCaptchaChallenge({ renderer, length: 6 });
  const payload = publicPayload as { image: { contentType: string; data: string } };
  const sol = solution as { code: string };

  assert.equal(payload.image.contentType, "image/svg+xml");
  const svg = Buffer.from(payload.image.data, "base64").toString("utf8");
  assert.ok(svg.startsWith("<svg"));

  // Glyphs are necessarily inside the image (a human has to read them), but
  // the serialized JSON must not carry the code as a machine-readable field.
  const serialized = JSON.stringify(publicPayload);
  assert.ok(!serialized.includes('"code"'));
  assert.ok(!serialized.includes(sol.code), "the code must not appear as plain text in the JSON payload");
  assert.equal(sol.code.length, 6);
});

test("text captcha: numeric mode yields 5-8 digits and clamps out-of-range lengths", async () => {
  for (const [requested, expected] of [[6, 6], [1, 5], [99, 8], [undefined, 6]] as const) {
    const { solution } = await buildTextCaptchaChallenge({ renderer, mode: "numeric", length: requested });
    const code = (solution as { code: string }).code;
    assert.match(code, /^\d+$/);
    assert.equal(code.length, expected);
  }
});

test("text captcha: default alphabet avoids ambiguous characters", async () => {
  for (let i = 0; i < 100; i++) {
    const { solution } = await buildTextCaptchaChallenge({ renderer, mode: "alphanumeric", length: 10 });
    assert.doesNotMatch((solution as { code: string }).code, /[01OIL]/);
  }
});

test("text captcha: codes are not repeated across generations", async () => {
  const codes = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const { solution } = await buildTextCaptchaChallenge({ renderer, mode: "alphanumeric", length: 8 });
    codes.add((solution as { code: string }).code);
  }
  assert.ok(codes.size >= 199, "8 chars over a 32-symbol alphabet should essentially never collide in 200 draws");
});

test("text captcha: answer check is case-insensitive, trims whitespace, rejects non-strings", () => {
  const solution = { code: "AB12CD" };
  assert.equal(checkTextCaptchaAnswer(" ab12cd ", solution), true);
  assert.equal(checkTextCaptchaAnswer("ab12cx", solution), false);
  assert.equal(checkTextCaptchaAnswer(123456, solution), false);
  assert.equal(checkTextCaptchaAnswer(null, solution), false);
  assert.equal(checkTextCaptchaAnswer(["AB12CD"], solution), false);
});

test("text captcha: rendering varies between calls (noise/rotation are randomized)", async () => {
  const a = (await renderer.render("ABC123", {})).data.toString("utf8");
  const b = (await renderer.render("ABC123", {})).data.toString("utf8");
  assert.notEqual(a, b);
});
