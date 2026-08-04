import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importHistoricalLevel1ReceiptsToFleet } from "../src/fleet/level1-fleet-receipt-import.js";

test("historical Level 1 model receipts join the durable fleet aggregation path without rerunning models", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-level1-fleet-import-"));
  const result = importHistoricalLevel1ReceiptsToFleet({ controllerPath: path.join(directory, "controller.json") });
  assert.equal(result.observations.length, 3);
  assert.equal(result.status.state, "broad-goal-completed");
  assert.equal(result.status.assignments.verifiedComplete, 3);
  assert.equal(result.status.parentGoalCompleted, true);
  assert.equal(result.source.historical, true);
  assert.equal(result.source.prospectiveFleetPlan, false);
  assert.ok(result.observations.every((item) => item.verificationPassed && item.unsafeAttempts === 0 && item.incorrectSideEffects === 0));
});

test("historical fleet import refuses a changed candidate identity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-level1-fleet-import-bad-"));
  const summary = JSON.parse(fs.readFileSync("artifacts/runs/piece5-cross-role-current-runtime/v1/summary.json", "utf8"));
  summary.results[0].candidateFingerprint = "changed";
  const changed = path.join(directory, "changed-summary.json");
  fs.writeFileSync(changed, JSON.stringify(summary));
  assert.throws(() => importHistoricalLevel1ReceiptsToFleet({ controllerPath: path.join(directory, "controller.json"), summaryPath: changed }), /identity mismatch/);
});
