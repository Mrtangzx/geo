import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { metricsSnapshots } from "@/db/analysis-schema";
import type { MetricsSnapshot } from "@/lib/analysis-contracts";
import type { Project } from "@/lib/contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";
import { listRuns } from "./sampling";
import { getAnalysisProjectVersion, listLatestAnalyses, listNormalizedAnalysisEvidence } from "./analysis-repository";
import { calculateEvidenceMetrics } from "./analysis-calculation";
import { samplingPlanShortfalls } from "./sampling-coverage";

export async function createMetricsSnapshot(workspaceId: string, actorId: string, projectId: string): Promise<MetricsSnapshot> {
  await getProject(workspaceId, projectId);
  const [evidence, analyses, runs] = await Promise.all([
    listNormalizedAnalysisEvidence(workspaceId, projectId), listLatestAnalyses(workspaceId, projectId), listRuns(workspaceId, projectId),
  ]);
  const versions = new Map<number, Project>();
  for (const version of new Set(evidence.map((item) => item.projectVersion))) versions.set(version, await getAnalysisProjectVersion(workspaceId, projectId, version));
  const unassignedPlans = samplingPlanShortfalls(runs);
  const incompleteRunIds = new Set(unassignedPlans.map((plan) => plan.runId));
  const now = new Date();
  const snapshot: MetricsSnapshot = {
    id: randomUUID(), projectId, workspaceId, actorId, createdAt: now.toISOString(), calculationVersion: "metrics-v1",
    groups: calculateEvidenceMetrics(evidence, analyses, versions, { incompleteRunIds }),
    overallByScope: calculateEvidenceMetrics(evidence, analyses, versions, { allGroups: true, incompleteRunIds }),
    unassignedPlans,
    notes: [
      "按来源、平台、渠道、问题组、时期与资料/问题/采样条件版本分别统计；没有跨来源合并。",
      "完整但没有正文引用的有效回答进入引用分母；仅来源列表或映射缺失保持未知。",
      "未分析、分析失败与待配置均不记为推荐零值；分母为零或计划归属不明时显示未知。",
      "人工复核与合成参考标注不等于真实模型输出；变化不证明统计显著或因果关系。",
      ...(unassignedPlans.length ? ["存在未返回的计划样本，未猜测其问题组与渠道归属。受影响分组的计划数、缺失数和覆盖率保持未知；真实运行计划见 unassignedPlans。"] : []),
    ],
  };
  await getDatabase().insert(metricsSnapshots).values({ id: snapshot.id, projectId, workspaceId, snapshot, createdAt: now });
  return snapshot;
}

export async function listMetricsSnapshots(workspaceId: string, projectId: string): Promise<MetricsSnapshot[]> {
  await getProject(workspaceId, projectId);
  const rows = await getDatabase().select({ snapshot: metricsSnapshots.snapshot }).from(metricsSnapshots)
    .where(and(eq(metricsSnapshots.workspaceId, workspaceId), eq(metricsSnapshots.projectId, projectId)))
    .orderBy(desc(metricsSnapshots.createdAt)).limit(100);
  return rows.map((row) => row.snapshot);
}

export async function getMetricsSnapshot(workspaceId: string, projectId: string, id: string): Promise<MetricsSnapshot> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select({ snapshot: metricsSnapshots.snapshot }).from(metricsSnapshots)
    .where(and(eq(metricsSnapshots.id, id), eq(metricsSnapshots.workspaceId, workspaceId), eq(metricsSnapshots.projectId, projectId))).limit(1);
  if (!row) throw new AppError(404, "METRICS_SNAPSHOT_NOT_FOUND", "未找到该指标快照。");
  return row.snapshot;
}
