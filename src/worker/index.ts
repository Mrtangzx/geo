import { config } from "dotenv";
import { PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { getDatabase, getPool } from "@/db/client";
import { samplingRuns } from "@/db/sampling-schema";
import { attachRunJob, processRun, recoverInterruptedRuns } from "@/server/sampling";
import { dispatchDueMonitoring } from "@/server/monitoring";

config({ path: ".env.local", quiet: true }); config({ quiet: true });
const queue = "geo-sampling";
async function main() {
  const pool = getPool(); const lock = await pool.connect();
  const result = await lock.query("select pg_try_advisory_lock(726184910) as locked");
  if (!result.rows[0].locked) { lock.release(); await pool.end(); console.error("本数据库已有活动worker；没有启动第二个恢复进程。"); process.exitCode = 1; return; }
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "geo_jobs" });
  boss.on("error", () => console.error("后台队列暂时不可用；未输出连接信息，持久任务将保留。"));
  await boss.start(); await boss.createQueue(queue, { retryLimit: 0, expireInSeconds: 300 });
  await recoverInterruptedRuns();
  await boss.work<{ workspaceId: string; projectId: string; id: string }>(queue, { pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await processRun(job.data.workspaceId, job.data.projectId, job.data.id);
  });
  let ticking = false; let stopping = false;
  async function tick() {
    if (ticking || stopping) return;
    ticking = true;
    try {
      const rows = await getDatabase().select().from(samplingRuns).where(eq(samplingRuns.status, "queued"));
      for (const row of rows) {
        const jobId = await boss.send(queue, { workspaceId: row.workspaceId, projectId: row.projectId, id: row.id }, { singletonKey: row.id, singletonSeconds: 15, retryLimit: 0 });
        await attachRunJob(row.id, jobId);
      }
      await dispatchDueMonitoring(async () => ({ runId: null, blockedReason: "真实通道待配置与验收，本阶段没有外部调用。" }));
    } catch { console.error("调度检查未完成；任务保留，稍后重试；不会静默重复付费提交。"); }
    finally { ticking = false; }
  }
  const timer = setInterval(() => { void tick(); }, 3000);
  await tick(); console.info("GEO worker ready: persistent pg-boss queue; synthetic replay enabled; real paid calls disabled.");
  async function stop() { if (stopping) return; stopping = true; clearInterval(timer); await boss.stop({ graceful: true, timeout: 10000 }); await lock.query("select pg_advisory_unlock(726184910)"); lock.release(); await pool.end(); }
  process.once("SIGINT", () => { void stop(); }); process.once("SIGTERM", () => { void stop(); });
}
main().catch(() => { console.error("Worker启动失败，请检查数据库、迁移及队列配置。未输出凭证。"); process.exitCode = 1; });
