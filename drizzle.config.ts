import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: "./src/db/*schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
});
