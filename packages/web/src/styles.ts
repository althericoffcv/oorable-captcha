/**
 * Widget styles, injected into the widget's shadow root so the host page's CSS
 * can neither break the widget nor be broken by it.
 *
 * Theming: every colour is a token defined on `.oc`. A host page can override
 * any of them from outside the shadow boundary (custom properties inherit),
 * e.g. `#captcha { --oorable-accent: #0a7; }`. Supported: --oorable-bg,
 * --oorable-surface, --oorable-ink, --oorable-muted, --oorable-border,
 * --oorable-accent, --oorable-primary-bg, --oorable-primary-ink,
 * --oorable-success, --oorable-danger, --oorable-focus.
 *
 * Design intent: the puzzle is the hero, so there is no decoration around it.
 * Ink navy carries structure and the primary action; a single coral accent is
 * spent on the two things that must never be missed -- the selected piece and
 * the brand mark. Focus uses a separate blue so "selected" and "focused" are
 * never confused. Nothing relies on hover, every target is at least 44px, and
 * motion is decoration only (removed under prefers-reduced-motion).
 */
const RAW_CSS = `
:host { display: block; max-width: 360px; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }

.oc {
  --oc-bg: var(--oorable-bg, #FAFAF7);
  --oc-surface: var(--oorable-surface, #FFFFFF);
  --oc-ink: var(--oorable-ink, #1B1F3B);
  --oc-muted: var(--oorable-muted, #565B75);
  --oc-border: var(--oorable-border, #D5D8E4);
  --oc-accent: var(--oorable-accent, #FF6F59);
  --oc-primary-bg: var(--oorable-primary-bg, #1B1F3B);
  --oc-primary-ink: var(--oorable-primary-ink, #FFFFFF);
  --oc-success: var(--oorable-success, #157347);
  --oc-danger: var(--oorable-danger, #B42318);
  --oc-focus: var(--oorable-focus, #2B4EFF);
  --oc-shadow: 0 1px 2px rgba(27, 31, 59, 0.06), 0 10px 28px rgba(27, 31, 59, 0.08);
  color: var(--oc-ink);
  font: 400 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
}

.oc[data-theme="dark"] {
  --oc-bg: var(--oorable-bg, #14162B);
  --oc-surface: var(--oorable-surface, #1D2040);
  --oc-ink: var(--oorable-ink, #F1F2FA);
  --oc-muted: var(--oorable-muted, #A9AECB);
  --oc-border: var(--oorable-border, #363A63);
  --oc-accent: var(--oorable-accent, #FF8A78);
  --oc-primary-bg: var(--oorable-primary-bg, #F1F2FA);
  --oc-primary-ink: var(--oorable-primary-ink, #14162B);
  --oc-success: var(--oorable-success, #4CC38A);
  --oc-danger: var(--oorable-danger, #FF8A80);
  --oc-focus: var(--oorable-focus, #9DB1FF);
  --oc-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 28px rgba(0, 0, 0, 0.35);
}

@media (prefers-color-scheme: dark) {
  .oc[data-theme="auto"] {
    --oc-bg: var(--oorable-bg, #14162B);
    --oc-surface: var(--oorable-surface, #1D2040);
    --oc-ink: var(--oorable-ink, #F1F2FA);
    --oc-muted: var(--oorable-muted, #A9AECB);
    --oc-border: var(--oorable-border, #363A63);
    --oc-accent: var(--oorable-accent, #FF8A78);
    --oc-primary-bg: var(--oorable-primary-bg, #F1F2FA);
    --oc-primary-ink: var(--oorable-primary-ink, #14162B);
    --oc-success: var(--oorable-success, #4CC38A);
    --oc-danger: var(--oorable-danger, #FF8A80);
    --oc-focus: var(--oorable-focus, #9DB1FF);
    --oc-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 28px rgba(0, 0, 0, 0.35);
  }
}

.card {
  display: grid;
  gap: 12px;
  padding: 16px;
  background: var(--oc-bg);
  border: 1px solid var(--oc-border);
  border-radius: 16px;
  box-shadow: var(--oc-shadow);
}

.head { display: flex; align-items: center; gap: 10px; }
.mark { flex: none; width: 34px; height: 34px; }
.mark .ring-a { stroke: var(--oc-ink); }
.mark .ring-b { stroke: var(--oc-accent); }
.title { margin: 0; font-size: 13px; font-weight: 800; letter-spacing: 0.07em; line-height: 1.2; }
.tagline { margin: 2px 0 0; font-size: 12px; color: var(--oc-muted); line-height: 1.2; }
.instructions { margin: 0; }

.stage { position: relative; display: grid; gap: 10px; }

/* ---- tile grid (meme puzzle + image choice) ---- */
.grid {
  display: grid;
  grid-template-columns: repeat(var(--oc-cols, 3), minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  direction: ltr; /* pictures never mirror, whatever the page direction */
  background: var(--oc-border);
  border-radius: 16px;
}

.tile {
  appearance: none;
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 10px;
  background: var(--oc-surface);
  color: inherit;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: transform 140ms ease, box-shadow 140ms ease;
}
.tile img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

@media (hover: hover) {
  .tile:not([aria-pressed="true"]):hover { transform: translateY(-1px); }
}

.tile:focus-visible { outline: 3px solid var(--oc-focus); outline-offset: 2px; z-index: 3; }

.tile[aria-pressed="true"] {
  z-index: 2;
  transform: scale(1.04);
  box-shadow: inset 0 0 0 4px var(--oc-accent), 0 8px 18px rgba(27, 31, 59, 0.35);
}
.tile[aria-pressed="true"]::after {
  content: "";
  position: absolute;
  top: 6px;
  right: 6px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--oc-accent);
  border: 2px solid var(--oc-surface);
}

.tile.is-dragging { opacity: 0.55; }
.tile:disabled { opacity: 0.3; cursor: not-allowed; filter: grayscale(1); }
.tile.is-target { box-shadow: inset 0 0 0 4px var(--oc-focus); }

.grid.is-skeleton .tile { cursor: default; background: var(--oc-surface); opacity: 0.6; animation: oc-pulse 1.2s ease-in-out infinite; }

.grid.is-shaking { animation: oc-shake 360ms ease; }

/* ---- text challenge ---- */
.code-img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 12px;
  border: 1px solid var(--oc-border);
  background: #F4F4F5;
}
.field-label { display: block; margin: 0 0 4px; font-size: 12px; font-weight: 600; color: var(--oc-muted); }
.field {
  width: 100%;
  min-height: 48px;
  padding: 0 12px;
  border: 2px solid var(--oc-border);
  border-radius: 10px;
  background: var(--oc-surface);
  color: var(--oc-ink);
  font: 700 20px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.field:focus-visible { outline: 3px solid var(--oc-focus); outline-offset: 2px; }
.field[aria-invalid="true"] { border-color: var(--oc-danger); }

/* ---- status + actions ---- */
.status { min-height: 1.45em; margin: 0; font-weight: 600; }
.status[data-tone="info"] { color: var(--oc-muted); font-weight: 500; }
.status[data-tone="success"] { color: var(--oc-success); }
.status[data-tone="error"] { color: var(--oc-danger); }

.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.btn {
  appearance: none;
  min-height: 44px;
  padding: 0 18px;
  border: 2px solid transparent;
  border-radius: 10px;
  font: 600 14px/1 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  cursor: pointer;
  touch-action: manipulation;
}
.btn:focus-visible { outline: 3px solid var(--oc-focus); outline-offset: 2px; }
.btn-primary { background: var(--oc-primary-bg); color: var(--oc-primary-ink); }
.btn-secondary { background: transparent; border-color: var(--oc-border); color: var(--oc-ink); }
.btn[disabled] { opacity: 0.55; cursor: not-allowed; }

/* ---- states ---- */
.oc[data-state="verifying"] .stage { opacity: 0.7; pointer-events: none; }
.oc[data-state="success"] .stage .grid,
.oc[data-state="success"] .stage .field,
.oc[data-state="success"] .stage .code-img { pointer-events: none; opacity: 0.55; }
.oc[data-state="expired"] .stage,
.oc[data-state="error"] .stage,
.oc[data-state="blocked"] .stage { opacity: 0.5; pointer-events: none; }

.badge {
  position: absolute;
  inset: 0;
  display: none;
  place-items: center;
  pointer-events: none;
}
.badge span {
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: var(--oc-success);
  color: #FFFFFF;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  animation: oc-pop 280ms cubic-bezier(0.2, 1.4, 0.4, 1);
}
.oc[data-state="success"] .badge { display: grid; }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes oc-shake { 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
@keyframes oc-pop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes oc-pulse { 50% { opacity: 0.95; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .tile[aria-pressed="true"] { transform: none; }
}

@media (forced-colors: active) {
  .card, .grid, .field, .code-img { border: 1px solid CanvasText; }
  .tile { border: 1px solid CanvasText; }
  .tile[aria-pressed="true"] { outline: 4px solid Highlight; outline-offset: -4px; box-shadow: none; }
  .tile[aria-pressed="true"]::after { background: Highlight; border-color: Canvas; }
  .tile:focus-visible, .btn:focus-visible, .field:focus-visible { outline: 3px solid CanvasText; }
  .btn-primary { background: ButtonText; color: ButtonFace; }
  .badge span { background: Highlight; color: HighlightText; }
}
`;

/** Comments stripped and whitespace collapsed; CSS in this file contains no strings that this could damage. */
export const STYLES: string = RAW_CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
