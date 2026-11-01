import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { budgetAccounts, budgetReservations } from "@/db/sampling-schema";
import type { BudgetAccount, BudgetKind, BudgetReservation, BudgetReservationInput, Currency } from "@/lib/sampling-contracts";
import { AppError } from "./errors";
import { getProject } from "./projects";

function validMinor(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) throw new AppError(400, "INVALID_MONEY", "金额应为不小于零的整数分，且在支持范围内。");
}
function accountWhere(workspaceId: string, kind: BudgetKind, currency: Currency) {
  return and(eq(budgetAccounts.workspaceId, workspaceId), eq(budgetAccounts.kind, kind), eq(budgetAccounts.currency, currency));
}

export async function listBudgets(workspaceId: string): Promise<BudgetAccount[]> {
  const rows = await getDatabase().select().from(budgetAccounts).where(eq(budgetAccounts.workspaceId, workspaceId));
  return (["real", "simulation"] as const).flatMap((kind) => (["CNY", "USD"] as const).map((currency) => {
    const row = rows.find((item) => item.kind === kind && item.currency === currency);
    return { workspaceId, kind, currency, limitMinor: row?.limitMinor ?? 0, reservedMinor: row?.reservedMinor ?? 0,
      spentMinor: row?.spentMinor ?? 0, availableMinor: row ? row.limitMinor - row.reservedMinor - row.spentMinor : 0,
      version: row?.version ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null };
  }));
}

export async function configureBudget(workspaceId: string, kind: BudgetKind, currency: Currency, limitMinor: number, expectedVersion: number): Promise<BudgetAccount[]> {
  validMinor(limitMinor);
  await getDatabase().transaction(async (tx) => {
    const [old] = await tx.select().from(budgetAccounts).where(accountWhere(workspaceId, kind, currency)).for("update");
    if ((old?.version ?? 0) !== expectedVersion) throw new AppError(409, "BUDGET_VERSION_CONFLICT", "预算已被更新，请读取最新账本后再保存。");
    if (old && limitMinor < old.spentMinor + old.reservedMinor) throw new AppError(409, "BUDGET_COMMITTED", "预算不能低于已结算和仍预留的合计金额。");
    if (!old) {
      const created = await tx.insert(budgetAccounts).values({ workspaceId, kind, currency, limitMinor }).onConflictDoNothing().returning();
      if (!created.length) throw new AppError(409, "BUDGET_VERSION_CONFLICT", "预算已被更新，请重新读取。");
    } else await tx.update(budgetAccounts).set({ limitMinor, version: old.version + 1, updatedAt: new Date() }).where(accountWhere(workspaceId, kind, currency));
  });
  return listBudgets(workspaceId);
}

export async function reserveBudget(input: BudgetReservationInput): Promise<BudgetReservation> {
  validMinor(input.upperBoundMinor);
  await getProject(input.workspaceId, input.projectId);
  return getDatabase().transaction(async (tx) => {
    await tx.insert(budgetAccounts).values({ workspaceId: input.workspaceId, kind: input.kind, currency: input.currency }).onConflictDoNothing();
    const [account] = await tx.select().from(budgetAccounts).where(accountWhere(input.workspaceId, input.kind, input.currency)).for("update");
    const [prior] = await tx.select().from(budgetReservations).where(and(eq(budgetReservations.workspaceId, input.workspaceId), eq(budgetReservations.executionKey, input.executionKey)));
    if (prior) {
      const snapshot = prior.snapshot;
      if (snapshot.projectId !== input.projectId || snapshot.action !== input.action || snapshot.kind !== input.kind || snapshot.currency !== input.currency || snapshot.upperBoundMinor !== input.upperBoundMinor) throw new AppError(409, "RESERVATION_KEY_CONFLICT", "同一执行标识不能改变预算归属或费用上限。");
      return snapshot;
    }
    if (account.limitMinor - account.reservedMinor - account.spentMinor < input.upperBoundMinor) throw new AppError(409, "BUDGET_INSUFFICIENT", "预算不足，尚未发起付费动作；请核对预计、预留与已结算金额。");
    const now = new Date();
    const snapshot: BudgetReservation = { ...input, id: randomUUID(), actualMinor: null, status: "reserved", reason: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await tx.update(budgetAccounts).set({ reservedMinor: account.reservedMinor + input.upperBoundMinor, version: account.version + 1, updatedAt: now }).where(accountWhere(input.workspaceId, input.kind, input.currency));
    await tx.insert(budgetReservations).values({ id: snapshot.id, workspaceId: input.workspaceId, projectId: input.projectId, executionKey: input.executionKey, snapshot, updatedAt: now });
    return snapshot;
  });
}

export async function getReservation(workspaceId: string, id: string): Promise<BudgetReservation> {
  const [row] = await getDatabase().select({ snapshot: budgetReservations.snapshot }).from(budgetReservations).where(and(eq(budgetReservations.id, id), eq(budgetReservations.workspaceId, workspaceId)));
  if (!row) throw new AppError(404, "RESERVATION_NOT_FOUND", "未找到该费用预留。");
  return row.snapshot;
}

export async function listReservations(workspaceId: string, projectId: string): Promise<BudgetReservation[]> {
  await getProject(workspaceId, projectId);
  return (await getDatabase().select({ snapshot: budgetReservations.snapshot }).from(budgetReservations).where(and(eq(budgetReservations.workspaceId, workspaceId), eq(budgetReservations.projectId, projectId))).orderBy(desc(budgetReservations.updatedAt)).limit(200)).map((row) => row.snapshot);
}

export async function markBudgetUnknown(workspaceId: string, id: string, reason: string): Promise<BudgetReservation> {
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx.select().from(budgetReservations).where(and(eq(budgetReservations.id, id), eq(budgetReservations.workspaceId, workspaceId))).for("update");
    if (!row) throw new AppError(404, "RESERVATION_NOT_FOUND", "未找到该费用预留。");
    if (["settled", "released"].includes(row.snapshot.status)) return row.snapshot;
    const now = new Date();
    const snapshot: BudgetReservation = { ...row.snapshot, status: "needs_reconciliation", reason, updatedAt: now.toISOString() };
    await tx.update(budgetReservations).set({ snapshot, updatedAt: now }).where(eq(budgetReservations.id, id));
    return snapshot;
  });
}

