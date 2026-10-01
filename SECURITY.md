# Security Policy

## Reporting a vulnerability

Please do not open a public GitHub issue for security vulnerabilities. Instead, email the maintainers (see `package.json` `author`/repository metadata once this project is published) with:

- A description of the issue and its potential impact.
- Steps to reproduce, or a proof-of-concept.
- The package(s) and version(s) affected.

We aim to acknowledge reports within 3 business days. Once a fix is available, we will coordinate a disclosure timeline with you and credit you in `CHANGELOG.md` unless you prefer otherwise.

## Supported versions

While this project is pre-1.0 (`0.x`), only the latest published `0.x` release of each package receives security fixes. Once 1.0 ships, this section will define a support window per major version.

## What "secure" means here

This project follows the practices in [docs/security.md](docs/security.md) and [docs/threat-model.md](docs/threat-model.md): server-side-only validation, signed/encrypted single-use tokens, constant-time comparisons, no `Math.random()` anywhere security-relevant, and rate limiting. It has **not** undergone an independent third-party security audit. See [docs/limitations.md](docs/limitations.md) for a candid list of what it does not protect against.

## Scope

In scope: the packages in this repository (`packages/*`). Out of scope: vulnerabilities in third-party dependencies you choose to use alongside it (report those upstream), and vulnerabilities that require an already-compromised signing secret or server.
