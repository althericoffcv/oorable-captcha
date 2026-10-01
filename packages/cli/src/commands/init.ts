import { randomBytes } from "node:crypto";
import { access, appendFile, readFile, writeFile } from "node:fs/promises";
import { flagBoolean, flagString, type ParsedArgs } from "../args.ts";

const ENV_VAR = "OORABLE_CAPTCHA_SECRET";

function generateSecret(): string {
  // 32 bytes matches StaticKeyProvider's MIN_SECRET_BYTES exactly -- see @oorable/captcha/crypto/token.
  return randomBytes(32).toString("base64url");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a fresh signing secret into a .env file. Never prints the secret
 * unless --show is passed explicitly (CLI must not print secrets by
 * default). Refuses to clobber an existing value unless --force is given,
 * since overwriting a live deployment's secret invalidates every
 * outstanding token and puzzle tile URL.
 */
export async function runInit(args: ParsedArgs): Promise<number> {
  const envPath = flagString(args.flags, "env-file") ?? ".env";
  const show = flagBoolean(args.flags, "show");
  const force = flagBoolean(args.flags, "force");

  let existing = "";
  if (await fileExists(envPath)) {
    existing = await readFile(envPath, "utf8");
    const already = new RegExp(`^${ENV_VAR}=`, "m").test(existing);
    if (already && !force) {
      console.log(`${ENV_VAR} is already set in ${envPath}. Pass --force to replace it (this invalidates every outstanding token).`);
      return 0;
    }
  }

  const secret = generateSecret();
  if (existing && new RegExp(`^${ENV_VAR}=`, "m").test(existing)) {
    const updated = existing.replace(new RegExp(`^${ENV_VAR}=.*$`, "m"), `${ENV_VAR}=${secret}`);
    await writeFile(envPath, updated, { mode: 0o600 });
  } else {
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    await appendFile(envPath, `${prefix}${ENV_VAR}=${secret}\n`, { mode: 0o600 });
  }

  console.log(`Wrote a new signing secret to ${envPath} (as ${ENV_VAR}).`);
  console.log("Keep it out of version control, and use a different one per environment.");
  if (show) {
    console.log(`\n${ENV_VAR}=${secret}`);
  } else {
    console.log("(pass --show to print the value, e.g. for a secrets manager)");
  }
  return 0;
}
