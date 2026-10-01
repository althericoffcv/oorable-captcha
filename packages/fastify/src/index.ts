import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CaptchaApi } from "@oorable/captcha-server";

export interface FastifyAdapterOptions {
  /**
   * Trust `X-Forwarded-For`? Pass the exact number of reverse proxies YOU
   * operate in front of this app (0 by default: use the raw socket
   * address). If you already run Fastify behind `trustProxy`, pass the same
   * hop count here so client IPs (and rate limiting) agree with Fastify's
   * own view of the request.
   */
  trustProxyHops?: number;
}

function clientIpFromFastify(req: FastifyRequest, trustProxyHops: number): string {
  if (trustProxyHops > 0) {
    const header = req.headers["x-forwarded-for"];
    const list = (Array.isArray(header) ? header.join(",") : (header ?? ""))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length >= trustProxyHops) return list[list.length - trustProxyHops]!;
  }
  return req.ip;
}

/**
 * Registers the OORABLE CAPTCHA REST API as a catch-all route under `/v1/*`
 * on a Fastify instance you already created.
 *
 * Like @oorable/captcha-express, this depends on `fastify` for TYPES only
 * (`import type`, erased at compile time) -- nothing here calls into the
 * real `fastify` module at runtime, so this file has no hard runtime
 * dependency on `fastify` actually being installed to load. You register it
 * with a plugin function you already have (your own Fastify instance's
 * `.all()`/`.get()` etc. methods).
 *
 * Fastify parses JSON bodies itself by default; this adapter reads
 * `req.body` the same way it reads anything else Fastify already parsed.
 *
 *   import Fastify from "fastify";
 *   import { registerOorableCaptcha } from "@oorable/captcha-fastify";
 *
 *   const app = Fastify();
 *   registerOorableCaptcha(app, api);
 */
export function registerOorableCaptcha(app: FastifyMountTarget, api: CaptchaApi, options: FastifyAdapterOptions = {}): void {
  const trustProxyHops = options.trustProxyHops ?? 0;

  app.all("/v1/*", async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await api.handle({
      method: req.method,
      path: req.url.split("?")[0]!,
      query: req.query as Record<string, string>,
      headers: req.headers,
      ip: clientIpFromFastify(req, trustProxyHops),
      body: req.body,
    });

    reply.status(result.status);
    for (const [name, value] of Object.entries(result.headers)) reply.header(name, value);
    if (result.raw) reply.send(result.raw);
    else reply.send(result.json ?? {});
  });
}

/** The minimal surface this package needs from a Fastify instance. */
export interface FastifyMountTarget {
  all(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => void | Promise<void>): unknown;
}

export type { FastifyInstance };
