import { config } from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDatabase, getPool } from "./client";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  try {
    await migrate(getDatabase(), { migrationsFolder: "src/db/migrations" });
    console.info("Database migrations applied.");
  } finally {
    await getPool().end();
  }
}

main().catch(() => {
  console.error("Database migration failed. Check DATABASE_URL and PostgreSQL availability; no credentials were logged.");
  process.exitCode = 1;
});
