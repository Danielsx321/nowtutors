import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// DATABASE_URL is the Supabase transaction pooler (PgBouncer). Prepared
// statements are not supported in transaction pooling mode, so disable them.
//
// `max_pipeline: 0`: one query in flight per connection. postgres.js
// otherwise pipelines up to 100 queries on a busy connection, and the
// transaction pooler can hand the pieces of pipelined queries to different
// server connections. Under a burst of page loads that left Postgres holding
// half a query, waiting on the client forever (`ClientRead`), until the pool
// was exhausted and every page hung (found 2026-09-19; DECISIONS). 0, not 1:
// postgres.js compares `sent.length < max_pipeline` after the first query, so
// 1 still allows two in flight.
//
// Timeouts so a bad connection fails instead of lingering: 10 s to connect,
// idle connections closed after 20 s.
// `max_pipeline` is a runtime option in postgres.js 3.4 (src/index.js) that
// its type definitions don't list, hence the widened object.
const options: postgres.Options<Record<string, postgres.PostgresType>> & { max_pipeline: number } = {
  prepare: false,
  max_pipeline: 0,
  connect_timeout: 10,
  idle_timeout: 20,
};
const client = postgres(process.env.DATABASE_URL!, options);

export const db = drizzle(client, { schema });

/** The transaction handle passed to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
