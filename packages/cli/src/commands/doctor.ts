import { DEFAULTS } from "@oorable/captcha";
import type { ParsedArgs } from "../args.ts";

const MIN_SECRET_BYTES = 32; // mirrors StaticKeyProvider's own minimum

interface Check {
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

function checkNodeVersion(): Check {
  const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
  const ok = major > 22 || (major === 22 && minor >= 6);
  return {
    label: "Node.js version",
    status: ok ? "ok" : "fail",
    detail: ok
      ? `${process.versions.node} (>= 22.6 required for native TypeScript execution during development)`
      : `${process.versions.node} is below the minimum of 22.6.0`,
  };
}

function checkSecret(): Check {
  const secret = process.env["OORABLE_CAPTCHA_SECRET"];
  if (!secret) {
    return { label: "OORABLE_CAPTCHA_SECRET", status: "fail", detail: "not set -- run `oorable-captcha init`, or pass `keys` explicitly" };
  }
  // Reports length only, never the value.
  const bytes = Buffer.byteLength(secret, "utf8");
  return bytes >= MIN_SECRET_BYTES
    ? { label: "OORABLE_CAPTCHA_SECRET", status: "ok", detail: `set (${bytes} bytes)` }
    : { label: "OORABLE_CAPTCHA_SECRET", status: "fail", detail: `set but only ${bytes} bytes (need >= ${MIN_SECRET_BYTES})` };
}

async function checkOptionalPeer(pkg: string, usedFor: string): Promise<Check> {
  try {
    await import(pkg);
    return { label: pkg, status: "ok", detail: `resolved (needed for ${usedFor})` };
  } catch {
    return { label: pkg, status: "warn", detail: `not installed -- only needed if you use ${usedFor}` };
  }
}

function render(checks: Check[]): void {
  const icon = { ok: "✓", warn: "!", fail: "✗" } as const;
  const width = Math.max(...checks.map((c) => c.label.length));
  for (const c of checks) {
    console.log(`${icon[c.status]} ${c.label.padEnd(width)}  ${c.detail}`);
  }
}

export async function runDoctor(_args: ParsedArgs): Promise<number> {
  const checks: Check[] = [checkNodeVersion(), checkSecret()];
  checks.push(await checkOptionalPeer("express", "@oorable/captcha-express"));
  checks.push(await checkOptionalPeer("fastify", "@oorable/captcha-fastify"));
  checks.push(await checkOptionalPeer("ioredis", "@oorable/captcha-redis in production"));
  checks.push(await checkOptionalPeer("sharp", "scripts/process-assets.mjs (real meme photos)"));
  checks.push(await checkOptionalPeer("react", "@oorable/captcha-react"));

  console.log(`OORABLE CAPTCHA doctor\n`);
  render(checks);
  console.log(`\nDefault challenge ttl: ${DEFAULTS.challengeTtlMs / 1000}s, max attempts: ${DEFAULTS.maxAttempts}.`);

  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length) {
    console.log(`\n${failed.length} check(s) need attention before this is production-ready.`);
    return 1;
  }
  console.log("\nLooks good.");
  return 0;
}
