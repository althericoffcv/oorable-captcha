export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  /** Consumes one unit from the named bucket's budget, if available. */
  consume(key: string): Promise<RateLimitResult>;
  /**
   * Reads the bucket WITHOUT consuming. `allowed` means "one more consume
   * would still be within the limit". Used for budgets that should only be
   * charged on some outcomes, such as failed verification attempts.
   */
  peek(key: string): Promise<RateLimitResult>;
  /** Releases timers/connections. Optional. */
  close?(): void;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface MemoryRateLimiterOptions {
  /** Maximum distinct keys tracked at once. Default 100,000. */
  maxKeys?: number;
  /** How often expired windows are swept, in ms. Default 30s. */
  sweepIntervalMs?: number;
}

/**
 * Fixed-window in-memory limiter. Good for development and
 * single-instance deployments. Note that IP-based limiting alone does
 * not stop distributed abuse (many IPs, residential proxy pools,
 * etc.) -- see docs/limitations.md. For multi-instance deployments,
 * use the Redis-backed limiter in @oorable/captcha-redis, which uses
 * the same (limit, windowMs) contract but coordinates across
 * processes.
 *
 * Memory is bounded: expired windows are swept periodically, and if the
 * number of distinct keys reaches `maxKeys` the oldest-inserted key is
 * evicted to make room. Eviction trades a little accuracy for a hard
 * memory ceiling -- an attacker rotating through huge numbers of keys
 * cannot exhaust the process, at the cost of possibly resetting the
 * counter of the oldest key.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(limit: number, windowMs: number, options: MemoryRateLimiterOptions = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = options.maxKeys ?? 100_000;
    this.sweepTimer = setInterval(() => this.sweep(), options.sweepIntervalMs ?? 30_000);
    this.sweepTimer.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  async consume(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= this.maxKeys) {
        this.sweep();
        if (this.buckets.size >= this.maxKeys) {
          const oldest = this.buckets.keys().next().value;
          if (oldest !== undefined) this.buckets.delete(oldest);
        }
      }
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  async peek(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      return { allowed: this.limit > 0, remaining: this.limit, resetAt: now + this.windowMs };
    }
    return {
      allowed: bucket.count < this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  /** Number of keys currently tracked (exposed for tests and metrics). */
  get size(): number {
    return this.buckets.size;
  }

  close(): void {
    clearInterval(this.sweepTimer);
  }
}

/**
 * Combines several named limiters (e.g. per-IP, per-session, per-site)
 * so a single request can be checked against all of them at once; the
 * strictest result wins.
 */
export class CompositeRateLimiter {
  private readonly limiters: Record<string, RateLimiter>;

  constructor(limiters: Record<string, RateLimiter>) {
    this.limiters = limiters;
  }

  async consume(keys: Record<string, string>): Promise<RateLimitResult & { limitedBy?: string }> {
    let strictest: RateLimitResult & { limitedBy?: string } = {
      allowed: true,
      remaining: Number.POSITIVE_INFINITY,
      resetAt: 0,
    };
    for (const [name, limiter] of Object.entries(this.limiters)) {
      const key = keys[name];
      if (key === undefined) continue;
      const result = await limiter.consume(`${name}:${key}`);
      if (!result.allowed && strictest.allowed) {
        strictest = { ...result, limitedBy: name };
      } else if (result.allowed && result.remaining < strictest.remaining) {
        strictest = { ...strictest, remaining: result.remaining };
      }
    }
    return strictest;
  }

  close(): void {
    for (const limiter of Object.values(this.limiters)) limiter.close?.();
  }
}
