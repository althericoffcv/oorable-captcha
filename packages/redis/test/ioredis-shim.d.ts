// SANDBOX-ONLY ambient shim so this package's own code can be strictly
// type-checked without network access to install the real `ioredis` types.
// Never shipped: the real build (tsc -p tsconfig.json) only compiles src/,
// and any real consumer gets ioredis's own, complete types from the real
// package once installed. Kept intentionally minimal -- just the surface
// integration.test.ts actually uses.
declare module "ioredis" {
  export interface RedisOptions {
    lazyConnect?: boolean;
    retryStrategy?: (times: number) => number | null;
    connectTimeout?: number;
  }
  export class Redis {
    constructor(url: string, options?: RedisOptions);
    connect(): Promise<void>;
    ping(): Promise<string>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: string[]): Promise<unknown>;
    eval(script: string, numKeys: number, ...keysAndArgs: string[]): Promise<unknown>;
    keys(pattern: string): Promise<string[]>;
    del(...keys: string[]): Promise<number>;
    disconnect(): void;
  }
  export default Redis;
}
