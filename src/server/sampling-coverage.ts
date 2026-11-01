import type { SamplingRun } from "@/lib/sampling-contracts";

// importedCount is persisted from sampling_run_evidence. Evidence keeps the
// first importing runId, so filtering by that ID loses shared/duplicate imports.
export function samplingPlanShortfalls(runs: Pick<SamplingRun, "id" | "plannedCount" | "importedCount" | "status">[]) {
  return runs.flatMap((run) => {
    const missing = Math.max(0, run.plannedCount - run.importedCount);
    return missing ? [{ runId: run.id, planned: run.plannedCount, observed: run.importedCount, missing, status: run.status }] : [];
  });
}
