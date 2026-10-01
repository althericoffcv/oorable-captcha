// Minimal end-to-end demo: an Express server hosting the REST API, plus a
// static page (public/index.html) that renders the web widget against it.
//
// Run:
//   1. npm install            (in this directory -- pulls express + this
//                               repo's packages; requires network)
//   2. npx oorable-captcha init   (from the repo root, or set
//                                   OORABLE_CAPTCHA_SECRET yourself)
//   3. node server.mjs
//   4. open http://localhost:3000
import express from "express";
import { createEngine } from "@oorable/captcha";
import { createApi } from "@oorable/captcha-server";
import { mountOorableCaptcha } from "@oorable/captcha-express";

const engine = createEngine(); // reads OORABLE_CAPTCHA_SECRET
const api = createApi({
  engine,
  // No `sites` configured: any site key is accepted. Fine for this demo,
  // NOT for production -- see docs/deployment.md.
  cors: { allowedOrigins: "*" }, // this demo serves the page and the API from
                                 // the same origin, so CORS isn't actually
                                 // needed here; shown for illustration only
});

const app = express();
app.use(express.json({ limit: "16kb" }));
mountOorableCaptcha(app, api);
app.use(express.static(new URL("./public", import.meta.url).pathname));

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`OORABLE CAPTCHA demo running at http://localhost:${port}`);
});
