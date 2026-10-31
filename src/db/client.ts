import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AppError } from "@/server/errors";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;
const state = globalThis as typeof globalThis & { geoPool?: Pool; geoDatabase?: Database };

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new AppError(503, "DATABASE_NOT_CONFIGURED", "数据库待配置，请先设置 DATABASE_URL 并执行数据库迁移。");
  }
  try {
    const url = new URL(process.env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error("invalid configuration");
  } catch {
    throw new AppError(503, "DATABASE_NOT_CONFIGURED", "数据库连接配置无效，请检查 DATABASE_URL 后重试。");
  }
  if (!state.geoPool) {
    state.geoPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      application_name: "geo-platform",
      allowExitOnIdle: true,
    });
    // An idle client can lose its connection; the next request will acquire a new one.
    state.geoPool.on("error", () => undefined);
  }
  return state.geoPool;
}

export function getDatabase(): Database {
  state.geoDatabase ??= drizzle(getPool(), { schema });
  return state.geoDatabase;
}
