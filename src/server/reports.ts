import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { projects, projectVersions } from "@/db/schema";
import { evidenceAnalyses, metricsSnapshots } from "@/db/analysis-schema";
import { answerEvidence } from "@/db/sampling-schema";
import { reviewReports } from "@/db/report-schema";
import type { ReportSummary, ReviewReport } from "@/lib/report-contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";
import { listTasks } from "./task-repository";
import { listMonitoringPlans } from "./monitoring";
import { normalizeAnalysisEvidence } from "./analysis-evidence";
import { calculateReportComparisons, reportWindows } from "./report-calculation";
import { enrichEvidenceAttachments } from "./evidence-attachments";

export const createReportSchema = z.object({ metricsSnapshotId: z.string().uuid() }).strict();

export async function listReports(workspaceId: string, projectId: string): Promise<ReportSummary[]> {
  await getProject(workspaceId, projectId);
  const rows = await getDatabase().select({ snapshot: reviewReports.snapshot }).from(reviewReports)
    .where(and(eq(reviewReports.workspaceId, workspaceId), eq(reviewReports.projectId, projectId))).orderBy(desc(reviewReports.version));
  return rows.map(({ snapshot: r }) => ({ id: r.id, version: r.version, createdAt: r.createdAt, metricsSnapshotId: r.metricsSnapshot.id,
    isSynthetic: r.evidence.some((e) => e.isSynthetic), comparisonCount: r.comparisons.length, comparableCount: r.comparisons.filter((c) => c.status === "comparable").length }));
}

export async function getReport(workspaceId: string, projectId: string, reportId: string): Promise<ReviewReport> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select({ snapshot: reviewReports.snapshot }).from(reviewReports)
    .where(and(eq(reviewReports.workspaceId, workspaceId), eq(reviewReports.projectId, projectId), eq(reviewReports.id, reportId))).limit(1);
  if (!row) throw new AppError(404, "REPORT_NOT_FOUND", "未找到该报告版本。");
  return row.snapshot;
}

export async function createReport(workspaceId: string, actorId: string, projectId: string, metricsSnapshotId: string): Promise<ReviewReport> {
  const projectSnapshot = await getProject(workspaceId, projectId);
  const db = getDatabase();
  const [metric] = await db.select({ snapshot: metricsSnapshots.snapshot }).from(metricsSnapshots)
    .where(and(eq(metricsSnapshots.id, metricsSnapshotId), eq(metricsSnapshots.workspaceId, workspaceId), eq(metricsSnapshots.projectId, projectId))).limit(1);
  if (!metric) throw new AppError(404, "METRICS_SNAPSHOT_NOT_FOUND", "未找到当前工作区的指标快照。");
  const refs = metric.snapshot.groups.flatMap((g) => g.references);
  const evidenceIds = [...new Set(refs.map((r) => r.evidenceId))];
  const analysisIds = [...new Set(refs.map((r) => r.analysisId).filter((id): id is string => !!id))];
  const [evidenceRows, analysisRows, versions, tasks, monitoringPlans] = await Promise.all([
    evidenceIds.length ? db.select({ snapshot: answerEvidence.snapshot }).from(answerEvidence).where(and(eq(answerEvidence.workspaceId, workspaceId), eq(answerEvidence.projectId, projectId), inArray(answerEvidence.id, evidenceIds))) : Promise.resolve([]),
    analysisIds.length ? db.select({ snapshot: evidenceAnalyses.snapshot }).from(evidenceAnalyses).where(and(eq(evidenceAnalyses.workspaceId, workspaceId), eq(evidenceAnalyses.projectId, projectId), inArray(evidenceAnalyses.id, analysisIds))) : Promise.resolve([]),
    db.select({ snapshot: projectVersions.snapshot }).from(projectVersions).where(and(eq(projectVersions.workspaceId, workspaceId), eq(projectVersions.projectId, projectId))),
    listTasks(workspaceId, projectId), listMonitoringPlans(workspaceId, projectId),
  ]);
  if (evidenceRows.length !== evidenceIds.length || analysisRows.length !== analysisIds.length) throw new AppError(409, "REPORT_BASIS_MISSING", "指标快照引用的证据或标签版本不完整，不能生成报告。");
  const evidence = (await enrichEvidenceAttachments(evidenceRows.map((row) => row.snapshot))).map(normalizeAnalysisEvidence);
  const analyses = analysisRows.map((row) => row.snapshot);
  const timezone = monitoringPlans[0]?.timezone ?? "Asia/Shanghai";
  const repeatsPerDay = monitoringPlans[0]?.repeatsPerDay ?? 1;
  const now = new Date().toISOString();
  const comparisons = calculateReportComparisons(evidence, analyses, new Map(versions.map((v) => [v.snapshot.version, v.snapshot])), tasks, timezone, repeatsPerDay);
  const notes = [
    "报告绑定保存时的证据、标签、资料、任务发布、指标与计算版本；后续纠错须生成新报告，旧版本保留。",
    "不同来源、平台、渠道、配置与问题组分别统计；未知、失败、缺失不等于零。候选来源列表不当作正文引用。",
    "变化不证明因果关系或统计显著性；外部回放链接可能失效，已保存原文及标签版本可供核对。",
  ];
  if (evidence.some((e) => e.isSynthetic)) notes.unshift("本报告包含明确的合成演练材料，历史日期及数值不构成真实企业、真实通道或实际日期效果验收。");
  if (!monitoringPlans.length) notes.push("尚无冻结监测计划；每题每日一次仅用于观察数据展示，暂不能证明计划覆盖。未冻结计划的比较结论保持受限。");
  if (!monitoringPlans.length) for (const comparison of comparisons) {
    comparison.status = "observations_only";
    comparison.changes.forEach((change) => { change.percentagePoints = null; });
    comparison.limitations.push("缺少冻结基线计划，重复次数尚未确认。");
  }
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ version: projects.version }).from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId))).for("update");
    if (current?.version !== projectSnapshot.version) throw new AppError(409, "REPORT_PROJECT_CHANGED", "品牌资料已变化，请重新生成指标快照并核对报告。");
    const [{ highest }] = await tx.select({ highest: max(reviewReports.version) }).from(reviewReports).where(and(eq(reviewReports.workspaceId, workspaceId), eq(reviewReports.projectId, projectId)));
    const [previous] = await tx.select({ id: reviewReports.id }).from(reviewReports).where(and(eq(reviewReports.workspaceId, workspaceId), eq(reviewReports.projectId, projectId))).orderBy(desc(reviewReports.version)).limit(1);
    const report: ReviewReport = {
      id: randomUUID(), workspaceId, projectId, version: (highest ?? 0) + 1, supersedesId: previous?.id ?? null,
      createdAt: now, actorId, calculationVersion: "report-v1", timezone, projectSnapshot,
      metricsSnapshot: metric.snapshot, evidence, analyses, tasks, monitoringPlans,
      windows: reportWindows(tasks, timezone), comparisons, notes,
    };
    await tx.insert(reviewReports).values({ id: report.id, workspaceId, projectId, version: report.version, snapshot: report, createdAt: new Date(now) });
    return report;
  });
}
