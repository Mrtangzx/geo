import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModificationTask, ModificationTaskType, VerificationCondition } from "@/lib/task-contracts";
import { getProject } from "./projects";
import { getFixtureSeed } from "./synthetic-fixtures";
import { listEvidence } from "./sampling";
import { listActionableDiagnoses } from "./analysis-repository";
import { AppError } from "./errors";
import { ensureFixturePageSelection, replayTaskPage } from "./task-offline-pages";

interface FixtureTask { task_id: string; type: ModificationTaskType; target_url: string; position: string; evidence_ids: string[]; fact_ids: string[]; affected_question_ids: string[]; proposed_text: string | null; verification_conditions: VerificationCondition[]; required_for_comparison: boolean; hypothesis: string }
const titles: Record<ModificationTaskType, string> = { correction: "纠正部署方式的错误介绍", addition: "补充适用客户与实施前提", rewrite: "改写有依据的页面内容", deletion: "删除页面中的错误说法", access_repair: "修复私有化方案页访问条件", third_party_correction: "准备第三方厂商介绍纠错", missing_facts: "补充认证和报价的确认资料" };

export async function generateTaskDrafts(workspaceId: string, projectId: string, actorId: string): Promise<ModificationTask[]> {
  const project = await getProject(workspaceId, projectId);
  const diagnoses = await listActionableDiagnoses(workspaceId, projectId);
  if (!diagnoses.length) throw new AppError(409, "ANALYSIS_REQUIRED", "尚无已成功且有依据的诊断，请先导入回答并完成分析。");
  const now = new Date().toISOString();
  if (!project.isSynthetic) {
    return diagnoses.map((diagnosis) => ({
      id: randomUUID(), workspaceId, projectId, revision: 1, draftVersion: 1,
      title: diagnosis.requiresFacts ? "补充企业事实依据" : "核对回答冲突对应的页面位置", type: "missing_facts", category: "content_facts", priority: "high", state: "needs_material",
      targetUrl: diagnosis.targetUrls[0] ?? project.websiteUrl, position: "页面位置待核对", proposedText: diagnosis.suggestedText,
      conditions: [{ kind: "customer_confirmed_material_required" }], evidence: [{ id: diagnosis.evidenceId, kind: "answer", quote: diagnosis.quote }],
      factIds: [diagnosis.factId], missingFactIds: diagnosis.requiresFacts ? [diagnosis.factId] : [], affectedQuestionIds: [diagnosis.questionId],
      hypothesis: "回答冲突不证明官网是原因，需先核对具体页面位置及事实资料。", requiredForComparison: false, isSynthetic: false, origin: "analysis_diagnosis", fixtureTaskId: null,
      basis: { projectVersion: project.version, analysisIds: [diagnosis.analysisId], analysisVersion: String(diagnosis.analysisRevision), questionVersion: null, promptVersion: "evidence-action-v1", model: "diagnosis-with-page-review-required" },
      basisStale: false, beforeSnapshot: null, currentApprovalId: null, approvals: [], releases: [], verifications: [], createdAt: now, updatedAt: now, actorId, cancelReason: null,
    }));
  }
  const seed = await getFixtureSeed(workspaceId, projectId);
  if (!seed || seed.projectVersion !== project.version) throw new AppError(409, "FIXTURE_BASIS_STALE", "请使用当前已导入并分析的固定合成企业版本，不能混用资料。");
  const evidence = await listEvidence(workspaceId, projectId);
  await ensureFixturePageSelection(workspaceId, projectId);
  const fixtures = JSON.parse(await readFile(path.join(process.cwd(), "test-materials/geo-r2/inputs/change-tasks.json"), "utf8")) as { is_synthetic: boolean; tasks: FixtureTask[] };
  if (!fixtures.is_synthetic) throw new AppError(409, "FIXTURE_INVALID", "任务模板不是明确的合成资料。");
  return Promise.all(fixtures.tasks.map(async (entry): Promise<ModificationTask> => {
    const refs: ModificationTask["evidence"] = [];
    for (const sourceId of entry.evidence_ids) {
      if (sourceId.startsWith("B-")) {
        const found = evidence.find((item) => item.sourceSampleId === sourceId && item.isSynthetic && item.projectVersion === project.version);
        if (!found?.answerText) throw new AppError(409, "TASK_EVIDENCE_MISSING", `缺少任务所需的合成回答${sourceId}，请先导入基线。`);
        refs.push({ id: found.id, kind: "answer", quote: diagnoses.find((item) => item.evidenceId === found.id)?.quote ?? found.answerText });
      } else refs.push({ id: sourceId, kind: "fixture_page", quote: null });
    }
    const beforeId = entry.evidence_ids.find((id) => id.endsWith("before") && id !== "robots-before");
    const beforeSnapshot = beforeId ? await replayTaskPage(beforeId, entry.target_url) : null;
    const factIds = entry.fact_ids.map((id) => seed.factIds[id]).filter(Boolean);
    const missingFactIds = factIds.filter((id) => project.facts.find((fact) => fact.id === id)?.status !== "confirmed");
    return {
      id: randomUUID(), workspaceId, projectId, revision: 1, draftVersion: 1, title: titles[entry.type], type: entry.type,
      category: entry.type === "access_repair" ? "access" : entry.type === "third_party_correction" ? "cited_source" : "content_facts", priority: ["correction", "access_repair"].includes(entry.type) ? "high" : "normal",
      state: missingFactIds.length || entry.type === "missing_facts" ? "needs_material" : "awaiting_approval", targetUrl: entry.target_url, position: entry.position, proposedText: entry.proposed_text,
      conditions: entry.verification_conditions, evidence: refs, factIds, missingFactIds,
      affectedQuestionIds: entry.affected_question_ids.map((id) => seed.questionIds[id]).filter(Boolean), hypothesis: entry.hypothesis,
      requiredForComparison: entry.required_for_comparison, isSynthetic: true, origin: "synthetic_template", fixtureTaskId: entry.task_id,
      basis: { projectVersion: project.version, analysisIds: [...new Set(diagnoses.filter((item) => refs.some((ref) => ref.id === item.evidenceId)).map((item) => item.analysisId))], analysisVersion: "synthetic-reference-v1", questionVersion: seed.questionVersion, promptVersion: "fixture-action-template-v1", model: "fixed-synthetic-task-template-not-model" },
      basisStale: false, beforeSnapshot, currentApprovalId: null, approvals: [], releases: [], verifications: [], createdAt: now, updatedAt: now, actorId, cancelReason: null,
    };
  }));
}
