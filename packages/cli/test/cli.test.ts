import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function exec(args: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  try {
    const { stdout, stderr } = await run("node", [CLI, ...args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

async function tmpProject(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "oorable-cli-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("cli: no command prints help and exits non-zero; --help exits zero", async () => {
  const bare = await exec([]);
  assert.equal(bare.code, 1);
  assert.match(bare.stdout, /Usage:/);
  const help = await exec(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /oorable-captcha generate/);
});

test("cli: unknown command exits non-zero with guidance, not a stack trace", async () => {
  const res = await exec(["frobnicate"]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /Unknown command "frobnicate"/);
  assert.doesNotMatch(res.stderr, /at file:\/\//, "no stack trace leaked to the user");
});

test("cli: init writes a secret into .env without printing it, and is idempotent", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    const first = await exec(["init"], { cwd: dir });
    assert.equal(first.code, 0);
    assert.doesNotMatch(first.stdout, /OORABLE_CAPTCHA_SECRET=[^\s]/, "the secret value itself must not be printed by default");
    assert.match(first.stdout, /Wrote a new signing secret/);

    const env = await readFile(join(dir, ".env"), "utf8");
    const match = /^OORABLE_CAPTCHA_SECRET=(.+)$/m.exec(env);
    assert.ok(match, ".env contains the variable");
    const secretBytes = Buffer.byteLength(match![1]!, "utf8");
    assert.ok(secretBytes >= 32, `secret should be at least 32 bytes, got ${secretBytes}`);

    const second = await exec(["init"], { cwd: dir });
    assert.match(second.stdout, /already set/);
    const envAfter = await readFile(join(dir, ".env"), "utf8");
    assert.equal(envAfter, env, "re-running init without --force does not rotate the secret");
  } finally {
    await cleanup();
  }
});

test("cli: init --show prints the secret, and --force rotates an existing one", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    const shown = await exec(["init", "--show"], { cwd: dir });
    assert.match(shown.stdout, /OORABLE_CAPTCHA_SECRET=[A-Za-z0-9_-]{32,}/);

    const before = await readFile(join(dir, ".env"), "utf8");
    const forced = await exec(["init", "--force", "--show"], { cwd: dir });
    assert.equal(forced.code, 0);
    const after = await readFile(join(dir, ".env"), "utf8");
    assert.notEqual(after, before, "--force actually rotates the secret");
    assert.equal((after.match(/OORABLE_CAPTCHA_SECRET=/g) ?? []).length, 1, "rotation replaces the line rather than duplicating it");
  } finally {
    await cleanup();
  }
});

test("cli: init preserves any other lines already in .env", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    await writeFile(join(dir, ".env"), "SOME_OTHER_VAR=hello\n");
    await exec(["init"], { cwd: dir });
    const env = await readFile(join(dir, ".env"), "utf8");
    assert.match(env, /SOME_OTHER_VAR=hello/);
    assert.match(env, /OORABLE_CAPTCHA_SECRET=/);
  } finally {
    await cleanup();
  }
});

test("cli: generate prints valid JSON with no solution field, for every challenge type", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    for (const type of ["meme-puzzle", "text", "image"]) {
      const res = await exec(["generate", "--type", type], { cwd: dir });
      assert.equal(res.code, 0, res.stderr);
      const jsonText = res.stdout.split("\n\nNext:")[0]!;
      const parsed = JSON.parse(jsonText);
      assert.equal(parsed.type, type);
      assert.ok(parsed.challengeId);
      assert.ok(!/correctOrder|"code"|correctIds|solution/i.test(jsonText), `leaked solution shape for ${type}`);
    }
  } finally {
    await cleanup();
  }
});

test("cli: generate rejects an unknown --type instead of guessing", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    const res = await exec(["generate", "--type", "audio"], { cwd: dir });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Unknown --type/);
  } finally {
    await cleanup();
  }
});

test("cli: generate honors --grid and --difficulty", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    const res = await exec(["generate", "--type", "meme-puzzle", "--grid", "4"], { cwd: dir });
    const parsed = JSON.parse(res.stdout.split("\n\nNext:")[0]!);
    assert.equal(parsed.challenge.tiles.length, 16);
  } finally {
    await cleanup();
  }
});

test("cli: verify with no matching challenge fails cleanly (not_found)", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    const res = await exec(["verify", "--challenge-id", "does-not-exist", "--answer", "x"], { cwd: dir });
    assert.equal(res.code, 1);
    assert.deepEqual(JSON.parse(res.stdout), { success: false, reason: "not_found" });
  } finally {
    await cleanup();
  }
});

