/**
 * Locale-aware digit handling for numeric text CAPTCHAs.
 *
 * Scope, stated honestly: this localizes the *digit glyphs* (e.g. Arabic-Indic
 * for ar-EG, Persian for fa-IR, Bengali for bn-BD). It does not implement
 * general text shaping for other scripts -- see docs/localization.md.
 */

const MAX_LOCALE_LENGTH = 35; // longest well-formed BCP 47 tags are shorter than this

function numberingSystemFor(locale: string | undefined): string {
  if (!locale || locale.length > MAX_LOCALE_LENGTH) return "latn";
  try {
    return new Intl.NumberFormat(locale).resolvedOptions().numberingSystem;
  } catch {
    // RangeError for malformed language tags: fall back to Latin digits.
    return "latn";
  }
}

/** Renders ASCII digits in the locale's native digit system. Returns the input unchanged for Latin-digit locales. */
export function localizeDigits(digits: string, locale: string | undefined): string {
  const system = numberingSystemFor(locale);
  if (system === "latn") return digits;
  try {
    const format = new Intl.NumberFormat("en", { numberingSystem: system, useGrouping: false });
    return digits.replace(/[0-9]/g, (d) => format.format(Number(d)));
  } catch {
    return digits;
  }
}

/**
 * Maps any Unicode decimal digit (Arabic-Indic, Persian, Devanagari, ...) to
 * its ASCII equivalent, so a user may type the digits in either script.
 * Callers should bound the input length first.
 */
export function normalizeDigits(input: string): string {
  return input.replace(/\p{Nd}/gu, (ch) => {
    const codePoint = ch.codePointAt(0)!;
    // Decimal digits come in aligned runs of ten starting at a zero glyph.
    let start = codePoint;
    while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((codePoint - start) % 10);
  });
}
