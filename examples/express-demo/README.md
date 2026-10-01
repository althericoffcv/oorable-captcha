# Express demo

A minimal, complete example wiring the REST API (via `@oorable/captcha-express`) and the web widget together. This directory is **not** part of the npm workspaces build -- it has its own `package.json` and is meant to be copied out and run on its own, with network access, once you've built or published the workspace packages.

```bash
npm install
npx oorable-captcha init   # or export OORABLE_CAPTCHA_SECRET yourself
npm start
# open http://localhost:3000
```

See `docs/deployment.md` before using this structure for anything real -- this demo deliberately skips the `sites` registry and other production configuration for brevity.
