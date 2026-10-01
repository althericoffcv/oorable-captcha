# Web integration

## Plain HTML/JS

```html
<div id="oorable-captcha"></div>
<script src="https://your-cdn/oorable-captcha.min.js"></script>
<script>
  const handle = OorableCaptcha.render("#oorable-captcha", {
    siteKey: "pk_live_...",
    type: "meme-puzzle",           // "meme-puzzle" | "text" | "image"
    apiBaseUrl: "https://captcha.example.com", // omit for same-origin
    theme: "auto",                  // "auto" | "light" | "dark"
    locale: "id-ID",                 // omit to use the browser's language
    onSuccess: (token) => { /* token also lands in a hidden form field automatically */ },
    onError: (err) => console.warn(err.code, err.message),
  });

  // handle.reset(), handle.destroy(), handle.getToken() are all available.
</script>
```

Build the standalone script yourself with `npm run build` in `packages/web` (emits `dist/oorable-captcha.js` and a minified `dist/oorable-captcha.min.js`, ~37 KB minified, zero runtime dependencies beyond `@oorable/captcha-client`, which is bundled in).

## Form integration

If `#oorable-captcha` lives inside a `<form>`, the widget automatically creates (or reuses) a hidden `<input type="hidden" name="oorable-captcha-token">` and keeps it in sync -- submit the form normally and your backend receives the token as a regular field. Override the field name with `tokenFieldName`, or pass `tokenFieldName: false` to opt out and read `handle.getToken()` yourself.

## React

```tsx
import { OorableCaptcha, type OorableCaptchaRef } from "@oorable/captcha-react";
import { useRef } from "react";

function SignupForm() {
  const captchaRef = useRef<OorableCaptchaRef>(null);
  return (
    <form>
      <OorableCaptcha
        ref={captchaRef}
        siteKey="pk_live_..."
        type="meme-puzzle"
        onSuccess={(token) => setFieldValue("captchaToken", token)}
      />
    </form>
  );
}
```

`<OorableCaptcha>` is a thin wrapper: it mounts/unmounts the same tested `CaptchaWidget` from `@oorable/captcha-web` and only remounts (fetching a fresh challenge) when a prop that changes *what* challenge to show changes (`siteKey`, `type`, `apiBaseUrl`, `difficulty`, `locale`, `theme`, `sessionId`, `dragAndDrop`, `tokenFieldName`, `nonce`, `messages`, `fetch`). Passing a new inline `onSuccess`/`onError`/`onExpired` function on every render does **not** cause a remount.

## Accessibility

- Full keyboard control: Tab focuses one tile (roving `tabindex`), arrow keys move focus, Enter/Space picks up and drops a tile to swap, Escape cancels a pickup.
- Every state change and swap is announced via `aria-live` regions, without spamming (announcements are debounced and rate-limited for the "blocked/rate limited" countdown).
- Drag-and-drop is an *optional addition* (`dragAndDrop: false` to disable it) -- tap/click and keyboard always work regardless.
- Visible focus rings, `forced-colors` (Windows High Contrast) support, `prefers-reduced-motion` respected (the "wrong answer" shake animation and others are disabled).
- Touch targets are at least 44x44px, verified down to a 320px viewport.
- No interaction depends on `:hover`.

All of the above is verified in a real Chromium browser via Playwright, not just asserted -- see `packages/web/test/browser.test.ts`.

## Theming

Override any of these CSS custom properties on the mount element (they inherit into the widget's shadow root):

```css
#oorable-captcha {
  --oorable-bg: #fafaf7;
  --oorable-ink: #1b1f3b;
  --oorable-accent: #ff6f59;
  --oorable-primary-bg: #1b1f3b;
  --oorable-primary-ink: #ffffff;
  --oorable-success: #157347;
  --oorable-danger: #b42318;
  --oorable-focus: #2b4eff;
}
```

`theme: "dark"` / `"light"` picks the built-in dark/light values above; `"auto"` (default) follows `prefers-color-scheme`.

## Localization

Bundled: English, Indonesian, Spanish, French, German, Portuguese (`locale` prop, e.g. `"id-ID"`; falls back to the language subtag, then to English). Override any string with `messages`:

```ts
OorableCaptcha.render("#el", { messages: { verify: "Периверить" } });
```

Right-to-left languages (Arabic, Hebrew, Persian, Urdu, ...) get `dir="rtl"` automatically, though none are bundled yet -- pass your own `messages` alongside a `dir`-aware `locale`. See `docs/localization.md`.
