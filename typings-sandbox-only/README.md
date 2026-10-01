# Sandbox-only type shims

These `.d.ts` files exist **only** to let this repository's own packages be
type-checked in the environment they were built in, which has no network
access and therefore could not `npm install` a few peer dependencies
(`express`, `fastify`, `@types/react`). They are minimal, hand-written
declarations of just the surface this repo's own code actually calls --
not copies of the real packages' types.

They are **not** referenced by any package's real `tsconfig.json` (only by
the repo's local sandbox-verification scripts) and are **not** part of any
published package (`files` in each `package.json` only includes `dist`).
A real consumer installing these packages resolves `express`/`fastify`/
`react` types from their own real, installed copies, unaffected by anything
here -- see `docs/limitations.md` for the full explanation and how this was
verified (by inspecting the actual emitted `.d.ts` output).

Safe to delete entirely if you have network access and just run
`npm install` for real.
