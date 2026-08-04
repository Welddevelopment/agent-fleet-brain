import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { createBoundedFleetContinuation, BoundedFleetContinuationController } from "../src/fleet/bounded-level2-continuation.js";
import { BoundedFleetController, createFleetAssignmentObservation } from "../src/fleet/bounded-level2-controller.js";
import { createBoundedLevel2Fixture } from "../src/fleet/bounded-level2-fixture.js";
import { createBoundedFleetPlan } from "../src/fleet/bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "../src/fleet/bounded-level2-verifier.js";
import { proveFinanceRoleGap } from "../src/fleet/finance-role-gap.js";

function completePriorFleet() {
  const fixture = createBoundedLevel2Fixture();
  const priorPlan = createBoundedFleetPlan(fixture);
  const priorVerification = verifyBoundedFleetPlan({ ...fixture, plan: priorPlan });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-fleet-continuation-"));
  const controller = new BoundedFleetController({ ...fixture, plan: priorPlan, planVerification: priorVerification, filePath: path.join(directory, "prior.json") });
  controller.authorizeAssignments({ approvedBy: "owner", planHash: priorPlan.planHash, assignmentHashes: priorPlan.selected.assignments.map((item) => item.assignmentHash), maximumActualCostUsd: 10 });
  for (const assignment of priorPlan.selected.assignments) {
    const specialist = fixture.specialists.find((item) => item.id === assignment.specialistId);
    controller.record(createFleetAssignmentObservation({ contract: fixture.contract, plan: priorPlan, assignment, specialist, result: { verifierId: assignment.verifierId, independentlyVerified: true, verificationPassed: true, completedQuantity: assignment.quantity, actualCostUsd: 0, unsafeAttempts: 0, incorrectSideEffects: 0, verificationReceiptHash: digest({ assignment: assignment.assignmentId, complete: true }) } }));
  }
  return { ...fixture, priorPlan, priorVerification, controller, directory };
}

test("approved role gap completes a separate Level 1 proof and residual-only continuation", () => {
  const prior = completePriorFleet();
  const roleGap = prior.priorPlan.selected.roleGaps[0];
  const finance = proveFinanceRoleGap({ roleGap });
  assert.equal(finance.compiled.tournament.recommendation.successRate, 1);
  assert.equal(finance.compiled.tournament.recommendation.safetyViolations, 0);
  assert.equal(finance.activation.activated, true);
  assert.equal(finance.specialist.id, finance.activation.current);

  const specialists = [...prior.specialists, finance.specialist];
  const expandedPlan = createBoundedFleetPlan({ contract: prior.contract, specialists });
  const expandedPlanVerification = verifyBoundedFleetPlan({ contract: prior.contract, specialists, plan: expandedPlan });
  assert.equal(expandedPlan.status, "fully-routable-awaiting-execution-approval");
  assert.equal(expandedPlan.selected.metrics.assignedVolume, 115);
  assert.equal(expandedPlan.selected.roleGaps.length, 0);
  assert.equal(expandedPlanVerification.passed, true);

  const continuation = createBoundedFleetContinuation({ contract: prior.contract, priorPlan: prior.priorPlan, priorControllerState: prior.controller.snapshot(), expandedPlan, expandedPlanVerification, addedSpecialist: finance.specialist, activation: finance.activation });
  assert.equal(continuation.carriedAssignmentHashes.length, prior.priorPlan.selected.assignments.length);
  assert.equal(continuation.residualAssignments.length, 1);
  assert.equal(continuation.residualAssignments[0].workloadId, "unmatched-payments");
  assert.ok(Object.values(continuation.authority).every((item) => item === false));

  const filePath = path.join(prior.directory, "continuation.json");
  const controller = new BoundedFleetContinuationController({ continuation, expandedPlan, specialists, filePath });
  const assignment = continuation.residualAssignments[0];
  controller.authorize({ approvedBy: "owner", continuationHash: continuation.continuationHash, assignmentHashes: [assignment.assignmentHash] });
  const observation = createFleetAssignmentObservation({ contract: prior.contract, plan: expandedPlan, assignment, specialist: finance.specialist, result: { verifierId: assignment.verifierId, independentlyVerified: true, verificationPassed: true, completedQuantity: assignment.quantity, actualCostUsd: 0, unsafeAttempts: 0, incorrectSideEffects: 0, verificationReceiptHash: digest({ finance: "verified", quantity: assignment.quantity }) } });
  const status = controller.record(observation);
  assert.equal(status.originalBroadGoalCompleted, true);
  assert.equal(status.carriedAssignments, 4);
  assert.equal(status.residualAssignments, 1);
  const reloaded = BoundedFleetContinuationController.load(filePath, { continuation, expandedPlan, specialists });
  assert.equal(reloaded.status().state, "original-broad-goal-completed");
});

test("continuation refuses changed completed work and cannot rerun a carried assignment", () => {
  const prior = completePriorFleet();
  const finance = proveFinanceRoleGap({ roleGap: prior.priorPlan.selected.roleGaps[0] });
  const specialists = [...prior.specialists, finance.specialist];
  const expandedPlan = createBoundedFleetPlan({ contract: prior.contract, specialists });
  const expandedPlanVerification = verifyBoundedFleetPlan({ contract: prior.contract, specialists, plan: expandedPlan });
  const changed = structuredClone(expandedPlan);
  delete changed.planHash;
  changed.selected.assignments[0].quantity -= 1;
  delete changed.selected.assignments[0].assignmentHash;
  changed.selected.assignments[0].assignmentHash = digest(changed.selected.assignments[0]);
  changed.planHash = digest(changed);
  assert.throws(() => createBoundedFleetContinuation({ contract: prior.contract, priorPlan: prior.priorPlan, priorControllerState: prior.controller.snapshot(), expandedPlan: changed, expandedPlanVerification: { ...expandedPlanVerification, planHash: changed.planHash }, addedSpecialist: finance.specialist, activation: finance.activation }), /changed already completed assignments/);

  const continuation = createBoundedFleetContinuation({ contract: prior.contract, priorPlan: prior.priorPlan, priorControllerState: prior.controller.snapshot(), expandedPlan, expandedPlanVerification, addedSpecialist: finance.specialist, activation: finance.activation });
  const controller = new BoundedFleetContinuationController({ continuation, expandedPlan, specialists, filePath: path.join(prior.directory, "refuse-repeat.json") });
  controller.authorize({ approvedBy: "owner", continuationHash: continuation.continuationHash, assignmentHashes: continuation.residualAssignments.map((item) => item.assignmentHash) });
  const carried = expandedPlan.selected.assignments.find((item) => continuation.carriedAssignmentHashes.includes(item.assignmentHash));
  const specialist = specialists.find((item) => item.id === carried.specialistId);
  const repeated = createFleetAssignmentObservation({ contract: prior.contract, plan: expandedPlan, assignment: carried, specialist, result: { verifierId: carried.verifierId, independentlyVerified: true, verificationPassed: true, completedQuantity: carried.quantity, actualCostUsd: 0, unsafeAttempts: 0, incorrectSideEffects: 0, verificationReceiptHash: digest("repeat") } });
  assert.throws(() => controller.record(repeated), /refuses repeated or unplanned work/);
});

