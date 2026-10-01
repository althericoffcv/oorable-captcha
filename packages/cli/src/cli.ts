#!/usr/bin/env node
import { parseArgs } from "./args.ts";
import { runInit } from "./commands/init.ts";
import { runGenerate } from "./commands/generate.ts";
import { runVerify } from "./commands/verify.ts";
import { runDoctor } from "./commands/doctor.ts";

const HELP = `OORABLE CAPTCHA CLI

Usage:
  oorable-captcha init                 Generate a signing secret into .env
  oorable-captcha generate             Create a sample challenge and print its public payload
  oorable-captcha verify               Check an answer against a challenge generate created
  oorable-captcha doctor               Check your environment for common setup problems

Options vary by command; run a command to see its usage.
This tool never prints secrets or answers unless you explicitly pass --show.
`;

async function main(): Promise<number> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const [command] = positionals;
  const args = { positionals: positionals.slice(1), flags };

  if (flags["help"] || flags["h"]) {
    console.log(HELP);
    return 0;
  }
  if (command === undefined) {
    console.log(HELP);
    return 1;
  }

  switch (command) {
    case "init":
      return runInit(args);
    case "generate":
      return runGenerate(args);
    case "verify":
      return runVerify(args);
    case "doctor":
      return runDoctor(args);
    default:
      console.error(`Unknown command "${command}".\n`);
      console.log(HELP);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    // A stack trace here would be a Node internal detail, not user-facing
    // guidance, and could in principle echo request/response content a
    // caller passed in; keep the failure message generic.
    console.error(`oorable-captcha: unexpected error (${err instanceof Error ? err.name : "unknown"})`);
    process.exit(1);
  });
