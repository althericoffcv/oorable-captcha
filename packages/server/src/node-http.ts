import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { clientIp } from "./ip.ts";
import type { ApiRequest, ApiResponse, CaptchaApi } from "./api.ts";

export interface NodeHandlerOptions {
  /** Largest accepted request body. Answers are tiny; the default is 16 KiB. */
  maxBodyBytes?: number;
  /** How long a client may take to deliver the body before it is cut off. Default 5s. */
  bodyTimeoutMs?: number;
  /**
   * How many reverse proxies YOU operate sit in front of this server.
   * 0 (default): the socket address is the client, X-Forwarded-For is ignored.
   * N: the client is the Nth-from-right X-Forwarded-For entry.
   */
  trustProxyHops?: number;
}

type BodyResult = { body?: unknown; bodyError?: NonNullable<ApiRequest["bodyError"]> };

/**
 * Reads a JSON body with a hard byte ceiling. It stops consuming the stream the
 * moment the limit is crossed rather than buffering an attacker-sized upload,
 * and it gives up on clients that trickle the body in (slowloris).
 */
export function readJsonBody(req: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!/^application\/json(\s*;|$)/.test(contentType)) {
      resolve({ bodyError: "unsupported_media_type" });
      return;
    }
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      resolve({ bodyError: "payload_too_large" });
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (result: BodyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off("data", onData);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ bodyError: "body_timeout" }), timeoutMs);
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish({ bodyError: "payload_too_large" });
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => {
      try {
        finish({ body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        finish({ bodyError: "invalid_json" });
      }
    });
    req.on("error", () => finish({ bodyError: "invalid_json" }));
  });
}

function writeResponse(res: ServerResponse, apiRes: ApiResponse, closeAfter: boolean): void {
  const body =
    apiRes.raw ?? (apiRes.json !== undefined ? Buffer.from(JSON.stringify(apiRes.json), "utf8") : undefined);
  const headers: Record<string, string> = { ...apiRes.headers };
  if (apiRes.json !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json; charset=utf-8";
  if (body) headers["Content-Length"] = String(body.length);
  if (closeAfter) headers["Connection"] = "close";
  res.writeHead(apiRes.status, headers);
  res.end(body, () => {
    // An unread request body may still be arriving; do not keep the connection open for it.
    if (closeAfter) res.socket?.destroy();
  });
}

/** Adapts a CaptchaApi to a plain `(req, res)` handler usable with node:http, or mounted in Express/Connect. */
export function createNodeHandler(api: CaptchaApi, options: NodeHandlerOptions = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? 16 * 1024;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 5_000;
  const trustProxyHops = options.trustProxyHops ?? 0;

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = (req.method ?? "GET").toUpperCase();
      const rawUrl = req.url ?? "/";
      const queryStart = rawUrl.indexOf("?");
      const path = queryStart === -1 ? rawUrl : rawUrl.slice(0, queryStart);
      const query = Object.fromEntries(new URLSearchParams(queryStart === -1 ? "" : rawUrl.slice(queryStart + 1)));

      let read: BodyResult = {};
      if (method === "POST") read = await readJsonBody(req, maxBodyBytes, bodyTimeoutMs);

      const apiReq: ApiRequest = {
        method,
        path,
        query,
        headers: req.headers,
        ip: clientIp(req.socket.remoteAddress, req.headers["x-forwarded-for"], trustProxyHops),
        body: read.body,
        bodyError: read.bodyError,
      };
      const apiRes = await api.handle(apiReq);
      writeResponse(res, apiRes, read.bodyError !== undefined && read.bodyError !== "invalid_json");
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      }
      res.end(JSON.stringify({ error: "internal_error" }));
    }
  };
}

export interface StartServerOptions extends NodeHandlerOptions {
  port?: number;
  host?: string;
}

export interface RunningServer {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Starts a standalone HTTP server around an API. Port 0 picks a free port. */
export function startServer(api: CaptchaApi, options: StartServerOptions = {}): Promise<RunningServer> {
  const handler = createNodeHandler(api, options);
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        port,
        url: `http://${options.host ?? "127.0.0.1"}:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
