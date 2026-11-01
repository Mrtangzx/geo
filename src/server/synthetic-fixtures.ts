import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { projects, projectVersions, workspaces } from "@/db/schema";
import { questionSets, questionSetVersions } from "@/db/question-schema";
import { fixtureSeeds } from "@/db/sampling-schema";
import type { Project } from "@/lib/contracts";
import type { BuyerQuestion, QuestionGroup, QuestionSet, QuestionSetVersion } from "@/lib/question-contracts";
import type { FixturePeriod, FixtureSeed, RawFixtureEvidence } from "@/lib/sampling-contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";
import { ensureFixturePageSelection } from "./task-offline-pages";

const root = path.join(process.cwd(), "test-materials", "geo-r2", "inputs");
const periods: Record<FixturePeriod, string> = { baseline: "baseline.jsonl", "review-1": "review-1.jsonl", "review-2": "review-2.jsonl", edge: "edge-cases.jsonl" };
export const fixtureGroupMap: Record<string, QuestionGroup> = { "行业发现": "industry_discovery", "方案比较": "solution_comparison", "品牌核实": "brand_verification" };

export async function loadFixturePeriod(period: FixturePeriod): Promise<RawFixtureEvidence[]> {
  if (!Object.hasOwn(periods, period)) throw new AppError(400, "UNKNOWN_FIXTURE_PERIOD", "请选择固定的合成演练周期。");
  const text = await readFile(path.join(root, "evidence", periods[period]), "utf8");
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const value = JSON.parse(line) as RawFixtureEvidence;
    if (value.is_synthetic !== true || !value.sample_id || !value.source_sample_key || !value.question_id) throw new AppError(500, "INVALID_FIXTURE", "固定合成资料不完整，请恢复已验证资料版本。");
    return value;
  });
}

export async function getFixtureSeed(workspaceId: string, projectId: string): Promise<FixtureSeed | null> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select().from(fixtureSeeds).where(and(eq(fixtureSeeds.workspaceId, workspaceId), eq(fixtureSeeds.projectId, projectId)));
  return row?.snapshot ?? null;
}

export async function seedFixtureProject(workspaceId: string, actorId: string): Promise<FixtureSeed> {
  const brandFile = JSON.parse(await readFile(path.join(root, "brand.json"), "utf8"));
  const facts = parse(await readFile(path.join(root, "facts.csv"), "utf8"), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
  const questions = parse(await readFile(path.join(root, "questions.csv"), "utf8"), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
  const brand = brandFile.primary;
  if (!brand?.is_synthetic || facts.some((fact) => fact.is_synthetic !== "true") || questions.some((question) => question.is_synthetic !== "true")) throw new AppError(500, "INVALID_FIXTURE", "固定资料未明确标识为合成，停止导入。");
  const seed = await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId + ":geo-r2-v1"}, 0))`);
    const [prior] = await tx.select().from(fixtureSeeds).where(and(eq(fixtureSeeds.workspaceId, workspaceId), eq(fixtureSeeds.manifestId, "geo-r2-v1")));
    if (prior) return prior.snapshot;
    const now = new Date(); const stamp = now.toISOString(); const projectId = randomUUID();
    const factIds: Record<string, string> = {}; const questionIds: Record<string, string> = {};
    const project: Project = {
      id: projectId, workspaceId, version: 1, name: brand.name + "（合成演练）", aliases: brand.aliases,
      websiteUrl: brand.official_url, product: brand.product, targetCustomers: brand.target_customers.join("；"),
      competitors: brand.competitors.map((competitor: { name: string; url: string }) => ({ name: competitor.name, websiteUrl: competitor.url })),
      facts: facts.map((fact) => {
        const id = randomUUID(); factIds[fact.fact_id] = id;
        return { id, statement: fact.statement, sourceUrl: "", sourceRef: fact.source_ref,
          status: fact.status === "confirmed" ? "confirmed" : "needs_confirmation",
          confirmedBy: fact.confirmed_by ? "synthetic:" + fact.confirmed_by : null, confirmedAt: null };
      }), isSynthetic: true, createdAt: stamp, updatedAt: stamp,
    };
    const buyerQuestions: BuyerQuestion[] = questions.map((question) => {
      const id = randomUUID(); questionIds[question.question_id] = id;
      return { id, text: question.text, group: fixtureGroupMap[question.group], sourceRef: question.source_ref, sourceModel: null,
        sourceType: question.source_ref.startsWith("销售咨询") ? "sales_inquiry" : question.source_ref.startsWith("客户 FAQ") ? "customer_faq" : "search_term",
        priority: question.priority === "P0" ? "high" : question.priority === "P2" ? "low" : "normal", isFocus: question.is_focus === "true" };
    });
    const current: QuestionSet = { projectId, workspaceId, revision: 2, status: "confirmed", questions: buyerQuestions, latestConfirmedVersion: 1, confirmedAt: stamp, confirmedBy: actorId, updatedAt: stamp };
    const version: QuestionSetVersion = { projectId, workspaceId, version: 1, sourceRevision: 1, questions: buyerQuestions, confirmedAt: stamp, confirmedBy: actorId };
    const snapshot: FixtureSeed = { manifestId: "geo-r2-v1", workspaceId, projectId, projectVersion: 1, questionVersion: 1, factIds, questionIds,
      fixtureBrandVersion: "brand-v1", fixtureFactVersion: "facts-v1", fixtureQuestionVersion: "questions-v1", createdAt: stamp, createdBy: actorId };
    await tx.insert(workspaces).values({ id: workspaceId, name: "合成演练所属工作区" }).onConflictDoNothing();
    await tx.insert(projects).values({ id: projectId, workspaceId, name: project.name, version: 1, snapshot: project, createdAt: now, updatedAt: now });
    await tx.insert(projectVersions).values({ projectId, workspaceId, version: 1, snapshot: project, createdAt: now });
    await tx.insert(questionSets).values({ projectId, workspaceId, revision: 2, snapshot: current, updatedAt: now });
    await tx.insert(questionSetVersions).values({ projectId, workspaceId, version: 1, snapshot: version, confirmedAt: now });
    await tx.insert(fixtureSeeds).values({ projectId, workspaceId, manifestId: "geo-r2-v1", snapshot });
    return snapshot;
  });
  await ensureFixturePageSelection(workspaceId, seed.projectId);
  return seed;
}
