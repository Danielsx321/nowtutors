import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// DATABASE_URL is the Supabase transaction pooler (PgBouncer). Prepared
// statements are not supported in transaction pooling mode, so disable them.
const client = postgres(process.env.DATABASE_URL!, { prepare: false });

export const db = drizzle(client, { schema });

/** The transaction handle passed to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
