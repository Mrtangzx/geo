import { randomUUID } from "node:crypto";
import type { ModificationTask, TaskPageSnapshot, TaskVerification, VerificationCondition } from "@/lib/task-contracts";
import { AppError } from "./errors";
import { capturePublicPage } from "./page-diagnostics";
import { replayTaskPage } from "./task-offline-pages";

export async function captureLiveTaskPage(url: string): Promise<TaskPageSnapshot> {
  const result = await capturePublicPage(url);
  return {
    id: randomUUID(), url, source: "live_public", isSynthetic: false, executedAt: result.checkedAt, observedAt: result.checkedAt,
    httpStatus: result.httpStatus, bodyComplete: result.bodyComplete, text: result.text, rawBody: result.rawBody,
    bodySha256: result.bodySha256, noindex: result.indexControl.generalNoindex,
    robotsAllows: result.robots.crawlerAccess === "unknown" ? null : result.robots.crawlerAccess === "allowed",
    error: result.error?.message ?? null,
  };
}

export function validateTaskApproval(task: ModificationTask) {
  if (task.basisStale || task.missingFactIds.length || task.type === "missing_facts") throw new AppError(409, "TASK_MATERIAL_REQUIRED", "请先补齐并确认资料、页面证据和最新分析，不能批准缺少依据的任务。");
  const has = (kind: VerificationCondition["kind"]) => task.conditions.some((condition) => condition.kind === kind);
  if (["addition", "rewrite", "correction", "third_party_correction"].includes(task.type)) {
    if (!task.proposedText || !task.conditions.some((condition) => condition.kind === "text_present" && condition.text === task.proposedText)) throw new AppError(400, "APPROVED_TEXT_REQUIRED", "新增、改写或纠错必须包含完整批准文本及对应的出现条件。");
  }
  if (["deletion", "correction", "third_party_correction"].includes(task.type)) {
    const absent = task.conditions.filter((condition): condition is Extract<VerificationCondition, { text: string }> => condition.kind === "text_absent");
    if (!absent.length || absent.some((condition) => !task.beforeSnapshot?.text?.includes(condition.text))) throw new AppError(400, "ORIGINAL_TEXT_EVIDENCE_REQUIRED", "删除或纠错条件必须定位到修改前快照中实际存在的旧说法。");
  }
  if (task.type === "access_repair" && (!task.conditions.some((condition) => condition.kind === "http_status" && condition.equals === 200) || !has("readable_body") || !has("no_noindex") || !has("robots_allows"))) throw new AppError(400, "ACCESS_CONDITIONS_REQUIRED", "访问修复需同时核验200状态、正文、索引控制与robots条件。");
  if (task.type === "third_party_correction" && !has("public_third_party_page_changed")) throw new AppError(400, "THIRD_PARTY_CHANGE_REQUIRED", "第三方任务必须核验公开页面实际改变。");
  if (task.conditions.some((condition) => condition.kind === "robots_allows" && condition.path !== new URL(task.targetUrl).pathname)) throw new AppError(400, "ROBOTS_PATH_MISMATCH", "robots核验路径必须是任务目标页面的路径。");
}

