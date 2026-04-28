import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema.js";

const { Pool } = pg;

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL_NO_SSL;

if (!databaseUrl && process.env.NODE_ENV === "production") {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const hasDatabase = Boolean(databaseUrl);

const shouldUseSsl =
  Boolean(process.env.VERCEL) ||
  Boolean(databaseUrl && /neon\.tech/i.test(databaseUrl)) ||
  Boolean(databaseUrl && /sslmode=require/i.test(databaseUrl));

function createMissingDatabaseProxy(): ReturnType<typeof drizzle<typeof schema>> {
  return new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
    get() {
      throw new Error("DATABASE_URL must be set to use the database storage.");
    },
  });
}

export const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
    })
  : null;

export const db = pool ? drizzle(pool, { schema }) : createMissingDatabaseProxy();
