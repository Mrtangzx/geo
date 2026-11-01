import type { Project } from "@/lib/contracts";
import type { AnalysisEvidence, EvidenceAnalysis, MetricsGroup } from "@/lib/analysis-contracts";
import type { ModificationTask } from "@/lib/task-contracts";
import type { ReportComparison, ReportWindow } from "@/lib/report-contracts";
import { calculateEvidenceMetrics, evidenceMetricsScope } from "./analysis-calculation";
import { localDate, reviewCalendar } from "./monitoring-calendar";

export function reportWindows(tasks: ModificationTask[], timezone: string, now = new Date()): ReportWindow[] {
  return tasks.flatMap((task) => task.releases.map((release) => {
    const verifiedAt = release.isSynthetic ? release.syntheticAllConditionsPassedAt : release.firstAllConditionsPassedAt;
    const slots = verifiedAt ? reviewCalendar(verifiedAt, timezone) : [];
    const firstDates = slots.filter((s) => s.purpose === "review-1").map((s) => s.localDate);
    const secondDates = slots.filter((s) => s.purpose === "review-2").map((s) => s.localDate);
    const today = localDate(now, timezone);
    return {
      releaseId: release.id, taskId: task.id, releaseVersion: release.releaseVersion,
      verifiedAt, isSynthetic: release.isSynthetic, superseded: release.superseded, firstDates, secondDates,
      state: release.superseded ? "superseded" : !verifiedAt ? "awaiting_verification" : release.isSynthetic ? "synthetic_observation"
        : today > secondDates.at(-1)! ? "window_elapsed" : "observing",
    } satisfies ReportWindow;
  }));
}

function scopeKey(evidence: AnalysisEvidence, all: boolean): string {
  const scope = evidenceMetricsScope(evidence, all);
  return JSON.stringify({ ...scope, period: undefined });
}

export function effectiveVerification(tasks: ModificationTask[], synthetic: boolean): { at: string | null; reason: string | null } {
  const required = tasks.filter((task) => task.requiredForComparison && task.state !== "cancelled" && task.isSynthetic === synthetic);
  if (!required.length) return { at: null, reason: "尚未明确本轮比较所需的修改任务与核验版本。" };
  const times: string[] = [];
  for (const task of required) {
    const latest = task.releases.filter((r) => !r.superseded).sort((a, b) => b.releaseVersion - a.releaseVersion)[0];
    const at = latest && (synthetic ? latest.syntheticAllConditionsPassedAt : latest.firstAllConditionsPassedAt);
    const check = latest && task.verifications.find((entry) => entry.id === latest.latestVerificationId);
    if (!at || task.basisStale || !check?.allPassed) return { at: null, reason: "本轮必要修改尚未全部核验通过、最新核验未通过，或诊断依据已变化。" };
    times.push(at);
  }
  return { at: times.sort().at(-1)!, reason: null };
}

function knownDate(evidence: AnalysisEvidence, timezone: string): string | null {
  return evidence.collectedAt && Number.isFinite(Date.parse(evidence.collectedAt)) ? localDate(evidence.collectedAt, timezone) : null;
}

function aggregate(evidence: AnalysisEvidence[], analyses: EvidenceAnalysis[], projects: Map<number, Project>, all: boolean): MetricsGroup | null {
  return calculateEvidenceMetrics(evidence, analyses, projects, { allGroups: all })[0] ?? null;
}

function coverage(group: MetricsGroup | null, count: number) {
  if (!group) return;
  group.planned = count;
  group.missing = Math.max(0, count - group.valid - group.failed - group.incomplete - group.pending);
  group.validCoverage = { numerator: group.valid, denominator: count, percent: count > 0 ? group.valid / count * 100 : null };
}

