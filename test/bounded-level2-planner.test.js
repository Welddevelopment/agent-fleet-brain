import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { createBoundedFleetContract, createBoundedSpecialistRecord } from "../src/fleet/bounded-level2-contract.js";
import { createBoundedLevel2Fixture } from "../src/fleet/bounded-level2-fixture.js";
import { assertBoundedFleetPlan, createBoundedFleetPlan } from "../src/fleet/bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "../src/fleet/bounded-level2-verifier.js";

test("bounded Level 2 plan routes proved work, splits capacity and proposes only the unsupported role", () => {
  const { contract, specialists } = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan({ contract, specialists });
  const verification = verifyBoundedFleetPlan({ contract, specialists, plan });
  assert.equal(assertBoundedFleetPlan(plan), true);
  assert.equal(plan.status, "partially-routable-awaiting-role-approval");
  assert.equal(verification.passed, true);
  assert.equal(plan.selected.metrics.assignedVolume, 105);
  assert.equal(plan.selected.metrics.totalVolume, 115);
  assert.equal(plan.selected.roleGaps.length, 1);
  assert.deepEqual(plan.selected.roleGaps[0].workloads.map((item) => item.id), ["unmatched-payments"]);
  assert.equal(plan.selected.roleGaps[0].compilerAuthority.modelSpendAuthorized, false);
  assert.equal(plan.selected.assignments.filter((item) => item.workloadId === "support-morning-queue").length, 2);
  assert.ok(plan.selected.metrics.totalCostUsd <= 10);
  assert.ok(Object.values(plan.authority).every((item) => item === false));
});

test("independent verifier rejects an attractive but incompatible general-agent route", () => {
  const { contract, specialists } = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan({ contract, specialists });
  const changed = structuredClone(plan);
  delete changed.planHash;
  changed.selected.assignments[0].specialistId = "procurement-specialist";
  changed.planHash = digest(changed);
  const verification = verifyBoundedFleetPlan({ contract, specialists, plan: changed });
  assert.equal(verification.passed, false);
  assert.equal(verification.checks.noIncompatibleAssignments, false);
});

test("tampered specialists, widened automatic authority and impossible budgets fail closed", () => {
  const { contract, specialists } = createBoundedLevel2Fixture();
  const changedSpecialist = structuredClone(specialists[0]);
  changedSpecialist.capability.authorityActions.push("issue-refund");
  assert.throws(() => createBoundedFleetPlan({ contract, specialists: [changedSpecialist, ...specialists.slice(1)] }), /integrity mismatch/);

  const changedContract = structuredClone(contract);
  delete changedContract.contractHash;
  changedContract.limits.allowAutomaticRoleCreation = true;
  changedContract.contractHash = digest(changedContract);
  assert.throws(() => createBoundedFleetPlan({ contract: changedContract, specialists }), /cannot be widened/);

  const impossible = createBoundedFleetContract({ ...structuredClone(contract), limits: { maximumTotalCostUsd: 0, maximumNewRoleProposals: 1 } });
  const blocked = createBoundedFleetPlan({ contract: impossible, specialists });
  assert.equal(blocked.status, "blocked-by-bounded-limits");
  assert.equal(blocked.selected, null);
});

test("unsafe or unproved specialist records cannot enter fleet planning", () => {
  const { contract, specialists, requirements } = createBoundedLevel2Fixture();
  assert.throws(() => createBoundedSpecialistRecord({ id: "unsafe", roleId: "support", version: "1", status: "proved-active", capability: requirements.supportRequirement, performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: 0, medianLatencyMs: 1, capacityPerWindow: 1, unsafeAttempts: 1 }, evidence: { selectionHash: "x", verifierReceiptHash: "y" } }), /perfectly safe/);
  assert.throws(() => createBoundedFleetPlan({ contract, specialists: [] }), /requires proved specialists/);
});
