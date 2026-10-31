import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { questionSets, questionSetVersions } from "@/db/question-schema";
import type { BuyerQuestion, QuestionInput, QuestionSet, QuestionSetVersion, SamplingQuestion } from "@/lib/question-contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";
import { confirmableQuestionsSchema } from "./question-validation";

function versionConflict(): never {
  throw new AppError(409, "QUESTION_VERSION_CONFLICT", "问题集已被更新，请重新读取最新草稿后再操作。");
}

function resolveQuestions(questions: QuestionInput[], previous: QuestionSet): BuyerQuestion[] {
  const knownIds = new Set(previous.questions.map((question) => question.id));
  return questions.map((question) => {
    if (question.id && !knownIds.has(question.id)) throw new AppError(400, "QUESTION_NOT_FOUND", "问题标识不属于当前问题集，请重新读取后操作。");
    return { ...question, id: question.id ?? randomUUID(), sourceModel: question.sourceModel?.trim() || null };
  });
}

export async function getQuestionSet(workspaceId: string, projectId: string): Promise<QuestionSet> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select({ snapshot: questionSets.snapshot }).from(questionSets)
    .where(and(eq(questionSets.projectId, projectId), eq(questionSets.workspaceId, workspaceId))).limit(1);
  return row?.snapshot ?? {
    projectId, workspaceId, revision: 0, status: "draft", questions: [], latestConfirmedVersion: null,
    confirmedAt: null, confirmedBy: null, updatedAt: null,
  };
}

export async function listQuestionVersions(workspaceId: string, projectId: string): Promise<QuestionSetVersion[]> {
  await getProject(workspaceId, projectId);
  const rows = await getDatabase().select({ snapshot: questionSetVersions.snapshot }).from(questionSetVersions)
    .where(and(eq(questionSetVersions.projectId, projectId), eq(questionSetVersions.workspaceId, workspaceId)))
    .orderBy(desc(questionSetVersions.version));
  return rows.map((row) => row.snapshot);
}

export async function saveQuestionSet(
  workspaceId: string, projectId: string, expectedVersion: number, questions: QuestionInput[],
): Promise<QuestionSet> {
  const previous = await getQuestionSet(workspaceId, projectId);
  if (previous.revision !== expectedVersion) return versionConflict();
  const now = new Date();
  const next: QuestionSet = {
    ...previous, revision: expectedVersion + 1, status: "draft", questions: resolveQuestions(questions, previous),
    confirmedAt: null, confirmedBy: null, updatedAt: now.toISOString(),
  };
  const db = getDatabase();
  const result = expectedVersion === 0
    ? await db.insert(questionSets).values({ projectId, workspaceId, revision: 1, snapshot: next, updatedAt: now })
      .onConflictDoNothing().returning({ projectId: questionSets.projectId })
    : await db.update(questionSets).set({ revision: next.revision, snapshot: next, updatedAt: now })
      .where(and(eq(questionSets.projectId, projectId), eq(questionSets.workspaceId, workspaceId), eq(questionSets.revision, expectedVersion)))
      .returning({ projectId: questionSets.projectId });
  if (!result.length) return versionConflict();
  return next;
}

export async function confirmQuestionSet(
  workspaceId: string, projectId: string, actorId: string, expectedVersion: number,
): Promise<{ questionSet: QuestionSet; version: QuestionSetVersion }> {
  const previous = await getQuestionSet(workspaceId, projectId);
  if (previous.revision !== expectedVersion) return versionConflict();
  if (previous.status === "confirmed") {
    throw new AppError(409, "QUESTION_SET_ALREADY_CONFIRMED", "当前问题集已经确认，修改后请先保存新草稿。");
  }
  confirmableQuestionsSchema.parse(previous.questions);
  const now = new Date();
  const version: QuestionSetVersion = {
    projectId, workspaceId, version: (previous.latestConfirmedVersion ?? 0) + 1,
    sourceRevision: previous.revision, questions: previous.questions,
    confirmedAt: now.toISOString(), confirmedBy: actorId,
  };
  const questionSet: QuestionSet = {
    ...previous, revision: previous.revision + 1, status: "confirmed", latestConfirmedVersion: version.version,
    confirmedAt: version.confirmedAt, confirmedBy: actorId, updatedAt: version.confirmedAt,
  };
  await getDatabase().transaction(async (tx) => {
    const updated = await tx.update(questionSets).set({ revision: questionSet.revision, snapshot: questionSet, updatedAt: now })
      .where(and(eq(questionSets.projectId, projectId), eq(questionSets.workspaceId, workspaceId), eq(questionSets.revision, expectedVersion)))
      .returning({ projectId: questionSets.projectId });
    if (!updated.length) return versionConflict();
    // Confirmed versions are append-only; later draft editing never updates these rows.
    await tx.insert(questionSetVersions).values({ projectId, workspaceId, version: version.version, snapshot: version, confirmedAt: now });
  });
  return { questionSet, version };
}

export async function getConfirmedSamplingQuestions(
  workspaceId: string, projectId: string, version: number,
): Promise<{ questionSetVersion: QuestionSetVersion; inputs: SamplingQuestion[] }> {
  await getProject(workspaceId, projectId);
  const [row] = await getDatabase().select({ snapshot: questionSetVersions.snapshot }).from(questionSetVersions)
    .where(and(eq(questionSetVersions.projectId, projectId), eq(questionSetVersions.workspaceId, workspaceId), eq(questionSetVersions.version, version))).limit(1);
  if (!row) throw new AppError(404, "CONFIRMED_QUESTION_VERSION_NOT_FOUND", "未找到该已确认问题版本；草稿不能用于正式采样。");
  return {
    questionSetVersion: row.snapshot,
    inputs: row.snapshot.questions.map((question) => ({
      questionId: question.id, questionVersion: version, text: question.text,
      group: question.group, priority: question.priority, isFocus: question.isFocus,
    })),
  };
}