export function calculateReportComparisons(
  evidence: AnalysisEvidence[], analyses: EvidenceAnalysis[], projects: Map<number, Project>, tasks: ModificationTask[], timezone: string, repeatsPerDay: number,
): ReportComparison[] {
  const comparisons: ReportComparison[] = [];
  for (const all of [true, false]) {
    const byScope = new Map<string, AnalysisEvidence[]>();
    for (const item of evidence.filter((e) => ["baseline", "review-1", "review-2"].includes(e.period))) {
      const key = scopeKey(item, all);
      byScope.set(key, [...(byScope.get(key) ?? []), item]);
    }
    for (const [key, items] of byScope) {
      const source = items[0];
      const baseline = items.filter((item) => item.period === "baseline");
      for (const period of ["review-1", "review-2"]) {
        const review = items.filter((item) => item.period === period);
        if (!review.length && !baseline.length) continue;
        const beforeIds = new Set(baseline.map((e) => e.questionId));
        const afterIds = new Set(review.map((e) => e.questionId));
        const questionIntersection = [...beforeIds].filter((id) => afterIds.has(id)).sort();
        const exclusions: ReportComparison["exclusions"] = [...new Set([...beforeIds, ...afterIds])]
          .filter((id) => !questionIntersection.includes(id)).map((questionId) => ({ questionId, reason: beforeIds.has(questionId) ? "当前复查时期或同配置缺少该问题" : "基线或同配置缺少该问题" }));
        for (let i = questionIntersection.length - 1; i >= 0; i--) {
          const id = questionIntersection[i];
          if (new Set([...baseline, ...review].filter((e) => e.questionId === id).map((e) => e.questionText)).size > 1) {
            questionIntersection.splice(i, 1); exclusions.push({ questionId: id, reason: "问题文字已经变化，不能直接拼接比较。" });
          }
        }
        const before = baseline.filter((item) => questionIntersection.includes(item.questionId));
        const after = review.filter((item) => questionIntersection.includes(item.questionId));
        const beforeMetrics = aggregate(before, analyses, projects, all);
        const afterMetrics = aggregate(after, analyses, projects, all);
        const planned = questionIntersection.length * 3 * repeatsPerDay;
        coverage(beforeMetrics, planned); coverage(afterMetrics, planned);
        const baselineDates = [...new Set(before.map((e) => knownDate(e, timezone)).filter((d): d is string => !!d))].sort();
        const reviewDates = [...new Set(after.map((e) => knownDate(e, timezone)).filter((d): d is string => !!d))].sort();
        const limitations: string[] = [];
        if (source.isSynthetic) limitations.push("合成演练仅验证工程流程，不能证明真实通道、真实日期观察或优化效果。");
        if (!questionIntersection.length) limitations.push("没有共同且配置可比的问题集合。");
        if (!baseline.length || !review.length) limitations.push("基线或该轮复查尚无同配置回答，配置变化的样本单列。");
        if (source.region == null || source.language == null || source.searchMode == null || source.samplingModel == null) limitations.push("地区、语言、搜索配置或采样模型存在未知条件，保留观察数据。");
        const verification = effectiveVerification(tasks, source.isSynthetic);
        if (verification.reason) limitations.push(verification.reason);
        if (verification.at) {
          const slots = reviewCalendar(verification.at, timezone).filter((slot) => slot.purpose === period).map((slot) => slot.localDate);
          if (reviewDates.some((date) => !slots.includes(date))) limitations.push("部分复查样本不在本轮全部条件通过后的指定窗口内，不用于完整改善结论。");
          if (baselineDates.some((date) => date >= localDate(verification.at!, timezone))) limitations.push("部分基线日期在本轮上线核验通过之后。");
        }
        for (const [name, samples] of [["基线", before], ["复查", after]] as const) {
          if (new Set(samples.map((e) => knownDate(e, timezone)).filter(Boolean)).size !== 3) limitations.push(`${name}未覆盖三个实际采集日期。`);
          for (const id of questionIntersection) {
            const perDate = new Map<string, Set<string>>();
            for (const item of samples.filter((e) => e.questionId === id)) {
              const date = knownDate(item, timezone);
              if (date) perDate.set(date, new Set([...(perDate.get(date) ?? []), item.sourceKey]));
            }
            if (perDate.size !== 3 || [...perDate.values()].some((set) => set.size !== repeatsPerDay)) {
              limitations.push(`${name}每题每天的实际重复次数与冻结计划不一致。`); break;
            }
          }
        }
        if ([beforeMetrics, afterMetrics].some((g) => !g || g.failed || g.incomplete || g.pending || g.missing || g.unanalysed || g.analysisFailed)) limitations.push("样本、分析或计划覆盖不完整，暂不能形成完整比较。");
        const status = limitations.length ? "observations_only" : "comparable";
        const changes = (["recommendation", "facts", "officialCitation"] as const).map((metric) => {
          const b = beforeMetrics?.[metric].percent ?? null;
          const a = afterMetrics?.[metric].percent ?? null;
          return { metric, baseline: b, review: a, percentagePoints: status === "comparable" && b != null && a != null ? a - b : null };
        });
        const worsened = changes.some((change) => (change.percentagePoints ?? 0) < 0);
        const improved = changes.some((change) => (change.percentagePoints ?? 0) > 0);
        const nextActions = status !== "comparable" ? ["先补齐上线核验、窗口样本与未知采样条件，再重新生成报告版本。"]
          : !improved || worsened ? ["重新核对页面上线情况、采样条件与诊断原文，为无变化或负向主题建立下一轮任务。"] : ["继续按既定采样条件观察，保留负向变化与未修改主题的参照。"];
        const affected = new Set(tasks.flatMap((t) => t.affectedQuestionIds));
        const unchanged = questionIntersection.filter((id) => !affected.has(id));
        limitations.push(unchanged.length ? `有${unchanged.length}个未修改主题可作为观察参照；不能据此推断因果关系或统计显著性。` : "本集合没有明确的未修改主题参照，不能宣称因果关系或统计显著性。");
        comparisons.push({ id: `${comparisons.length + 1}:${key}`, period, sourceType: source.sourceType, platform: source.platform, channelId: source.channelId,
          group: all ? "all" : source.group, isSynthetic: source.isSynthetic, status, questionIntersection, exclusions,
          baseline: beforeMetrics, review: afterMetrics, changes, baselineDates, reviewDates, limitations: [...new Set(limitations)], nextActions });
      }
    }
  }
  return comparisons;
}