function checkCondition(condition: VerificationCondition, before: TaskPageSnapshot | null, after: TaskPageSnapshot): Pick<TaskVerification["checks"][number], "result" | "reason"> {
  const completePublicBody = after.httpStatus === 200 && after.bodyComplete && after.text !== null;
  const decision = (passed: boolean, yes: string, no: string) => ({ result: passed ? "passed" as const : "failed" as const, reason: passed ? yes : no });
  switch (condition.kind) {
    case "http_status": return after.httpStatus === null ? { result: "unknown", reason: "HTTP状态未知。" } : decision(after.httpStatus === condition.equals, "HTTP状态符合批准条件。", "HTTP状态尚未符合批准条件。");
    case "text_present": return completePublicBody ? decision(after.text!.includes(condition.text), "公开正文出现批准内容。", "公开正文未找到完整批准内容。") : { result: "unknown", reason: "未取得完整且成功的目标正文，不能确认内容出现。" };
    case "text_absent": return completePublicBody ? decision(!after.text!.includes(condition.text), "完整正文中旧说法已消失。", "正文中仍有旧说法。") : { result: "unknown", reason: "未取得完整正文，不能据空内容推定旧说法消失。" };
    case "readable_body": return completePublicBody ? decision(Boolean(after.text!.trim()) && after.text!.includes(condition.text), "正文可读且包含批准条件。", "正文内容未满足批准条件。") : { result: "unknown", reason: "正文读取未完成。" };
    case "no_noindex": return after.noindex === null ? { result: "unknown", reason: "索引控制信号尚未知。" } : decision(!after.noindex, "未观察到通用noindex。", "仍存在noindex或none。");
    case "robots_allows": return after.robotsAllows === null ? { result: "unknown", reason: "robots规则无法独立确认。" } : decision(after.robotsAllows, "该目标路径未被已核对的robots规则阻止。", "目标路径仍被robots规则阻止。");
    case "public_third_party_page_changed": return before?.bodyComplete && before.httpStatus === 200 && before.bodySha256 && completePublicBody ? decision(before.url === after.url && before.bodySha256 !== after.bodySha256 && after.observedAt > before.observedAt, "第三方公开页面有可核对的前后变化。", "提交材料或同一页面旧快照不能证明第三方已经修改。") : { result: "unknown", reason: "缺少可对比的第三方前后公开页面证据。" };
    case "customer_confirmed_material_required": return { result: "unknown", reason: "企业资料仍需补充并重新确认，不能用发布申报替代。" };
  }
}

export async function prepareTaskVerification(task: ModificationTask, releaseId: string, actorId: string, input: { source: "synthetic_fixture" | "live_public"; snapshotId?: string; manual?: boolean; beforeSnapshotId?: string; reason?: string; operatorSnapshots?: { before: TaskPageSnapshot; after: TaskPageSnapshot } }): Promise<TaskVerification> {
  const release = task.releases.find((entry) => entry.id === releaseId);
  const approval = release && task.approvals.find((entry) => entry.id === release.approvalId);
  if (!release || !approval || release.superseded || task.currentApprovalId !== approval.id || approval.draftVersion !== task.draftVersion || task.basisStale) throw new AppError(409, "TASK_APPROVAL_STALE", "发布版本或批准依据已变化，请重新审核与申报。");
  if (task.isSynthetic !== (input.source === "synthetic_fixture") && !input.operatorSnapshots) throw new AppError(409, "VERIFICATION_SOURCE_MISMATCH", "合成任务与真实公开核验必须分别执行，不能互相冒充。");
  if (input.manual && (!input.reason || input.reason.trim().length < 8)) throw new AppError(400, "INDEPENDENT_REASON_REQUIRED", "人工核验需记录独立方法和具体依据，不能只引用客户申报。");
  let before = input.operatorSnapshots?.before ?? task.beforeSnapshot;
  if (input.beforeSnapshotId) before = await replayTaskPage(input.beforeSnapshotId, task.targetUrl);
  const after = input.operatorSnapshots?.after ?? (input.source === "synthetic_fixture" ? await replayTaskPage(input.snapshotId ?? "", task.targetUrl) : await captureLiveTaskPage(task.targetUrl));
  if (after.url !== task.targetUrl || (before && before.url !== task.targetUrl)) throw new AppError(400, "VERIFICATION_URL_MISMATCH", "核验前后证据必须属于批准目标页面。");
  if (input.manual && (!before || before.id === after.id || before.bodySha256 === after.bodySha256)) throw new AppError(400, "INDEPENDENT_EVIDENCE_REQUIRED", "人工核验必须提供独立且可区分的前后快照，客户自称上线不能通过。");
  const checks = approval.conditions.map((condition, index) => ({ index, condition, ...checkCondition(condition, before, after) }));
  return {
    id: randomUUID(), releaseId, executedAt: new Date().toISOString(), observedAt: after.observedAt,
    source: input.manual ? "independent_manual" : input.source, isSynthetic: task.isSynthetic || after.isSynthetic || Boolean(before?.isSynthetic), actorId,
    method: input.manual ? "independent_snapshot_comparison" : input.source === "synthetic_fixture" ? "fixed_manifest_replay" : "public_page_conditions",
    reason: input.reason ?? null, checks, allPassed: checks.length > 0 && checks.every((entry) => entry.result === "passed"),
    beforeSnapshot: before, afterSnapshot: after, independentEvidence: input.manual ? [before!.id, after.id] : [],
  };
}
