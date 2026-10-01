import type { ChallengeStore, ChallengeRecord } from "@oorable/captcha";
import type { RateLimiter, RateLimitResult } from "@oorable/captcha";

/**
 * The minimal client surface these adapters need. `ioredis`, `node-redis`
 * (v4+, via its `eval`/`set`/`get`/`del` methods) and most Redis-protocol
 * clients already satisfy this shape; adapt yours if it does not.
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: string[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval(script: string, numKeys: number, ...keysAndArgs: string[]): Promise<unknown>;
}

// ------------------------------------------------------------------- store

/**
 * Every script is a single atomic Redis operation: no other client's
 * command can interleave between the GET and the SET, which is exactly
 * the property tryConsume()/tryRedeem()/incrementAttempts() need across
 * multiple server processes. See docs/redis.md for the full write-up
 * and docs/threat-model.md for why this matters (a naive
 * GET-then-SET from application code is a race).
 */
const TRY_CONSUME_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.consumed then return 0 end
record.consumed = true
local ttl = redis.call("PTTL", KEYS[1])
if ttl and ttl > 0 then
  redis.call("SET", KEYS[1], cjson.encode(record), "PX", ttl)
else
  redis.call("SET", KEYS[1], cjson.encode(record))
end
return 1
`;

const INCREMENT_ATTEMPTS_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return false end
local record = cjson.decode(raw)
record.attempts = record.attempts + 1
local ttl = redis.call("PTTL", KEYS[1])
if ttl and ttl > 0 then
  redis.call("SET", KEYS[1], cjson.encode(record), "PX", ttl)
else
  redis.call("SET", KEYS[1], cjson.encode(record))
end
return cjson.encode(record)
`;

const TRY_REDEEM_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end
redis.call("SET", KEYS[1], "1", "PX", ARGV[1])
return 1
`;

export interface RedisChallengeStoreOptions {
  keyPrefix?: string;
}

export class RedisChallengeStore implements ChallengeStore {
  private readonly client: RedisLikeClient;
  private readonly prefix: string;

  constructor(client: RedisLikeClient, options: RedisChallengeStoreOptions = {}) {
    this.client = client;
    this.prefix = options.keyPrefix ?? "oorable:challenge:";
  }

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  private redeemKey(id: string): string {
    return `${this.prefix}redeemed:${id}`;
  }

  async create(record: ChallengeRecord): Promise<void> {
    const ttl = Math.max(1, record.expiresAt - Date.now());
    await this.client.set(this.key(record.id), JSON.stringify(record), "PX", String(ttl));
  }

  async get(id: string): Promise<ChallengeRecord | undefined> {
    const raw = await this.client.get(this.key(id));
    return raw ? (JSON.parse(raw) as ChallengeRecord) : undefined;
  }

  async incrementAttempts(id: string): Promise<ChallengeRecord | undefined> {
    const raw = await this.client.eval(INCREMENT_ATTEMPTS_SCRIPT, 1, this.key(id));
    return raw ? (JSON.parse(raw as string) as ChallengeRecord) : undefined;
  }

  async tryConsume(id: string): Promise<boolean> {
    return (await this.client.eval(TRY_CONSUME_SCRIPT, 1, this.key(id))) === 1;
  }

  async tryRedeem(id: string, ttlMs: number): Promise<boolean> {
    return (await this.client.eval(TRY_REDEEM_SCRIPT, 1, this.redeemKey(id), String(Math.max(1, Math.round(ttlMs))))) === 1;
  }

  async delete(id: string): Promise<void> {
    await this.client.del(this.key(id));
  }
}

// ------------------------------------------------------------ rate limiter

const CONSUME_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`;

const PEEK_SCRIPT = `
local count = redis.call("GET", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
return { count or false, ttl }
`;

export interface RedisRateLimiterOptions {
  keyPrefix?: string;
}

/**
 * Fixed-window limiter shared across every server instance talking to the
 * same Redis. INCR + a conditional PEXPIRE (only set on the *first* hit of
 * a window) is the standard atomic pattern here; setting the expiry
 * unconditionally would let a client keep resetting its own window by
 * hammering the counter.
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly client: RedisLikeClient;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly prefix: string;

  constructor(client: RedisLikeClient, limit: number, windowMs: number, options: RedisRateLimiterOptions = {}) {
    this.client = client;
    this.limit = limit;
    this.windowMs = windowMs;
    this.prefix = options.keyPrefix ?? "oorable:ratelimit:";
  }

  async consume(key: string): Promise<RateLimitResult> {
    const [count, ttl] = (await this.client.eval(CONSUME_SCRIPT, 1, `${this.prefix}${key}`, String(this.limit), String(this.windowMs))) as [
      number,
      number,
    ];
    return {
      allowed: count <= this.limit,
      remaining: Math.max(0, this.limit - count),
      resetAt: Date.now() + Math.max(0, ttl),
    };
  }

  async peek(key: string): Promise<RateLimitResult> {
    const [count, ttl] = (await this.client.eval(PEEK_SCRIPT, 1, `${this.prefix}${key}`)) as [number | false, number];
    const used = count === false ? 0 : Number(count);
    return {
      allowed: used < this.limit,
      remaining: Math.max(0, this.limit - used),
      resetAt: ttl > 0 ? Date.now() + ttl : Date.now() + this.windowMs,
    };
  }
}
