import { test } from "node:test";
import assert from "node:assert/strict";
import { localizeDigits, normalizeDigits } from "../src/rendering/locale-digits.ts";
import { buildTextCaptchaChallenge, checkTextCaptchaAnswer } from "../src/challenges/text-captcha.ts";
import { SvgTextRenderer } from "../src/rendering/svg-text-renderer.ts";
import type { RenderedImage, TextRendererProvider } from "../src/rendering/renderer-provider.ts";

test("locale: digits are drawn in the locale's native numbering system", () => {
  assert.equal(localizeDigits("0123456789", "ar-EG"), "٠١٢٣٤٥٦٧٨٩");
  assert.equal(localizeDigits("0123456789", "fa-IR"), "۰۱۲۳۴۵۶۷۸۹");
  assert.equal(localizeDigits("0123456789", "bn-BD"), "০১২৩৪৫৬৭৮৯");
  assert.equal(localizeDigits("0123456789", "mr-IN"), "०१२३४५६७८९");
});

test("locale: Latin-digit, missing, malformed and oversized locales fall back to ASCII without throwing", () => {
  for (const locale of ["en-US", "id-ID", "ja-JP", undefined, "", "xx-INVALID!!", "not a locale", "a".repeat(5000)]) {
    assert.equal(localizeDigits("12345", locale), "12345");
  }
});

test("locale: normalizeDigits maps every supported script back to ASCII and leaves other text alone", () => {
  assert.equal(normalizeDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(normalizeDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789");
  assert.equal(normalizeDigits("০১২৩৪৫৬৭৮৯"), "0123456789");
  assert.equal(normalizeDigits("०१२३४५६७८९"), "0123456789");
  assert.equal(normalizeDigits("AB12cd"), "AB12cd");
  assert.equal(normalizeDigits("١٢ 34 ۵۶"), "12 34 56");
});

test("locale: localize then normalize is the identity for every supported digit system", () => {
  for (const locale of ["ar-EG", "fa-IR", "bn-BD", "mr-IN", "my-MM", "en-US"]) {
    assert.equal(normalizeDigits(localizeDigits("5038172946", locale)), "5038172946", locale);
  }
});

test("locale: a numeric captcha is drawn with native digits but verifies in either script", async () => {
  let drawn = "";
  const spy: TextRendererProvider = {
    async render(code, options): Promise<RenderedImage> {
      drawn = code;
      return new SvgTextRenderer().render(code, options);
    },
  };
  const { solution } = await buildTextCaptchaChallenge({ renderer: spy, mode: "numeric", length: 6, locale: "ar-EG" });
  const ascii = (solution as { code: string }).code;

  assert.match(ascii, /^[0-9]{6}$/, "the stored solution is always ASCII");
  assert.match(drawn, /^[٠-٩]{6}$/, "the image is drawn with Arabic-Indic digits");
  assert.equal(checkTextCaptchaAnswer(ascii, solution), true, "ASCII answer accepted");
  assert.equal(checkTextCaptchaAnswer(localizeDigits(ascii, "ar-EG"), solution), true, "native-digit answer accepted");
  assert.equal(checkTextCaptchaAnswer(localizeDigits(ascii, "fa-IR"), solution), true, "another script's digits also normalize");
});

test("locale: alphanumeric codes are never digit-localized (no mixed-script codes)", async () => {
  let drawn = "";
  const spy: TextRendererProvider = {
    async render(code, options): Promise<RenderedImage> {
      drawn = code;
      return new SvgTextRenderer().render(code, options);
    },
  };
  const { solution } = await buildTextCaptchaChallenge({ renderer: spy, mode: "alphanumeric", length: 10, locale: "ar-EG" });
  assert.equal(drawn, (solution as { code: string }).code);
});

test("locale: the renderer escapes markup-significant characters", async () => {
  const svg = (await new SvgTextRenderer().render("<&>", {})).data.toString("utf8");
  assert.ok(svg.includes("&lt;") && svg.includes("&amp;") && svg.includes("&gt;"));
  assert.ok(!svg.includes("><&>"), "no raw markup characters inside <text>");
});
