# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ConfigurationError: No signing key configured` | `OORABLE_CAPTCHA_SECRET` isn't set and you didn't pass `keys` | `npx oorable-captcha init`, or pass `keys: new StaticKeyProvider(...)` explicitly |
| `ConfigurationError: ... must be at least 32 bytes` | Your secret is too short | Generate a real one with `init`, don't hand-type a short string |
| Every challenge fails with `reason: "invalid"` immediately | Client and server disagree on `siteKey`, or the challenge already expired/was used | Check you're sending the same `siteKey` you created the challenge with; check your clock skew if TTLs seem off |
| `403 invalid_site` | `sites` is configured but the request's `siteKey` doesn't match any entry | Check the exact `siteKey` string, including trailing whitespace |
| `403 origin_not_allowed` | The request's `Origin` header isn't in that site's `allowedOrigins` | Add the origin, or omit `allowedOrigins` for that site if it's not browser-only |
| `429 rate_limited` immediately in development | Default limits are tighter than your manual testing pace | Pass a looser `rateLimit` config, or `rateLimit: false` for local dev only |
| Tile images 404 | Token expired (tied to the challenge's TTL), or you're pointing at the wrong `apiBaseUrl`/`tileBaseUrl` | Fetch a fresh challenge; check `tileBaseUrl` matches where you mounted the API |
| Puzzle images look like abstract colored circles, not a meme | You haven't run the asset pipeline yet -- this is `SyntheticAssetProvider`, the intentional zero-dependency placeholder | See `docs/asset-management.md` |
| `sharpToPng()` throws "needs the optional sharp package" | `sharp` isn't installed | `npm install sharp` |
| Redis integration tests report "skipped" | No `ioredis` and/or no reachable Redis server | Expected without both -- see `docs/redis.md` |
| `EADDRINUSE` starting the demo server | Something else is already on that port | Pass a different `port` to `startServer`, or free the port |
| TypeScript can't resolve a relative import in this monorepo's own source | You're running `tsc` without the `rewriteRelativeImportExtensions`/`allowImportingTsExtensions` combo this repo's `tsconfig.base.json` sets | Extend `tsconfig.base.json` rather than writing a fresh config; see `docs/installation.md` |
| `npm run assets:process` says it needs `sharp` | It's a dev-only tool dependency, not bundled | `npm install --save-dev sharp` in the repo root |

If none of these match, check `docs/limitations.md` -- it's possible you've hit something genuinely not implemented rather than misconfigured.
