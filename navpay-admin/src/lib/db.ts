import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "@/lib/env";

function sqlitePathFromDatabaseUrl(databaseUrl: string): string {
  // Supports: file:./data/dev.db or ./data/dev.db
  if (databaseUrl.startsWith("file:")) return databaseUrl.slice("file:".length);
  return databaseUrl;
}

const sqlitePath = sqlitePathFromDatabaseUrl(env.DATABASE_URL);

// Single-process app runtime. For production multi-instance, use Postgres.
export const sqlite = new Database(sqlitePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { logger: false });

