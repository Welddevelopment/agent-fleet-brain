import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { createBoundedLevel2Fixture } from "../src/fleet/bounded-level2-fixture.js";
import { createBoundedFleetPlan } from "../src/fleet/bounded-level2-planner.js";
import { createFleetAssignmentObservation } from "../src/fleet/bounded-level2-controller.js";
import {
  assertAggregateVerification,
  createAssignmentEffectDeclaration,
  createSharedInvariant,
  verifyAggregateOutcome,
} from "../src/fleet/aggregate-verifier.js";

function greenObservations() {
  const fixture = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan(fixture);
  return plan.selected.assignments.slice(0, 2).map((assignment) => {
    const specialist = fixture.specialists.find((item) => item.id === assignment.specialistId);
    return createFleetAssignmentObservation({
      contract: fixture.contract,
      plan,
      assignment,
      specialist,
      result: { verifierId: assignment.verifierId, independentlyVerified: true, verificationPassed: true, completedQuantity: assignment.quantity, actualCostUsd: 0.5, unsafeAttempts: 0, incorrectSideEffects: 0, verificationReceiptHash: digest({ receipt: assignment.assignmentId }) },
    });
  });
}

test("every assignment green, combined effects wrong: only the aggregate check catches the duplicate credit", () => {
  const observations = greenObservations();
  // Each assignment independently and correctly credits the account once. Its own
  // verifier passed. In combination the account was credited twice.
  const declarations = observations.map((observation) =>
    createAssignmentEffectDeclaration({ observation, effects: [{ kind: "account-credit", target: "customer-account-7", amountUsd: 25 }] }));
  const invariant = createSharedInvariant({ id: "one-credit-per-account", kind: "at-most-once-per-target", effectKind: "account-credit", description: "No account is credited twice across the whole fleet" });
  const receipt = verifyAggregateOutcome({ invariants: [invariant], observations, effectDeclarations: declarations });
  assert.equal(assertAggregateVerification(receipt), true);
  assert.equal(receipt.individuallyGreenObservations, true);
  assert.equal(receipt.status, "combined-effects-violation");
  const result = receipt.results.find((item) => item.invariantId === "one-credit-per-account");
  assert.equal(result.passed, false);
  assert.equal(result.violations[0].target, "customer-account-7");
  assert.equal(result.violations[0].assignments.length, 2);
});

test("a budget envelope breached only in sum is caught in aggregate", () => {
  const observations = greenObservations();
  const declarations = observations.map((observation, index) =>
    createAssignmentEffectDeclaration({ observation, effects: [{ kind: "spend", target: `supplier-${index}`, amountUsd: 6 }] }));
  const invariant = createSharedInvariant({ id: "spend-envelope", kind: "aggregate-budget-envelope", maximumTotalUsd: 10, description: "Combined external spend stays under $10" });
  const receipt = verifyAggregateOutcome({ invariants: [invariant], observations, effectDeclarations: declarations });
  assert.equal(receipt.status, "combined-effects-violation");
  const result = receipt.results.find((item) => item.invariantId === "spend-envelope");
  assert.equal(result.totalUsd, 12);
  assert.equal(result.violations[0].exceededByUsd, 2);
});

test("clean combined effects pass with a sealed receipt", () => {
  const observations = greenObservations();
  const declarations = observations.map((observation, index) =>
    createAssignmentEffectDeclaration({ observation, effects: [{ kind: "account-credit", target: `customer-account-${index}`, amountUsd: 5 }] }));
  const invariants = [
    createSharedInvariant({ id: "one-credit-per-account", kind: "at-most-once-per-target", effectKind: "account-credit", description: "x" }),
    createSharedInvariant({ id: "spend-envelope", kind: "aggregate-budget-envelope", maximumTotalUsd: 100, description: "x" }),
  ];
  const receipt = verifyAggregateOutcome({ invariants, observations, effectDeclarations: declarations });
  assert.equal(receipt.status, "aggregate-invariants-hold");
  assert.ok(receipt.results.every((item) => item.passed));
});

test("a tampered effect declaration and an unbound declaration are both refused", () => {
  const observations = greenObservations();
  const declarations = observations.map((observation) =>
    createAssignmentEffectDeclaration({ observation, effects: [{ kind: "account-credit", target: "a", amountUsd: 1 }] }));
  const invariant = createSharedInvariant({ id: "i", kind: "at-most-once-per-target", effectKind: "account-credit", description: "x" });

  const tampered = structuredClone(declarations[0]);
  tampered.effects[0].amountUsd = 9_999;
  assert.throws(
    () => verifyAggregateOutcome({ invariants: [invariant], observations, effectDeclarations: [tampered, declarations[1]] }),
    /integrity mismatch/,
  );

  const unbound = structuredClone(declarations[0]);
  unbound.observationHash = digest({ other: "observation" });
  delete unbound.declarationHash;
  unbound.declarationHash = digest(unbound);
  assert.throws(
    () => verifyAggregateOutcome({ invariants: [invariant], observations, effectDeclarations: [unbound, declarations[1]] }),
    /not bound to a recorded observation/,
  );
});
