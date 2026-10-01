import type { ChallengeRecord } from "./types.ts";
import type { ChallengeStore } from "./store.ts";
import { CapacityError } from "../errors.ts";

export interface MemoryChallengeStoreOptions {
  /** How often expired entries are swept, in ms. Default 30s. */
  sweepIntervalMs?: number;
  /**
   * Hard cap on live entries (challenges + redemption markers). When full,
   * expired entries are swept first; if there is still no room, create()
   * throws CapacityError instead of growing without bound. Default 50,000.
   */
  maxEntries?: number;
}

/**
 * A single-process, in-memory challenge store. Good for development,
 * tests, and single-instance deployments. For anything running more
 * than one process/instance, use @oorable/captcha-redis instead -- an
 * in-memory store cannot coordinate one-time-use or attempt counts
 * across processes, so a load-balanced deployment on this store could
 * let a challenge be solved once per instance.
 *
 * Atomicity note: every method below does its check-then-write
 * synchronously (no `await` between reading and mutating the Maps), so
 * concurrent calls arriving in the same tick still cannot race each
 * other -- Node only runs one synchronous block at a time. That is
 * what gives tryConsume()/tryRedeem() their "exactly one winner"
 * guarantee without needing an explicit lock.
 *
 * Memory is bounded two ways: a periodic sweep removes expired
 * entries, and `maxEntries` caps the total.
 */
export class MemoryChallengeStore implements ChallengeStore {
  private readonly records = new Map<string, ChallengeRecord>();
  private readonly redeemed = new Map<string, number>(); // challengeId -> expiresAt
  private readonly sweepTimer: NodeJS.Timeout;
  private readonly maxEntries: number;

  constructor(options: MemoryChallengeStoreOptions | number = {}) {
    // A bare number is accepted as the sweep interval for backwards-compatible call sites.
    const opts: MemoryChallengeStoreOptions = typeof options === "number" ? { sweepIntervalMs: options } : options;
    this.maxEntries = opts.maxEntries ?? 50_000;
    this.sweepTimer = setInterval(() => this.sweepExpired(), opts.sweepIntervalMs ?? 30_000);
    this.sweepTimer.unref?.();
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [id, record] of this.records) {
      if (record.expiresAt < now) this.records.delete(id);
    }
    for (const [id, expiresAt] of this.redeemed) {
      if (expiresAt < now) this.redeemed.delete(id);
    }
  }

  private get size(): number {
    return this.records.size + this.redeemed.size;
  }

  private ensureRoom(): void {
    if (this.size < this.maxEntries) return;
    this.sweepExpired();
    if (this.size >= this.maxEntries) {
      throw new CapacityError("MemoryChallengeStore is full; refusing to grow without bound");
    }
  }

  async create(record: ChallengeRecord): Promise<void> {
    this.ensureRoom();
    this.records.set(record.id, record);
  }

  async get(id: string): Promise<ChallengeRecord | undefined> {
    const record = this.records.get(id);
    if (record && record.expiresAt < Date.now()) {
      this.records.delete(id);
      return undefined;
    }
    return record;
  }

  async incrementAttempts(id: string): Promise<ChallengeRecord | undefined> {
    const record = this.records.get(id);
    if (!record || record.expiresAt < Date.now()) return undefined;
    record.attempts += 1;
    return record;
  }

  async tryConsume(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.expiresAt < Date.now() || record.consumed) return false;
    record.consumed = true;
    return true;
  }

  async tryRedeem(id: string, ttlMs: number): Promise<boolean> {
    const existing = this.redeemed.get(id);
    if (existing !== undefined && existing >= Date.now()) return false;
    this.ensureRoom();
    this.redeemed.set(id, Date.now() + Math.max(1, ttlMs));
    return true;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  /** Stops the background sweep timer. Call this in tests/on shutdown. */
  close(): void {
    clearInterval(this.sweepTimer);
  }
}
