import type { Project } from "@/lib/contracts";
import type { AnalysisEvidence, EvidenceAnalysis, EvidenceMetricReference, MetricRate, MetricsGroup, MetricsScope } from "@/lib/analysis-contracts";
import { evidenceExclusion } from "./analysis-validation";

export function metricRate(numerator: number, denominator: number | null): MetricRate {
  return { numerator, denominator, percent: denominator !== null && denominator > 0 ? numerator / denominator * 100 : null };
}

export function citationObservation(evidence: AnalysisEvidence, project: Project): { complete: boolean; official: boolean | null } {
  const mappings = evidence.citations.bodyMappings;
  if (evidence.citations.status !== "complete" || !Array.isArray(mappings)) return { complete: false, official: null };
  let officialHost: string;
  try { officialHost = new URL(project.websiteUrl).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); }
  catch { return { complete: false, official: null }; }
  let official = false;
  for (const citation of mappings) {
    if (!citation.quote?.trim() || !evidence.answerText?.includes(citation.quote)) return { complete: false, official: null };
    try {
      const url = new URL(citation.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return { complete: false, official: null };
      const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
      if (host === officialHost || host.endsWith(`.${officialHost}`)) official = true;
    } catch { return { complete: false, official: null }; }
  }
  return { complete: true, official };
}

export function evidenceMetricsScope(evidence: AnalysisEvidence, allGroups = false): MetricsScope {
  return {
    sourceType: evidence.sourceType, platform: evidence.platform, channelId: evidence.channelId, isSynthetic: evidence.isSynthetic,
    period: evidence.period, group: allGroups ? "all" : evidence.group, questionVersion: evidence.questionVersion,
    projectVersion: evidence.projectVersion, factVersion: evidence.factVersion, configVersion: evidence.configVersion,
    region: evidence.region, language: evidence.language, searchMode: evidence.searchMode, samplingModel: evidence.samplingModel,
  };
}

function emptyGroup(scope: MetricsScope): MetricsGroup {
  return {
    scope, observed: 0, planned: 0, valid: 0, failed: 0, incomplete: 0, pending: 0, missing: 0, duplicate: 0, unanalysed: 0, analysisFailed: 0, planningComplete: true,
    recommendationCounts: { recommended: 0, mentioned: 0, not_mentioned: 0, not_recommended: 0, unknown: 0 },
    factCounts: { consistent: 0, conflict: 0, unknown: 0 },
    validCoverage: metricRate(0, 0), recommendation: metricRate(0, 0), recommendationCoverage: metricRate(0, 0),
    facts: metricRate(0, 0), factCoverage: metricRate(0, 0), officialCitation: metricRate(0, 0), citationCoverage: metricRate(0, 0), references: [],
  };
}

export function calculateEvidenceMetrics(
  evidence: AnalysisEvidence[], analyses: EvidenceAnalysis[], projectVersions: Map<number, Project>,
  options: { allGroups?: boolean; incompleteRunIds?: Set<string> } = {},
): MetricsGroup[] {
  const groups = new Map<string, MetricsGroup>();
  const latest = new Map<string, EvidenceAnalysis>();
  for (const analysis of analyses) if (!latest.has(analysis.evidenceId) || latest.get(analysis.evidenceId)!.revision < analysis.revision) latest.set(analysis.evidenceId, analysis);
  const seen = new Set<string>();
  for (const item of evidence) {
    const scope = evidenceMetricsScope(item, options.allGroups);
    const scopeKey = JSON.stringify(scope);
    if (!groups.has(scopeKey)) groups.set(scopeKey, emptyGroup(scope));
    const group = groups.get(scopeKey)!;
    const key = JSON.stringify([item.workspaceId, item.sourceType, item.channelId, item.platform, item.sourceKey || item.id]);
    const duplicate = seen.has(key);
    if (!duplicate) seen.add(key);
    const project = projectVersions.get(item.projectVersion);
    const excluded = duplicate ? "重复来源样本，未增加样本量" : !project ? "缺少证据绑定的企业资料版本" : evidenceExclusion(item);
    const analysis = latest.get(item.id);
    const citation = !excluded && project ? citationObservation(item, project) : { complete: false, official: null };
    const reference: EvidenceMetricReference = {
      evidenceId: item.id, sourceSampleId: item.sourceSampleId, analysisId: analysis?.id ?? null, analysisRevision: analysis?.revision ?? null,
      analysisMode: analysis?.mode ?? null, valid: !excluded, excludedReason: excluded, citationComplete: citation.complete, officialCitation: citation.official,
    };
    group.references.push(reference);
    if (duplicate) { group.duplicate += 1; continue; }
    group.observed += 1;
    if (item.batchId && options.incompleteRunIds?.has(item.batchId)) group.planningComplete = false;
    if (excluded) {
      if (["pending", "queued", "running"].includes(item.status)) group.pending += 1;
      else if (item.status !== "success") group.failed += 1;
      else group.incomplete += 1;
      continue;
    }
    group.valid += 1;
    if (citation.complete) {
      group.citationCoverage.numerator += 1;
      if (citation.official) group.officialCitation.numerator += 1;
    }
    if (!analysis || analysis.status !== "succeeded" || !analysis.labels) {
      if (!analysis) group.unanalysed += 1;
      else group.analysisFailed += 1;
      group.recommendationCounts.unknown += 1;
      continue;
    }
    // Only the labels bound to this immutable evidence/project version count.
    if (analysis.projectVersion !== item.projectVersion || analysis.evidenceSnapshot.answerText !== item.answerText) {
      group.analysisFailed += 1; group.recommendationCounts.unknown += 1; continue;
    }
    group.recommendationCounts[analysis.labels.recommendation] += 1;
    for (const claim of analysis.labels.factClaims) {
      const fact = project!.facts.find((candidate) => candidate.id === claim.factId);
      const verdict = !fact || fact.status !== "confirmed" ? "unknown" : claim.verdict;
      group.factCounts[verdict] += 1;
    }
  }
  for (const group of groups.values()) {
    group.planned = group.planningComplete ? group.observed : null;
    group.missing = group.planningComplete ? 0 : null;
    const knownRecommendations = group.valid - group.recommendationCounts.unknown;
    const knownFacts = group.factCounts.consistent + group.factCounts.conflict;
    const completeCitations = group.citationCoverage.numerator;
    group.validCoverage = metricRate(group.valid, group.planned);
    group.recommendation = metricRate(group.recommendationCounts.recommended, knownRecommendations);
    group.recommendationCoverage = metricRate(knownRecommendations, group.valid);
    group.facts = metricRate(group.factCounts.consistent, knownFacts);
    group.factCoverage = metricRate(knownFacts, knownFacts + group.factCounts.unknown);
    group.officialCitation = metricRate(group.officialCitation.numerator, completeCitations);
    group.citationCoverage = metricRate(completeCitations, group.valid);
  }
  return [...groups.values()].sort((left, right) => JSON.stringify(left.scope).localeCompare(JSON.stringify(right.scope)));
}
