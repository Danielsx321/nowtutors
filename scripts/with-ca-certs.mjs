#!/usr/bin/env node
// Wraps a db script so Node's fetch-based TLS calls (Supabase Admin API, etc.)
// don't fail with UNABLE_TO_GET_ISSUER_CERT_LOCALLY on machines whose Node
// install has an incomplete CA bundle even though the system trust store
// (curl, etc.) is fine.
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
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const FALLBACK_CERT_PATH = "/etc/ssl/cert.pem";

const env = { ...process.env };
if (!env.NODE_EXTRA_CA_CERTS && existsSync(FALLBACK_CERT_PATH)) {
  env.NODE_EXTRA_CA_CERTS = FALLBACK_CERT_PATH;
}

const [cmd, ...args] = process.argv.slice(2);
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
