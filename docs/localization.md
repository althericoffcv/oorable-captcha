# Localization

## Widget UI strings

Bundled translations (`packages/web/src/messages.ts`): English, Indonesian, Spanish, French, German, Portuguese. Pick one via `locale` (`"id-ID"`, `"es"`, ...; matched by language subtag, falling back to English), or override individual strings with `messages`:

```ts
OorableCaptcha.render("#el", { locale: "fr", messages: { verify: "Confirmer" } });
```

These bundled translations have not been reviewed by native-speaker QA -- treat them as a solid starting point and override anything that reads awkwardly for your audience.

Right-to-left languages get `dir="rtl"` on the widget root automatically (`isRtl()` checks the language subtag against a known RTL list: Arabic, Hebrew, Persian, Urdu, Pashto, Sindhi, Uyghur, Yiddish, Divehi, Central Kurdish), but no RTL language's *strings* are bundled yet -- supply your own via `messages` alongside a `dir`-appropriate `locale`.

Puzzle image tiles are laid out with an explicit `direction: ltr` regardless of page/UI direction -- pictures should never mirror.

## Text CAPTCHA digit rendering

Numeric codes are drawn using the target locale's native digit glyphs where Node's ICU data supports it (`Intl.NumberFormat(locale).resolvedOptions().numberingSystem`) -- e.g. Arabic-Indic for `ar-EG`, Persian for `fa-IR`, Bengali for `bn-BD`, Devanagari for `mr-IN`, Burmese for `my-MM`. The **stored answer is always ASCII digits**; the answer check (`normalizeDigits`) accepts the reply in *any* of these digit systems, not just the one that was drawn, so a user can type with whatever keyboard they have. An unrecognized, missing, or malformed locale tag falls back to plain ASCII digits without throwing.

```ts
await engine.createChallenge({ type: "text", mode: "numeric", locale: "ar-EG" });
// the image shows ٠١٢٣٤٥٦٧٨٩-style digits; "012345" and "٠١٢٣٤٥" both verify
```

Alphanumeric codes are never digit-localized (mixing scripts within one code would make it harder to read, not easier).

## What is not implemented

**General text shaping** for complex scripts -- Arabic/Hebrew letter joining and RTL reordering, Indic conjunct consonants, Thai line-breaking rules, and so on -- is not implemented in the default `SvgTextRenderer`. It positions independent glyphs along a line, which works well for the Latin-script alphanumeric codes this project's text CAPTCHA is built around, and for the digit-only localization above, but would render complex-script *letters* (not just digits) incorrectly or illegibly. If you need a fully-shaped non-Latin alphabetic CAPTCHA, implement `TextRendererProvider` with a real text-shaping engine (a headless browser, `canvas` with the OS's own text layout, or a dedicated shaping library) behind the same interface -- the engine doesn't care how the image was produced, only that it gets `{ contentType, data }` back.

See `docs/limitations.md` for the consolidated list.
