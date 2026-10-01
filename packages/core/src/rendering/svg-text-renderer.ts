import { secureRandomInt } from "../crypto/random.ts";
import type { TextRendererProvider, RenderedImage } from "./renderer-provider.ts";

// A generic, portable system-font stack -- this markup may end up
// rendered by a browser, a bot-platform image viewer, or converted to
// a raster format server-side, so it deliberately does not depend on
// any bundled/custom font file.
const FONT_STACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * Default, dependency-free text CAPTCHA renderer. Produces an SVG
 * image (image/svg+xml) -- browsers and most web contexts render this
 * natively. Bot platforms that require a raster format (PNG/JPEG) for
 * photo messages need a raster provider on top of this; see
 * docs/bot.md for an example wiring a `sharp`- or `resvg`-based
 * converter behind the same TextRendererProvider interface.
 *
 * Locale note: this renderer handles left-to-right alphanumeric codes
 * well. It does not implement complex text shaping (RTL scripts,
 * Indic conjuncts, etc.) -- see docs/limitations.md.
 */
export class SvgTextRenderer implements TextRendererProvider {
  async render(code: string, options: { width?: number; height?: number } = {}): Promise<RenderedImage> {
    const width = options.width ?? 220;
    const height = options.height ?? 80;
    const chars = Array.from(code);
    const charWidth = width / (chars.length + 1);

    const noise = Array.from({ length: 6 }, () => {
      const x1 = secureRandomInt(0, width);
      const y1 = secureRandomInt(0, height);
      const x2 = secureRandomInt(0, width);
      const y2 = secureRandomInt(0, height);
      const hue = secureRandomInt(0, 360);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="hsl(${hue} 40% 70%)" stroke-width="2" opacity="0.5" />`;
    }).join("");

    const dots = Array.from({ length: 24 }, () => {
      const cx = secureRandomInt(0, width);
      const cy = secureRandomInt(0, height);
      const hue = secureRandomInt(0, 360);
      return `<circle cx="${cx}" cy="${cy}" r="1.6" fill="hsl(${hue} 50% 60%)" opacity="0.6" />`;
    }).join("");

    const glyphs = chars
      .map((ch, i) => {
        const cx = charWidth * (i + 1);
        const cy = height / 2 + secureRandomInt(-6, 7);
        const rotate = secureRandomInt(-22, 23);
        const hue = secureRandomInt(0, 360);
        const size = secureRandomInt(30, 40);
        const escaped = ch.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<text x="${cx}" y="${cy}" font-family="${FONT_STACK}" font-size="${size}" font-weight="700" fill="hsl(${hue} 55% 35%)" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rotate} ${cx} ${cy})">${escaped}</text>`;
      })
      .join("");

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="CAPTCHA code image">` +
      `<rect width="${width}" height="${height}" fill="#f4f4f5" />` +
      noise +
      dots +
      glyphs +
      `</svg>`;

    return { contentType: "image/svg+xml", data: Buffer.from(svg, "utf8") };
  }
}
