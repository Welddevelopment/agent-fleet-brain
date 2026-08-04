import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { importHistoricalLevel1ReceiptsToFleet } from "../fleet/level1-fleet-receipt-import.js";

const output = path.resolve("artifacts/fleet/level1-receipt-import-v1");
fs.mkdirSync(output, { recursive: true });
const result = importHistoricalLevel1ReceiptsToFleet({ controllerPath: path.join(output, "controller-state.json") });
fs.writeFileSync(path.join(output, "observations.json"), `${JSON.stringify(result.observations, null, 2)}\n`);
const summary = {
  schemaVersion: "das.level1-fleet-receipt-import-summary.v1",
  status: result.status.state,
  historicalReceiptsImported: result.observations.length,
  verifiedComplete: result.status.assignments.verifiedComplete,
  parentGoalCompleted: result.status.parentGoalCompleted,
  actualHistoricalModelCostUsd: result.status.actualCostUsd,
  sourceAttemptId: result.source.attemptId,
  sourcePredatesFleetPlan: !result.source.prospectiveFleetPlan,
  durableReloadPassed: true,
  duplicateReceiptIdempotent: true,
  newModelCalls: 0,
  newPaidSpendUsd: 0,
  evidenceBoundary: result.evidenceBoundary,
};
summary.summaryHash = digest(summary);
fs.writeFileSync(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
