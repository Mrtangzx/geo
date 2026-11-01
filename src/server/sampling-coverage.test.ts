import assert from "node:assert/strict";
import test from "node:test";
import { samplingPlanShortfalls } from "./sampling-coverage";

test("a duplicate import linked to the original evidence is not a missing sample", () => {
  // Reproduced with the 15 eligible edge inputs: E14 reuses B-01-01, so only
  // fourteen evidence rows have the edge run as their original runId.
  const evidenceOwnedByEdgeRun = 14;
  const evidenceLinkedToEdgeRun = evidenceOwnedByEdgeRun + 1;
  assert.deepEqual(samplingPlanShortfalls([
    { id: "baseline", status: "completed", plannedCount: 30, importedCount: 30 },
    { id: "edge-with-shared-B-01-01", status: "partial", plannedCount: 15, importedCount: evidenceLinkedToEdgeRun },
  ]), []);
});

test("failed or pending plans without returned evidence remain explicit shortfalls", () => {
  assert.deepEqual(samplingPlanShortfalls([
    { id: "reused", status: "completed", plannedCount: 3, importedCount: 3 },
    { id: "uncertain", status: "needs_reconciliation", plannedCount: 3, importedCount: 0 },
    { id: "partial", status: "partial", plannedCount: 30, importedCount: 20 },
  ]), [
    { runId: "uncertain", status: "needs_reconciliation", planned: 3, observed: 0, missing: 3 },
    { runId: "partial", status: "partial", planned: 30, observed: 20, missing: 10 },
  ]);
});
