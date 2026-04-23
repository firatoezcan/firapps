import { defineConfig } from "drizzle-kit";

const processEnv =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: processEnv.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firapps",
  },
});
