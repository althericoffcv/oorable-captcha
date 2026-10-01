import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ChallengeRecord, ChallengeStore } from "@oorable/captcha";

/**
 * `generate` and `verify` are meant to be run as two separate `npx
 * oorable-captcha ...` invocations -- two separate OS processes -- so an
 * in-memory store cannot bridge them the way it would inside one running
 * server. This is a small file-backed store for that purpose ONLY: local
 * smoke-testing during development. It is not exported from the core
 * package and must never be used to back a real deployment (no atomicity
 * guarantees across concurrent processes -- see @oorable/captcha-redis for
 * that).
 *
 * Everything lives under the OS temp directory, scoped to the current
 * user and working directory, and is plain JSON -- readable on purpose, so
 * `oorable-captcha generate --show-solution` has somewhere to read from
 * for local debugging without ever putting solutions through the network
 * or a real store.
 */

function stateDir(): string {
  // A real digest of the cwd keeps state scoped per-project without spilling
  // challenge ids/solutions from one project's smoke tests into another's.
  // (A naive base64-then-truncate of the path is NOT enough here: temp
  // directories sharing a long common prefix would collide, since only the
  // *front* of that encoding would ever be kept -- a hash spreads every
  // input byte, including ones near the end, across the whole output.)
  const scope = createHash("sha256").update(process.cwd()).digest("base64url").slice(0, 16);
  return join(tmpdir(), "oorable-captcha-cli", scope);
}

function statePath(): string {
  return join(stateDir(), "state.json");
}

interface DevState {
  /** Signing key used ONLY by this CLI's own generate/verify round trip. Never use this for a real deployment. */
  devSecret: string;
  challenges: Record<string, ChallengeRecord>;
}

async function readState(): Promise<DevState> {
  try {
    const raw = await readFile(statePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DevState>;
    if (typeof parsed.devSecret === "string" && parsed.challenges) return parsed as DevState;
  } catch {
    /* first run, or a corrupted file -- start fresh either way */
  }
  return { devSecret: randomBytes(32).toString("base64url"), challenges: {} };
}

async function writeState(state: DevState): Promise<void> {
  const path = statePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Write-then-rename avoids leaving a half-written state file behind if two
  // `oorable-captcha` invocations race on the same project.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}

/** The dev-only signing secret shared by this project's generate/verify calls. Never printed by default. */
export async function getDevSecret(): Promise<string> {
  return (await readState()).devSecret;
}

export class FileChallengeStore implements ChallengeStore {
  private async mutate<T>(fn: (state: DevState) => T): Promise<T> {
    const state = await readState();
    const result = fn(state);
    for (const [id, record] of Object.entries(state.challenges)) {
      if (record.expiresAt < Date.now()) delete state.challenges[id];
    }
    await writeState(state);
    return result;
  }

  async create(record: ChallengeRecord): Promise<void> {
    await this.mutate((state) => {
      state.challenges[record.id] = record;
    });
  }

  async get(id: string): Promise<ChallengeRecord | undefined> {
    const state = await readState();
    const record = state.challenges[id];
    return record && record.expiresAt >= Date.now() ? record : undefined;
  }

  async incrementAttempts(id: string): Promise<ChallengeRecord | undefined> {
    return this.mutate((state) => {
      const record = state.challenges[id];
      if (!record || record.expiresAt < Date.now()) return undefined;
      record.attempts += 1;
      return record;
    });
  }

  async tryConsume(id: string): Promise<boolean> {
    return this.mutate((state) => {
      const record = state.challenges[id];
      if (!record || record.expiresAt < Date.now() || record.consumed) return false;
      record.consumed = true;
      return true;
    });
  }

  async tryRedeem(id: string, ttlMs: number): Promise<boolean> {
    return this.mutate((state) => {
      const key = `redeemed:${id}`;
      const existing = state.challenges[key];
      if (existing && existing.expiresAt >= Date.now()) return false;
      state.challenges[key] = { ...emptyMarkerRecord(id), expiresAt: Date.now() + ttlMs };
      return true;
    });
  }

  async delete(id: string): Promise<void> {
    await this.mutate((state) => {
      delete state.challenges[id];
    });
  }
}

function emptyMarkerRecord(id: string): ChallengeRecord {
  const now = Date.now();
  return {
    id,
    type: "text",
    version: 1,
    issuedAt: now,
    expiresAt: now,
    attempts: 0,
    maxAttempts: 0,
    consumed: true,
    solution: undefined,
    publicPayload: undefined,
  };
}
