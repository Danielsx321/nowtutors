#!/usr/bin/env node
// Wraps a script so Node's fetch-based TLS calls (Supabase Admin API, etc.)
// don't fail with UNABLE_TO_GET_ISSUER_CERT_LOCALLY on machines whose Node
// install has an incomplete CA bundle even though the system trust store
// (curl, etc.) is fine — and, optionally, so the wrapped process starts with
// a chosen env file already applied.
//
// NODE_EXTRA_CA_CERTS is read by Node once at process startup, before any
// application code (including dotenv/env-loading in src/db/load-env.ts) runs
// — setting process.env.NODE_EXTRA_CA_CERTS from inside the script itself has
// no effect on that already-started process's TLS store. This wrapper spawns
// the real command as a *new* child process with the var set beforehand,
// which is the only place this can actually work.
//
// Silent no-op when NODE_EXTRA_CA_CERTS is already set, or when
// /etc/ssl/cert.pem doesn't exist (this is a local-machine quirk — CI and
// Vercel are unaffected, see docs/RUNBOOK.md). Never touches TLS
// verification itself.
//
// `--env-file=<path>` (optional, must come before the command) additionally
// loads that file into the child's environment. It exists for the E2E run:
// `next dev` loads `.env.local` — the DEV/prod project — and there is no Next
// flag to make it load `.env.test` instead, so the only way to point the app
// at the disposable test project is to have the values already in the
// environment when Next starts. Next's env loader (`@next/env`) snapshots
// process.env first and never overwrites a key that is already set, so a value
// injected here wins over `.env.local` for the whole dev server.
//
// Real environment variables still beat the file (so `E2E_BASE_URL=… pnpm
// test:e2e` keeps working), and NODE_ENV is deliberately never injected:
// `.env.test` sets it to `test`, which would put `next dev` into a
// non-standard mode it warns about and never runs in for real.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

const FALLBACK_CERT_PATH = "/etc/ssl/cert.pem";

/** Never taken from an env file — see the header. */
const NEVER_INJECT = new Set(["NODE_ENV"]);

const argv = process.argv.slice(2);

let envFile = null;
while (argv.length > 0 && argv[0].startsWith("--env-file=")) {
  envFile = argv.shift().slice("--env-file=".length);
}

const env = { ...process.env };

if (envFile) {
  if (!existsSync(envFile)) {
    console.error(`with-ca-certs.mjs: env file not found: ${envFile}`);
    process.exit(1);
  }
  const parsed = parse(readFileSync(envFile, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (NEVER_INJECT.has(key)) continue;
    if (process.env[key] !== undefined) continue; // a real env var wins
    env[key] = value;
  }
}

if (!env.NODE_EXTRA_CA_CERTS && existsSync(FALLBACK_CERT_PATH)) {
  env.NODE_EXTRA_CA_CERTS = FALLBACK_CERT_PATH;
}

const [cmd, ...args] = argv;
if (!cmd) {
  console.error("with-ca-certs.mjs: no command given");
  process.exit(1);
}

const result = spawnSync(cmd, args, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
