import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnalysisEvidence, AnalysisLabels } from "@/lib/analysis-contracts";
import type { Project } from "@/lib/contracts";
import type { FixtureSeed, RawFixtureEvidence } from "@/lib/sampling-contracts";
import { AppError } from "./errors";

interface GoldenLabel {
  sample_id: string; analysis_version: string; is_synthetic: boolean;
  recommendation: string; recommendation_quote: string; recommendation_unknown_reason: string | null;
  fact_claims: { fact_id: string; quote: string; verdict: string; reason: string }[];
}

let referenceFiles: Promise<{ labels: Map<string, GoldenLabel>; inputs: Map<string, RawFixtureEvidence> }> | undefined;

function readReferenceFiles() {
  referenceFiles ??= (async () => {
    const root = join(process.cwd(), "test-materials", "geo-r2");
    const parseLines = <T,>(source: string) => source.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
    const [golden, ...raw] = await Promise.all([
      readFile(join(root, "golden", "labels.jsonl"), "utf8"),
      ...["baseline", "review-1", "review-2"].map((period) => readFile(join(root, "inputs", "evidence", `${period}.jsonl`), "utf8")),
    ]);
    return {
      labels: new Map(parseLines<GoldenLabel>(golden).map((label) => [label.sample_id, label])),
      inputs: new Map(raw.flatMap((source) => parseLines<RawFixtureEvidence>(source)).map((input) => [input.sample_id, input])),
    };
  })();
  return referenceFiles;
}

export async function syntheticReferenceLabels(evidence: AnalysisEvidence, project: Project, seed: FixtureSeed | null): Promise<{ labels: AnalysisLabels; referenceVersion: string }> {
  if (!evidence.isSynthetic || !project.isSynthetic || evidence.sourceType !== "manual_import" || !seed || seed.projectVersion !== evidence.projectVersion) {
    throw new AppError(400, "SYNTHETIC_REFERENCE_NOT_ELIGIBLE", "仅明确标记的原始合成资料版本与人工导入证据可进行参考标注回放；不能替代模型调用。");
  }
  const files = await readReferenceFiles();
  const canonical = evidence.sourceSampleId ? files.inputs.get(evidence.sourceSampleId) : undefined;
  const label = evidence.sourceSampleId ? files.labels.get(evidence.sourceSampleId) : undefined;
  if (!canonical || !label?.is_synthetic || canonical.answer_text !== evidence.answerText || canonical.question_text !== evidence.questionText
    || canonical.source_sample_key !== evidence.sourceKey || canonical.platform !== evidence.platform || canonical.channel_id !== evidence.channelId
    || canonical.source_type !== evidence.sourceType || canonical.period !== evidence.period) {
    throw new AppError(400, "SYNTHETIC_REFERENCE_MISMATCH", "当前证据与合成参考原文或采集条件不匹配，没有自动套用标准答案。");
  }
  return {
    referenceVersion: label.analysis_version,
    labels: {
      recommendation: label.recommendation as AnalysisLabels["recommendation"],
      recommendationQuote: label.recommendation_quote,
      recommendationUnknownReason: label.recommendation_unknown_reason,
      factClaims: label.fact_claims.map((claim) => ({ factId: seed.factIds[claim.fact_id] ?? claim.fact_id, quote: claim.quote, verdict: claim.verdict as AnalysisLabels["factClaims"][number]["verdict"], reason: claim.reason })),
      questionSuggestions: [],
    },
  };
}
