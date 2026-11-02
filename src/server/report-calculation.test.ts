import assert from "node:assert/strict";
import test from "node:test";
import type { ModificationTask, TaskRelease, TaskVerification } from "@/lib/task-contracts";
import { calculateReportComparisons, effectiveVerification } from "./report-calculation";
import type { AnalysisEvidence, EvidenceAnalysis } from "@/lib/analysis-contracts";
import type { Project } from "@/lib/contracts";

function taskWithVerification(allPassed: boolean): ModificationTask {
  const release = { id: "release-1", releaseVersion: 1, superseded: false,
    firstAllConditionsPassedAt: null, syntheticAllConditionsPassedAt: "2026-10-04T02:00:00Z", latestVerificationId: "latest-check" } as TaskRelease;
  // Only these fields participate in the comparison readiness decision.
  return { requiredForComparison: true, state: allPassed ? "synthetic_verified_pending_review" : "awaiting_verification",
    isSynthetic: true, basisStale: false, releases: [release],
    verifications: [{ id: "original-pass", allPassed: true }, { id: "latest-check", allPassed }] as TaskVerification[] } as ModificationTask;
}

test("a later failed verification prevents comparison despite a historical first pass", () => {
  const ready = effectiveVerification([taskWithVerification(true)], true);
  assert.equal(ready.at, "2026-10-04T02:00:00Z");
  const regressed = effectiveVerification([taskWithVerification(false)], true);
  assert.equal(regressed.at, null);
  assert.ok(regressed.reason?.includes("最新核验未通过"));
});

test("a first-pass timestamp without its latest verification evidence is insufficient", () => {
  const task = taskWithVerification(true);
  task.verifications = [];
  assert.equal(effectiveVerification([task], true).at, null);
});

test("complete manual imports remain observations when otherwise identical consumer samples are comparable", () => {
  const project: Project = { id: "project", workspaceId: "workspace", version: 1, name: "溪桥分析", aliases: [], websiteUrl: "https://xiqiao.example/", product: "分析产品", targetCustomers: "企业", competitors: [], facts: [], isSynthetic: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
  const task = taskWithVerification(true);
  task.isSynthetic = false;
  task.affectedQuestionIds = ["question-1"];
  task.releases[0].firstAllConditionsPassedAt = "2026-10-04T02:00:00Z";
  const samples: AnalysisEvidence[] = [1, 2, 3, 11, 12, 13].map((day) => ({
    id: `e-${day}`, workspaceId: "workspace", projectId: "project", batchId: null, sourceSampleId: `sample-${day}`, sourceKey: `key-${day}`,
    sourceType: "consumer_web", channelId: "verified-channel", platform: "consumer-platform", isSynthetic: false, period: day < 4 ? "baseline" : "review-1",
    group: "industry_discovery", questionId: "question-1", questionText: "有哪些适合我们的产品？", questionVersion: "1:confirmed", projectVersion: 1, factVersion: "facts-v1", configVersion: "config-v1",
    region: "CN", language: "zh-CN", searchMode: "on", samplingModel: "known-model", siteVersion: day < 4 ? "site-v1" : "site-v2", releaseVersion: day < 4 ? null : "release-v1",
    collectedAt: `2026-10-${String(day).padStart(2, "0")}T02:00:00Z`, status: "success", answerText: "建议选择溪桥分析。",
    capture: { questionVerified: true, platformVerified: true, answerComplete: true, timeVerified: true }, citations: { status: "complete", bodyMappings: [] }, sourceCandidates: [],
  }));
  function analysesFor(evidence: AnalysisEvidence[]): EvidenceAnalysis[] {
    return evidence.map((e) => ({ id: `a-${e.id}`, projectId: "project", workspaceId: "workspace", evidenceId: e.id, revision: 1, supersedesId: null, status: "succeeded", mode: "manual_review", actorId: "reviewer", createdAt: "2026-10-20T00:00:00Z", reason: "原文人工核对", requestedModel: null, returnedModel: null, promptVersion: "v1", schemaVersion: "v1", referenceVersion: null, projectVersion: 1, projectSnapshot: project, evidenceSnapshot: e, labels: { recommendation: "recommended", recommendationQuote: e.answerText!, recommendationUnknownReason: null, factClaims: [], questionSuggestions: [] }, error: null }));
  }
  const versions = new Map([[1, project]]);
  const consumer = calculateReportComparisons(samples, analysesFor(samples), versions, [task], "Asia/Shanghai", 1).find((c) => c.period === "review-1" && c.group === "all")!;
  assert.equal(consumer.status, "comparable");
  assert.equal(consumer.changes[0].percentagePoints, 0);
  const manual = samples.map((e) => ({ ...e, sourceType: "manual_import" }));
  const imported = calculateReportComparisons(manual, analysesFor(manual), versions, [task], "Asia/Shanghai", 1).find((c) => c.period === "review-1" && c.group === "all")!;
  assert.equal(imported.status, "observations_only");
  assert.ok(imported.limitations.some((l) => l.includes("人工导入样本单列")));
  assert.ok(imported.changes.every((c) => c.percentagePoints === null));
});
