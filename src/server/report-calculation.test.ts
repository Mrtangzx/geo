import assert from "node:assert/strict";
import test from "node:test";
import type { ModificationTask, TaskRelease, TaskVerification } from "@/lib/task-contracts";
import { effectiveVerification } from "./report-calculation";

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