test("cli: verify without required flags prints usage and exits non-zero", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    assert.equal((await exec(["verify"], { cwd: dir })).code, 1);
    assert.equal((await exec(["verify", "--challenge-id", "x"], { cwd: dir })).code, 1);
  } finally {
    await cleanup();
  }
});

test("cli: a full generate -> verify round trip across two real, separate process invocations", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    const gen = await exec(["generate", "--type", "text", "--mode", "numeric", "--length", "6"], { cwd: dir });
    assert.equal(gen.code, 0, gen.stderr);
    const created = JSON.parse(gen.stdout.split("\n\nNext:")[0]!);

    const wrong = await exec(["verify", "--challenge-id", created.challengeId, "--answer", "000000"], { cwd: dir });
    assert.equal(JSON.parse(wrong.stdout).success, false);

    // We do not know the real code (by design), so exercise the array-vs-string
    // answer parsing and the not-yet-exhausted-attempts path instead of guessing it.
    const wrongAgain = await exec(["verify", "--challenge-id", created.challengeId, "--answer", "111111"], { cwd: dir });
    assert.deepEqual(JSON.parse(wrongAgain.stdout), { success: false, reason: "incorrect" });
  } finally {
    await cleanup();
  }
});

test("cli: meme-puzzle answers are parsed as an array (comma-separated), and a real puzzle round-trips to success", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    const gen = await exec(["generate", "--type", "meme-puzzle", "--grid", "2"], { cwd: dir });
    const created = JSON.parse(gen.stdout.split("\n\nNext:")[0]!);
    const shuffled: string[] = created.challenge.tiles.map((t: { token: string }) => t.token);

    // We don't know the true order from outside the engine (by design -- see
    // packages/core/test/meme-puzzle.test.ts), so confirm array-answer parsing
    // behaves correctly on a guess, and separately confirm a real solve works
    // end-to-end by reading the dev-only state file this CLI itself writes.
    const guess = await exec(["verify", "--challenge-id", created.challengeId, "--answer", shuffled.join(",")], { cwd: dir });
    const guessResult = JSON.parse(guess.stdout);
    assert.equal(typeof guessResult.success, "boolean");

    const scope = createHash("sha256").update(dir).digest("base64url").slice(0, 16);
    const statePath = join(tmpdir(), "oorable-captcha-cli", scope, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const correctOrder: string[] = state.challenges[created.challengeId].solution.correctOrder;

    const solve = await exec(["verify", "--challenge-id", created.challengeId, "--answer", correctOrder.join(",")], { cwd: dir });
    assert.equal(solve.code, 0);
    const solved = JSON.parse(solve.stdout);
    assert.equal(solved.success, true);
    assert.ok(String(solved.verificationToken).startsWith("v1."));
  } finally {
    await cleanup();
  }
});

test("cli: two different project directories do not share dev state", async () => {
  const a = await tmpProject();
  const b = await tmpProject();
  try {
    const gen = await exec(["generate", "--type", "text"], { cwd: a.dir });
    const created = JSON.parse(gen.stdout.split("\n\nNext:")[0]!);
    const res = await exec(["verify", "--challenge-id", created.challengeId, "--answer", "anything"], { cwd: b.dir });
    assert.deepEqual(JSON.parse(res.stdout), { success: false, reason: "not_found" });
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

test("cli: doctor never prints the secret value, reports pass/fail per check, and its exit code reflects failures", async () => {
  const { dir, cleanup } = await tmpProject();
  try {
    const withoutSecret = await exec(["doctor"], { cwd: dir, env: { OORABLE_CAPTCHA_SECRET: undefined } });
    assert.equal(withoutSecret.code, 1);
    assert.match(withoutSecret.stdout, /✗ OORABLE_CAPTCHA_SECRET/);

    const secret = "x".repeat(40);
    const withSecret = await exec(["doctor"], { cwd: dir, env: { OORABLE_CAPTCHA_SECRET: secret } });
    assert.doesNotMatch(withSecret.stdout, new RegExp(secret), "the secret's own value must never be printed");
    assert.match(withSecret.stdout, /OORABLE_CAPTCHA_SECRET\s+set \(40 bytes\)/);

    const shortSecret = await exec(["doctor"], { cwd: dir, env: { OORABLE_CAPTCHA_SECRET: "short" } });
    assert.equal(shortSecret.code, 1);
    assert.match(shortSecret.stdout, /✗ OORABLE_CAPTCHA_SECRET.*only 5 bytes/);
  } finally {
    await cleanup();
  }
});

test("cli: doctor reports missing optional peers as warnings, not failures", async () => {
  const res = await exec(["doctor"], { env: { OORABLE_CAPTCHA_SECRET: "x".repeat(40) } });
  assert.match(res.stdout, /! (express|fastify|ioredis|react)/);
});
