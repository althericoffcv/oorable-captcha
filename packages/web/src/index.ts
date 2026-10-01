export { CaptchaWidget } from "./widget.ts";
export type { RenderOptions, CaptchaHandle } from "./widget.ts";
export { resolveMessages, formatMessage, isRtl, BUNDLED_MESSAGES } from "./messages.ts";
export type { Messages } from "./messages.ts";

import { CaptchaWidget, type RenderOptions, type CaptchaHandle } from "./widget.ts";

function resolveTarget(target: string | Element): HTMLElement {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el || !(el instanceof HTMLElement)) {
    throw new Error(`OORABLE CAPTCHA: could not find a mount element for "${String(target)}"`);
  }
  return el;
}

/**
 * Mounts a CAPTCHA widget into `target` (a CSS selector or element) and
 * starts loading a challenge immediately. Matches the README quick start:
 *
 *   OorableCaptcha.render("#captcha", { siteKey: "...", type: "meme-puzzle" });
 */
export function render(target: string | Element, options: RenderOptions = {}): CaptchaHandle {
  const el = resolveTarget(target);
  el.replaceChildren();
  const widget = new CaptchaWidget(el, options);
  void widget.start();
  return widget;
}
