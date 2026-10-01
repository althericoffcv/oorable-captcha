// SANDBOX-ONLY ambient shim (see react-shim.d.ts for the rationale): no
// network access here to install the real `fastify` types, which a real
// consumer gets normally since `fastify` is a peerDependency. Minimal by
// design: just the surface this package's own code actually uses.
declare module "fastify" {
  export interface FastifyRequest {
    method: string;
    url: string;
    query: unknown;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    ip: string;
  }
  export interface FastifyReply {
    status(code: number): this;
    header(name: string, value: string): this;
    send(body?: unknown): this;
  }
  export interface FastifyInstance {
    all(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => void | Promise<void>): unknown;
  }
}
