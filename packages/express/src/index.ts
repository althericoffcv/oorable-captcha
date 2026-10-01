import type { Request, Response, Router } from "express";
import type { CaptchaApi } from "@oorable/captcha-server";

export interface ExpressAdapterOptions {
  /**
   * Trust `X-Forwarded-For`? Pass the exact number of reverse proxies YOU
   * operate in front of this app (0 by default: use the raw socket address).
   * If your Express app already calls `app.set("trust proxy", n)`, pass the
   * same `n` here so client IPs (and rate limiting) agree with Express's own
   * view of the request.
   */
  trustProxyHops?: number;
}

function clientIpFromExpress(req: Request, trustProxyHops: number): string {
  if (trustProxyHops > 0) {
    const header = req.headers["x-forwarded-for"];
    const list = (Array.isArray(header) ? header.join(",") : (header ?? ""))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length >= trustProxyHops) return list[list.length - trustProxyHops]!;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** The minimal surface this package needs from an Express app or Router. Both satisfy it already. */
export interface ExpressMountTarget {
  use(handler: (req: Request, res: Response) => void | Promise<void>): unknown;
}

/**
 * Mounts the OORABLE CAPTCHA REST API onto an Express app (or a Router you
 * already created), rather than constructing and returning its own Router.
 * That keeps this package's only dependency on `express` a TYPE-only one
 * (`import type`, erased at compile time) -- there is nothing here that
 * calls into the `express` module at runtime, so this file has no hard
 * runtime dependency on `express` actually being installed to load
 * (constructing an unused `Router()` internally would have created exactly
 * that dependency for no benefit).
 *
 * Your app is responsible for JSON body parsing (`app.use(express.json())`)
 * upstream of this call -- Express conventionally owns that, and re-parsing
 * it here would double-consume the request stream.
 *
 *   import express from "express";
 *   import { mountOorableCaptcha } from "@oorable/captcha-express";
 *
 *   const app = express();
 *   app.use(express.json({ limit: "16kb" }));
 *   mountOorableCaptcha(app, api);
 */
export function mountOorableCaptcha(target: ExpressMountTarget, api: CaptchaApi, options: ExpressAdapterOptions = {}): void {
  const trustProxyHops = options.trustProxyHops ?? 0;

  target.use(async (req: Request, res: Response) => {
    const result = await api.handle({
      method: req.method,
      path: req.path,
      query: req.query as Record<string, string>,
      headers: req.headers,
      ip: clientIpFromExpress(req, trustProxyHops),
      body: req.body,
      // Express's own json() middleware reports parse failures via next(err) before
      // this handler ever runs, so a request that reaches us always has a body of
      // some kind (possibly undefined, e.g. for GET) -- there is no separate
      // bodyError channel to fill in here, unlike the raw node:http transport.
    });

    for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
    if (result.raw) res.status(result.status).send(result.raw);
    else res.status(result.status).json(result.json ?? {});
  });
}

export type { Router };
