// Entry point for the plain-<script> build (dist/oorable-captcha[.min].js).
// Bundled as an IIFE, so this file's only job is to hang the public API off
// `window.OorableCaptcha` -- see docs/web.md for the <script> quick start.
import { render } from "./index.ts";
import type { CaptchaHandle, RenderOptions } from "./widget.ts";

declare global {
  interface Window {
    OorableCaptcha?: { render: typeof render };
  }
}

if (typeof window !== "undefined") {
  window.OorableCaptcha = { render };
}

export type { CaptchaHandle, RenderOptions };
export { render };
