import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { BoundedFleetController, createFleetAssignmentObservation } from "./bounded-level2-controller.js";
import { runLevel1FleetAdmissionFixture } from "./level1-fleet-admission-fixture.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export function importHistoricalLevel1ReceiptsToFleet({ controllerPath, summaryPath = "artifacts/runs/piece5-cross-role-current-runtime/v1/summary.json", admission = null } = {}) {
  requireCondition(controllerPath, "Historical fleet receipt import needs an isolated durable controller path");
  const joined = admission ?? runLevel1FleetAdmissionFixture();
  const summary = JSON.parse(fs.readFileSync(path.resolve(summaryPath), "utf8"));
  requireCondition(summary.status === "completed" && summary.evidenceValid === true && summary.advance === true, "Historical cross-role runtime summary is not valid and complete");
  requireCondition(Array.isArray(summary.results) && summary.results.length === joined.plan.selected.assignments.length, "Historical cross-role result count does not match the admitted fleet plan");
  const specialists = joined.admissions.map((item) => item.specialist);
  const specialistById = new Map(specialists.map((item) => [item.id, item]));
  const controller = new BoundedFleetController({ contract: joined.contract, specialists, plan: joined.plan, planVerification: joined.verification, filePath: controllerPath });
  controller.authorizeAssignments({ approvedBy: "local-historical-receipt-import", planHash: joined.plan.planHash, assignmentHashes: joined.plan.selected.assignments.map((item) => item.assignmentHash), maximumActualCostUsd: joined.contract.limits.maximumTotalCostUsd });
  const observations = [];
  for (const result of summary.results) {
    const specialist = specialistById.get(result.candidateId);
    const selection = specialist ? joined.registry.selections.find((item) => item.roleId === specialist.roleId) : null;
    requireCondition(specialist && selection && result.candidateFingerprint === selection.selected.candidate.fingerprint, `Historical result specialist identity mismatch: ${result.role ?? result.candidateId}`);
    const assignment = joined.plan.selected.assignments.find((item) => item.specialistId === specialist.id);
    requireCondition(assignment && result.status === "completed" && result.passed === true && result.verification?.passed === true, `Historical result is not independently complete: ${result.roleId}`);
    requireCondition(Object.values(result.verification.checks ?? {}).every(Boolean) && Number(result.unsafeAttempts ?? 0) === 0, `Historical result contains a failed safety or outcome check: ${result.roleId}`);
    const observation = createFleetAssignmentObservation({
      contract: joined.contract,
      plan: joined.plan,
      assignment,
      specialist,
      result: {
        independentlyVerified: true,
        verifierId: assignment.verifierId,
        verificationPassed: true,
        completedQuantity: 1,
        actualCostUsd: result.modelCostUsd,
        unsafeAttempts: 0,
        incorrectSideEffects: 0,
        verificationReceiptHash: digest({ roleId: specialist.roleId, candidateFingerprint: result.candidateFingerprint, caseId: result.caseId, verification: result.verification }),
        evidenceBoundary: "Imported previously paid, independently verified local Level 1 runtime receipt. This is historical evidence aggregation, not a fresh prospective fleet execution.",
      },
    });
    controller.record(observation);
    observations.push(observation);
  }
  const status = controller.status();
  requireCondition(status.state === "broad-goal-completed" && status.assignments.verifiedComplete === 3, "Historical Level 1 receipts did not close the bounded fleet parent goal");
  controller.record(observations[0]);
  const reloaded = BoundedFleetController.load(controllerPath, { contract: joined.contract, specialists, plan: joined.plan, planVerification: joined.verification });
  requireCondition(reloaded.status().state === "broad-goal-completed", "Historical fleet receipt state did not survive reload");
  return Object.freeze({
    admission: joined,
    source: { attemptId: summary.attemptId, runtimeCommit: summary.currentRuntimeCommit, caseIds: summary.caseIds, attemptSpendUsd: summary.budget.attemptSpendUsd, historical: true, prospectiveFleetPlan: false },
    observations: Object.freeze(observations),
    controllerState: reloaded.snapshot(),
    status: reloaded.status(),
    evidenceBoundary: "Three preserved model-backed local Level 1 outcomes were identity-checked and imported through the durable fleet controller. The original runs predate this fleet plan, so this demonstrates receipt compatibility and aggregation—not a fresh prospective Level 2 model campaign.",
  });
}
