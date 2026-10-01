# Contributing

## Development setup

This is an npm workspaces monorepo. You'll need Node.js 22.6+ (for native TypeScript execution during development; the published packages target Node 18+ at runtime once built).

```bash
git clone <this-repo>
cd oorable-captcha
npm install
```

Some packages have **peer dependencies** that are not installed automatically (`express`, `fastify`, `ioredis`, `react`, `sharp`) -- install the ones relevant to what you're working on.

## Running things

```bash
npm test                              # core package's tests (see below for per-package)
node --experimental-strip-types --test packages/<name>/test/*.test.ts
npm run build --workspaces --if-present
npm run typecheck --workspaces --if-present
```

Packages run their own tests directly against `.ts` sources via Node's native TypeScript support -- no separate compile step is needed to run tests, only to publish (`npm run build`).

## Coding standards

- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`). No `any` without a specific reason in a comment.
- Every random value that matters for security comes from `node:crypto` (`secureRandomId`, `secureRandomInt`, `secureShuffle`, ...) -- never `Math.random()`.
- No placeholder security logic. If something isn't implemented, say so in `docs/limitations.md` rather than half-implementing it.
- New server-observable behavior needs a test. New security-relevant behavior needs a test that would fail if the behavior regressed (see `packages/*/test/*security*.test.ts` for the style: answer-leakage checks, replay checks, race checks).
- Relative imports use explicit `.ts` extensions (see `tsconfig.base.json`'s `rewriteRelativeImportExtensions` -- this lets test files run directly via `node --experimental-strip-types` without a build step, and still compiles correctly to `.js` specifiers for publishing).

## Tests that need infrastructure you might not have

- `packages/redis/test/integration.test.ts` needs a real Redis server (`REDIS_URL`, default `redis://127.0.0.1:6379`) and `ioredis` installed. It skips itself with a clear message if either is missing -- it does not fake a pass.
- `packages/web/test/browser.test.ts` and `packages/react/test/react.test.ts` need `playwright` with Chromium installed (`npx playwright install chromium`).

## Pull requests

1. Fork, branch, make your change with tests.
2. `npm run typecheck --workspaces --if-present` and the relevant package's tests must pass.
3. Update `docs/limitations.md` if you've removed a limitation, or `CHANGELOG.md` under "Unreleased."
4. Describe the security implications of your change in the PR description if it touches token handling, the challenge lifecycle, or asset resolution -- see the "If an implementation choice has security implications" note in the project brief this repo was built from.

## Reporting bugs vs. vulnerabilities

Functional bugs: open a GitHub issue. Security vulnerabilities: see [SECURITY.md](SECURITY.md) -- do not open a public issue.
