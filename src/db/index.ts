import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// DATABASE_URL is the Supabase transaction pooler (PgBouncer). Prepared
// statements are not supported in transaction pooling mode, so disable them.
//
// `max_pipeline: 1`, which is effectively postgres.js's default behaviour for
// this app: it keeps transactions working. NOT 0: with 0, postgres.js never
// calls the `onexecute` hook that reserves a connection for `sql.begin`, so
// every transaction failed with UNSAFE_TRANSACTION (PR #100 shipped 0 and broke
// every db.transaction on production until this fix).
// tests/integration/db-client.test.ts runs a transaction through this exact
// client so that can't happen again.
//
// KNOWN OPEN ISSUE: this does not stop the burst hang found on 2026-09-19
// (pipelined queries through the transaction pooler get stranded; 54 of 60
// requests hung in a 20-wide burst with this setting). The fix for that is a
// separate change; see DECISIONS.
//
// Timeouts so a bad connection fails instead of lingering: 10 s to connect,
// idle connections closed after 20 s.
// `max_pipeline` is a runtime option in postgres.js 3.4 (src/index.js) that
// its type definitions don't list, hence the widened object.
const options: postgres.Options<Record<string, postgres.PostgresType>> & { max_pipeline: number } = {
  prepare: false,
  max_pipeline: 1,
  connect_timeout: 10,
  idle_timeout: 20,
};
const client = postgres(process.env.DATABASE_URL!, options);

export const db = drizzle(client, { schema });

/** The transaction handle passed to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
