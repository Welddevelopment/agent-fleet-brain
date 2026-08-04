import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { BoundedFleetController, createFleetAssignmentObservation } from "../src/fleet/bounded-level2-controller.js";
import { createBoundedLevel2Fixture } from "../src/fleet/bounded-level2-fixture.js";
import { createBoundedFleetPlan } from "../src/fleet/bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "../src/fleet/bounded-level2-verifier.js";

function setup() {
  const { contract, specialists } = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan({ contract, specialists });
  const planVerification = verifyBoundedFleetPlan({ contract, specialists, plan });
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-fleet-controller-")), "state.json");
  const options = { contract, specialists, plan, planVerification, filePath, now: () => "2026-08-05T12:00:00.000Z" };
  return { ...options, controller: new BoundedFleetController(options) };
}

function observation({ contract, plan, specialists, assignment, overrides = {} }) {
  const specialist = specialists.find((item) => item.id === assignment.specialistId);
  return createFleetAssignmentObservation({
    contract, plan, assignment, specialist,
    result: {
      verifierId: assignment.verifierId,
      independentlyVerified: true,
      verificationPassed: true,
      completedQuantity: assignment.quantity,
      actualCostUsd: assignment.estimatedCostUsd,
      unsafeAttempts: 0,
      incorrectSideEffects: 0,
      verificationReceiptHash: digest({ assignmentId: assignment.assignmentId, externalState: "verified" }),
      evidenceBoundary: "Test-only independently verified fictional assignment.",
      ...overrides,
    },
  });
}

test("durable fleet controller needs exact approval and cannot complete the parent while a role gap remains", () => {
  const fixture = setup();
  const hashes = fixture.plan.selected.assignments.map((item) => item.assignmentHash);
  assert.throws(() => fixture.controller.authorizeAssignments({ approvedBy: "owner", planHash: "wrong", assignmentHashes: hashes, maximumActualCostUsd: 10 }), /exact plan hash/);
  fixture.controller.authorizeAssignments({ approvedBy: "accountable-owner", planHash: fixture.plan.planHash, assignmentHashes: hashes, maximumActualCostUsd: 10 });
  for (const assignment of fixture.plan.selected.assignments) fixture.controller.record(observation({ ...fixture, assignment }));
  const status = fixture.controller.status();
  assert.equal(status.state, "routable-work-completed-role-gap-blocked");
  assert.equal(status.assignments.verifiedComplete, status.assignments.total);
  assert.equal(status.parentGoalCompleted, false);
  assert.equal(status.roleGaps, 1);

  const gap = fixture.plan.selected.roleGaps[0];
  const preparation = fixture.controller.prepareRoleGap({ requestHash: gap.requestHash, approvedBy: "accountable-owner" });
  assert.equal(preparation.status, "approved-to-prepare-level1-contract");
  assert.ok(Object.values(preparation.authority).every((item) => item === false));

  const reloaded = BoundedFleetController.load(fixture.filePath, fixture);
  assert.equal(reloaded.status().state, "routable-work-completed-role-gap-blocked");
  const first = observation({ ...fixture, assignment: fixture.plan.selected.assignments[0] });
  assert.equal(reloaded.record(first).assignments.verifiedComplete, status.assignments.total);
});

test("one unsafe independently observed assignment halts the fleet before parent completion", () => {
  const fixture = setup();
  const hashes = fixture.plan.selected.assignments.map((item) => item.assignmentHash);
  fixture.controller.authorizeAssignments({ approvedBy: "owner", planHash: fixture.plan.planHash, assignmentHashes: hashes, maximumActualCostUsd: 10 });
  const first = fixture.plan.selected.assignments[0];
  fixture.controller.record(observation({ ...fixture, assignment: first, overrides: { verificationPassed: false, completedQuantity: 0, unsafeAttempts: 1 } }));
  const status = fixture.controller.status();
  assert.equal(status.state, "halted");
  assert.equal(status.parentGoalCompleted, false);
  assert.equal(status.halt.reason, "unsafe-attempt");
  assert.throws(() => fixture.controller.record(observation({ ...fixture, assignment: fixture.plan.selected.assignments[1] })), /not authorized/);
});

test("fleet controller rejects changed identities, conflicting duplicates and mutated durable state", () => {
  const fixture = setup();
  const hashes = fixture.plan.selected.assignments.map((item) => item.assignmentHash);
  fixture.controller.authorizeAssignments({ approvedBy: "owner", planHash: fixture.plan.planHash, assignmentHashes: hashes, maximumActualCostUsd: 10 });
  const first = fixture.plan.selected.assignments[0];
  const valid = observation({ ...fixture, assignment: first });
  fixture.controller.record(valid);
  const conflicting = observation({ ...fixture, assignment: first, overrides: { actualCostUsd: first.estimatedCostUsd / 2 } });
  assert.throws(() => fixture.controller.record(conflicting), /Conflicting duplicate/);

  const state = JSON.parse(fs.readFileSync(fixture.filePath, "utf8"));
  state.status = "broad-goal-completed";
  fs.writeFileSync(fixture.filePath, JSON.stringify(state));
  assert.throws(() => BoundedFleetController.load(fixture.filePath, fixture), /integrity mismatch/);
});

