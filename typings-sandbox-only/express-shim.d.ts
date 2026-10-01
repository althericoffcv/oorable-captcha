// SANDBOX-ONLY ambient shim (see react-shim.d.ts for the same rationale):
// no network access here to install the real `express`/`@types/express`,
// which a real consumer gets normally since `express` is a peerDependency.
// Minimal by design: just the surface this package's own code actually uses.
declare module "express" {
  import type { Socket } from "node:net";

  export interface Request {
    method: string;
    path: string;
    query: unknown;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    socket: Socket;
  }
  export interface Response {
    status(code: number): this;
    setHeader(name: string, value: string): this;
    send(body?: unknown): this;
    json(body: unknown): this;
  }
  export type RequestHandler = (req: Request, res: Response) => void | Promise<void>;
  export interface Router {
    use(handler: RequestHandler): this;
  }
  export function Router(): Router;
}
