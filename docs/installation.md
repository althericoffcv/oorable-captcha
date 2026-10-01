# Installation

## As a consumer of the published packages

```bash
npm install @oorable/captcha
```

Add whichever adapters you need:

```bash
npm install @oorable/captcha-server                     # REST API core
npm install @oorable/captcha-express express             # or:
npm install @oorable/captcha-fastify fastify
npm install @oorable/captcha-web                          # browser widget
npm install @oorable/captcha-react react react-dom        # React wrapper
npm install @oorable/captcha-bot                          # bot helper
npm install @oorable/captcha-redis ioredis                # multi-instance production
npm install --save-dev @oorable/captcha-cli               # `oorable-captcha` CLI
```

Then generate a signing secret:

```bash
npx oorable-captcha init
```

This writes `OORABLE_CAPTCHA_SECRET=<32+ random bytes>` into `.env` (never printing the value unless you pass `--show`). Load it however you already load environment variables (`dotenv`, your platform's secret manager, etc.) before calling `createEngine()`.

## Developing this monorepo itself

```bash
git clone <this-repo>
cd oorable-captcha
npm install
```

Requires **Node.js 22.6+** for native TypeScript execution (`node --experimental-strip-types`) during development; published packages only require Node 18+ at runtime once built. Package sources use `.ts` extensions in their own relative imports (e.g. `import { foo } from "./bar.ts"`) specifically so they can run directly under Node's native TypeScript support without a build step -- `tsconfig.base.json`'s `rewriteRelativeImportExtensions` then rewrites those to `.js` automatically when you do build (`tsc`), which is the correct extension for the published ESM output.

Run a package's tests directly:

```bash
node --experimental-strip-types --test packages/core/test/*.test.ts
```

Build everything:

```bash
npm run build --workspaces --if-present
```

Some packages have peer dependencies (`express`, `fastify`, `ioredis`, `react`, `sharp`) not installed by `npm install` alone -- install the ones you need for what you're working on. See `CONTRIBUTING.md`.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `OORABLE_CAPTCHA_SECRET` | Yes, unless you pass `keys` explicitly to `createEngine()` | HMAC/AES signing secret. 32+ bytes. |
| `REDIS_URL` | Only for `packages/redis`'s integration tests | Points the real-Redis test suite at a server; defaults to `redis://127.0.0.1:6379`. |

## Verifying your setup

```bash
npx oorable-captcha doctor
```

Checks your Node version, whether the signing secret is set and long enough (never prints its value), and whether the optional peer packages for adapters you might use (`express`, `fastify`, `ioredis`, `sharp`, `react`) are resolvable.
