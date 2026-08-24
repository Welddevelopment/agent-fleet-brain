import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { financeCloseRole } from "dynamic-agent-specialisation/src/roles/finance-close.js";
import { supportRole } from "dynamic-agent-specialisation/src/roles/support.js";
import { createBoundedLevel2Fixture } from "../src/fleet/bounded-level2-fixture.js";
import { BoundedFleetController, createFleetAssignmentObservation } from "../src/fleet/bounded-level2-controller.js";
import { createBoundedFleetPlan } from "../src/fleet/bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "../src/fleet/bounded-level2-verifier.js";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import {
  assertRoleGapConstructionStageReceipt,
  runRoleGapConstructionStage,
} from "../src/fleet/role-gap-construction.js";

const CLOCK = () => "2026-08-24T02:00:00.000Z";

function completedFixtureController(directory) {
  const fixture = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan(fixture);
  const planVerification = verifyBoundedFleetPlan({ ...fixture, plan });
  const controller = new BoundedFleetController({ ...fixture, plan, planVerification, filePath: path.join(directory, "controller.json"), now: CLOCK });
  controller.authorizeAssignments({ approvedBy: "fictional-owner", planHash: plan.planHash, assignmentHashes: plan.selected.assignments.map((item) => item.assignmentHash), maximumActualCostUsd: fixture.contract.limits.maximumTotalCostUsd });
  for (const assignment of plan.selected.assignments) {
    const specialist = fixture.specialists.find((item) => item.id === assignment.specialistId);
    const observation = createFleetAssignmentObservation({
      contract: fixture.contract,
      plan,
      assignment,
      specialist,
      result: { verifierId: assignment.verifierId, independentlyVerified: true, verificationPassed: true, completedQuantity: assignment.quantity, actualCostUsd: 0, unsafeAttempts: 0, incorrectSideEffects: 0, verificationReceiptHash: digest({ test: assignment.assignmentId }) },
    });
    controller.record(observation);
  }
  return { fixture, plan, controller };
}

test("the full controlled stage: prepared finance gap -> DAS construction -> expanded plan, prior work untouched", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-role-gap-stage-"));
  const { fixture, plan, controller } = completedFixtureController(directory);
  assert.equal(controller.status().state, "routable-work-completed-role-gap-blocked");
  const preparation = controller.prepareRoleGap({ requestHash: plan.selected.roleGaps[0].requestHash, approvedBy: "fictional-owner" });

  const stage = runRoleGapConstructionStage({ contract: fixture.contract, specialists: fixture.specialists, priorPlan: plan, preparation, role: financeCloseRole, approvedBy: "fictional-owner", clock: CLOCK });

  assert.equal(assertRoleGapConstructionStageReceipt(stage.receipt), true);
  assert.equal(stage.expandedPlan.status, "fully-routable-awaiting-execution-approval");
  assert.equal(stage.expandedPlan.selected.roleGaps.length, 0);
  const priorHashes = new Set(plan.selected.assignments.map((item) => item.assignmentHash));
  for (const hash of priorHashes) assert.ok(stage.expandedPlan.selected.assignments.some((item) => item.assignmentHash === hash));
  assert.ok(stage.residualAssignments.every((item) => item.workloadId === "unmatched-payments" && item.specialistHash === stage.construction.specialist.specialistHash));
  assert.equal(stage.receipt.modelCalls, 0);
  assert.equal(stage.receipt.paidModelSpendUsd, 0);
  assert.deepEqual(Object.values(stage.receipt.authority), [false, false, false, false]);
  assert.equal(stage.receipt.preparationHash, preparation.preparationHash);
  assert.equal(stage.receipt.gapRequestHash, plan.selected.roleGaps[0].requestHash);
});

test("a role that does not match the gap's verifier and policy is refused before any compilation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-role-gap-mismatch-"));
  const { fixture, plan, controller } = completedFixtureController(directory);
  const preparation = controller.prepareRoleGap({ requestHash: plan.selected.roleGaps[0].requestHash, approvedBy: "fictional-owner" });
  assert.throws(
    () => runRoleGapConstructionStage({ contract: fixture.contract, specialists: fixture.specialists, priorPlan: plan, preparation, role: supportRole, approvedBy: "fictional-owner", clock: CLOCK }),
    /verifier does not match/,
  );
});

test("a tampered preparation receipt is refused", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-role-gap-tampered-"));
  const { fixture, plan, controller } = completedFixtureController(directory);
  const preparation = controller.prepareRoleGap({ requestHash: plan.selected.roleGaps[0].requestHash, approvedBy: "fictional-owner" });
  const tampered = structuredClone(preparation);
  tampered.authority.modelSpendAuthorized = true;
  assert.throws(
    () => runRoleGapConstructionStage({ contract: fixture.contract, specialists: fixture.specialists, priorPlan: plan, preparation: tampered, role: financeCloseRole, approvedBy: "fictional-owner", clock: CLOCK }),
    /integrity mismatch/,
  );
});

test("a preparation for a different plan's gap is refused", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-role-gap-foreign-"));
  const { fixture, plan, controller } = completedFixtureController(directory);
  const preparation = controller.prepareRoleGap({ requestHash: plan.selected.roleGaps[0].requestHash, approvedBy: "fictional-owner" });
  const foreign = structuredClone(preparation);
  foreign.requestHash = digest({ someOther: "gap" });
  delete foreign.preparationHash;
  foreign.preparationHash = digest(foreign);
  assert.throws(
    () => runRoleGapConstructionStage({ contract: fixture.contract, specialists: fixture.specialists, priorPlan: plan, preparation: foreign, role: financeCloseRole, approvedBy: "fictional-owner", clock: CLOCK }),
    /does not match any role gap/,
  );
});

test("the stage requires an accountable owner", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-role-gap-owner-"));
  const { fixture, plan, controller } = completedFixtureController(directory);
  const preparation = controller.prepareRoleGap({ requestHash: plan.selected.roleGaps[0].requestHash, approvedBy: "fictional-owner" });
  assert.throws(
    () => runRoleGapConstructionStage({ contract: fixture.contract, specialists: fixture.specialists, priorPlan: plan, preparation, role: financeCloseRole, approvedBy: "", clock: CLOCK }),
    /accountable owner/,
  );
});