export async function settleBudget(workspaceId: string, id: string, actualMinor: number, reason: string): Promise<BudgetReservation> {
  validMinor(actualMinor);
  const initial = await getReservation(workspaceId, id);
  return getDatabase().transaction(async (tx) => {
    const [account] = await tx.select().from(budgetAccounts).where(accountWhere(workspaceId, initial.kind, initial.currency)).for("update");
    const [row] = await tx.select().from(budgetReservations).where(and(eq(budgetReservations.id, id), eq(budgetReservations.workspaceId, workspaceId))).for("update");
    const old = row.snapshot;
    if (old.status === "settled") {
      if (old.actualMinor !== actualMinor) throw new AppError(409, "SETTLEMENT_CONFLICT", "费用已结算，不能用不同金额覆盖原账单。");
      return old;
    }
    if (old.status === "released") throw new AppError(409, "RESERVATION_RELEASED", "该预留已释放，请核对独立账单，不重复结算。");
    const now = new Date();
    if (actualMinor > old.upperBoundMinor) {
      const snapshot: BudgetReservation = { ...old, actualMinor, status: "needs_reconciliation", reason: "实际金额超过已配置上限，保留预留并等待核对：" + reason, updatedAt: now.toISOString() };
      await tx.update(budgetReservations).set({ snapshot, updatedAt: now }).where(eq(budgetReservations.id, id));
      return snapshot;
    }
    const snapshot: BudgetReservation = { ...old, actualMinor, status: "settled", reason, updatedAt: now.toISOString() };
    await tx.update(budgetAccounts).set({ reservedMinor: account.reservedMinor - old.upperBoundMinor, spentMinor: account.spentMinor + actualMinor, version: account.version + 1, updatedAt: now }).where(accountWhere(workspaceId, old.kind, old.currency));
    await tx.update(budgetReservations).set({ snapshot, updatedAt: now }).where(eq(budgetReservations.id, id));
    return snapshot;
  });
}

export async function releaseBudget(workspaceId: string, id: string, reason: string): Promise<BudgetReservation> {
  const initial = await getReservation(workspaceId, id);
  return getDatabase().transaction(async (tx) => {
    const [account] = await tx.select().from(budgetAccounts).where(accountWhere(workspaceId, initial.kind, initial.currency)).for("update");
    const [row] = await tx.select().from(budgetReservations).where(and(eq(budgetReservations.id, id), eq(budgetReservations.workspaceId, workspaceId))).for("update");
    if (row.snapshot.status === "released") return row.snapshot;
    if (row.snapshot.status === "settled") throw new AppError(409, "ALREADY_SETTLED", "已结算费用不能作为未受理释放。");
    const now = new Date();
    const snapshot: BudgetReservation = { ...row.snapshot, status: "released", actualMinor: 0, reason, updatedAt: now.toISOString() };
    await tx.update(budgetAccounts).set({ reservedMinor: account.reservedMinor - snapshot.upperBoundMinor, version: account.version + 1, updatedAt: now }).where(accountWhere(workspaceId, snapshot.kind, snapshot.currency));
    await tx.update(budgetReservations).set({ snapshot, updatedAt: now }).where(eq(budgetReservations.id, id));
    return snapshot;
  });
}
