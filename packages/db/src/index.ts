import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { z } from "zod";

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SCHEMA: z.string().min(1),
  DATABASE_MIGRATIONS_SCHEMA: z.string().min(1).default("public"),
  DATABASE_MIGRATIONS_TABLE: z.string().min(1).default("__drizzle_migrations"),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

export type DatabaseRuntime<TSchema extends Record<string, unknown>> = {
  db: NodePgDatabase<TSchema>;
  pool: Pool;
  env: DatabaseEnv;
};

export function readDatabaseEnv() {
  return databaseEnvSchema.parse(process.env);
}

export function createDatabaseRuntime<TSchema extends Record<string, unknown>>(schema: TSchema) {
  const env = readDatabaseEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    env,
  } satisfies DatabaseRuntime<TSchema>;
}

function advisoryLockId(key: string) {
  let hash = 0;

  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }

  return Math.abs(hash);
}

export async function checkDatabaseConnection(
  runtime: Pick<DatabaseRuntime<Record<string, unknown>>, "db">,
) {
  await runtime.db.execute(sql`select 1`);
  return true;
}

export async function runMigrations(
  runtime: Pick<DatabaseRuntime<Record<string, unknown>>, "db" | "env">,
  migrationsFolder: string,
) {
  const lockKey = advisoryLockId(
    `${runtime.env.DATABASE_SCHEMA}:${runtime.env.DATABASE_MIGRATIONS_TABLE}`,
  );

  await runtime.db.execute(sql`select pg_advisory_lock(${lockKey})`);

  try {
    await migrate(runtime.db, {
      migrationsFolder,
      migrationsSchema: runtime.env.DATABASE_MIGRATIONS_SCHEMA,
      migrationsTable: runtime.env.DATABASE_MIGRATIONS_TABLE,
    });
  } finally {
    await runtime.db.execute(sql`select pg_advisory_unlock(${lockKey})`);
  }
}

export async function closeDatabase(
  runtime: Pick<DatabaseRuntime<Record<string, unknown>>, "pool">,
) {
  await runtime.pool.end();
}
