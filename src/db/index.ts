import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// DATABASE_URL is the Supabase transaction pooler (PgBouncer). Prepared
// statements are not supported in transaction pooling mode, so disable them.
//
// TWO CLIENTS, on purpose (2026-09-19; DECISIONS, "database client"):
//
// - `plainClient` runs every query outside a transaction with
//   `max_pipeline: 0`: one query per connection at a time. postgres.js
//   otherwise pipelines queries on a busy connection, and through the
//   transaction pooler the pieces of pipelined queries could land on different
//   server connections. Under ~10 simultaneous page loads that left Postgres
//   holding half a query, waiting on the client forever (`ClientRead`), until
//   the pool was exhausted and every page hung. Depth 1 still hung (54 of 60
//   requests in a 20-wide burst); only 0 held.
//
// - `transactionClient` runs `db.transaction` only, with postgres.js's normal
//   pipelining. It can't use 0: with 0 postgres.js never calls the `onexecute`
//   hook that reserves a connection for `sql.begin`, so every transaction
//   failed with UNSAFE_TRANSACTION (PR 100, fixed by PR 102). A reserved
//   connection only carries its own transaction's statements.
//
// tests/integration/db-client.test.ts runs transactions, savepoints and a mixed
// burst through this exact module.
//
// Timeouts on both so a bad connection fails instead of lingering: 10 s to
// connect, idle connections closed after 20 s. `max_pipeline` is a runtime
// option in postgres.js 3.4 (src/index.js) that its type definitions don't
// list, hence the widened options type.
type ClientOptions = postgres.Options<Record<string, postgres.PostgresType>> & { max_pipeline?: number };

const shared: ClientOptions = { prepare: false, connect_timeout: 10, idle_timeout: 20 };

const plainClient = postgres(process.env.DATABASE_URL!, { ...shared, max: 10, max_pipeline: 0 } as ClientOptions);
const transactionClient = postgres(process.env.DATABASE_URL!, { ...shared, max: 5 });

const plainDb = drizzle(plainClient, { schema });
const transactionDb = drizzle(transactionClient, { schema });

/**
 * The app's database. Reads and single statements go through `plainClient`;
 * `db.transaction(...)` goes through `transactionClient` (see the note above).
 * Same drizzle type, so nothing that imports `db` changes.
 */
export const db: typeof plainDb = Object.assign(plainDb, {
  transaction: transactionDb.transaction.bind(transactionDb) as typeof plainDb.transaction,
});

/** The transaction handle passed to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
