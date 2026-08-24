import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedLevel2Fixture } from "../src/fleet/bounded-level2-fixture.js";
import { createBoundedFleetPlan } from "../src/fleet/bounded-level2-planner.js";
import {
  amendCompanyConstitution,
  assertCompanyConstitution,
  assertConstitutionUnchanged,
  assertContractWithinConstitution,
  bindConstitutionToExecution,
  contractConstitutionCompatibility,
  createCompanyConstitution,
  planConstitutionCompatibility,
} from "../src/fleet/constitution.js";

function fixtureConstitution(overrides = {}) {
  return createCompanyConstitution({
    companyId: "fictional-multi-department-company",
    riskTolerance: "high",
    qualityFloor: 0.9,
    budgets: { maximumTotalCostUsd: 10, maximumUnitCostUsd: 0.5 },
    latencyCeilingMs: 30_000,
    prohibitedActions: ["delete-customer-data", "transfer-funds"],
    ...overrides,
  });
}

test("a constitution seals its policy and detects any mutation", () => {
  const constitution = fixtureConstitution();
  assert.equal(assertCompanyConstitution(constitution), true);
  const softened = structuredClone(constitution);
  softened.budgets.maximumTotalCostUsd = 1_000_000;
  assert.throws(() => assertCompanyConstitution(softened), /integrity mismatch/);
  const reWeakened = structuredClone(constitution);
  reWeakened.approvalRules = { ...reWeakened.approvalRules, automaticSpendProhibited: false };
  assert.throws(() => assertCompanyConstitution(reWeakened), /integrity mismatch/);
});

test("amendment produces a new version chained to the exact prior hash", () => {
  const v1 = fixtureConstitution();
  const v2 = amendCompanyConstitution(v1, { qualityFloor: 0.95 });
  assert.equal(v2.version, 2);
  assert.equal(v2.previousVersionHash, v1.constitutionHash);
  assert.equal(v2.qualityFloor, 0.95);
  assert.equal(v2.riskTolerance, v1.riskTolerance);
  assert.throws(() => createCompanyConstitution({ companyId: "c", version: 2, riskTolerance: "low", budgets: { maximumTotalCostUsd: 1, maximumUnitCostUsd: 1 } }), /chain to the exact previous version hash/);
});

test("the fixture contract complies with a permissive constitution and every check is recorded", () => {
  const { contract } = createBoundedLevel2Fixture();
  const constitution = fixtureConstitution();
  const result = assertContractWithinConstitution(contract, constitution);
  assert.equal(result.compatible, true);
  assert.deepEqual(Object.values(result.checks), Object.values(result.checks).map(() => true));
});

test("a contract touching a prohibited action is refused with the exact offending action named", () => {
  const { contract } = createBoundedLevel2Fixture();
  const constitution = fixtureConstitution({ prohibitedActions: ["match-payment", "transfer-funds"] });
  const result = contractConstitutionCompatibility(contract, constitution);
  assert.equal(result.compatible, false);
  assert.equal(result.checks.noProhibitedActions, false);
  assert.deepEqual(result.details.offendingActions, ["match-payment"]);
  assert.throws(() => assertContractWithinConstitution(contract, constitution), /noProhibitedActions/);
});

test("risk beyond tolerance and budgets beyond ceilings are individually detected", () => {
  const { contract } = createBoundedLevel2Fixture();
  const lowRisk = contractConstitutionCompatibility(contract, fixtureConstitution({ riskTolerance: "medium" }));
  assert.equal(lowRisk.checks.riskWithinTolerance, false);
  assert.ok(lowRisk.details.overRisk.includes("approved-stock-shortages"));
  const tightBudget = contractConstitutionCompatibility(contract, fixtureConstitution({ budgets: { maximumTotalCostUsd: 5, maximumUnitCostUsd: 0.5 } }));
  assert.equal(tightBudget.checks.totalBudgetWithinConstitution, false);
  const tightUnit = contractConstitutionCompatibility(contract, fixtureConstitution({ budgets: { maximumTotalCostUsd: 10, maximumUnitCostUsd: 0.1 } }));
  assert.equal(tightUnit.checks.unitCostsWithinBudget, false);
});

test("a plan for the exact contract is checked against cost and latency ceilings", () => {
  const fixture = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan(fixture);
  const fits = planConstitutionCompatibility({ contract: fixture.contract, plan, constitution: fixtureConstitution() });
  assert.equal(fits.compatible, true);
  const slow = planConstitutionCompatibility({ contract: fixture.contract, plan, constitution: fixtureConstitution({ latencyCeilingMs: 1 }) });
  assert.equal(slow.checks.planLatencyWithinCeiling, false);
});

test("execution binds to one constitution version and a swapped or softened constitution fails the binding", () => {
  const fixture = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan(fixture);
  const constitution = fixtureConstitution();
  const binding = bindConstitutionToExecution({ constitution, contract: fixture.contract, plan });
  assert.equal(assertConstitutionUnchanged(binding, constitution), true);
  const replacement = fixtureConstitution({ budgets: { maximumTotalCostUsd: 100, maximumUnitCostUsd: 5 } });
  assert.throws(() => assertConstitutionUnchanged(binding, replacement), /changed after execution was bound/);
  const amended = amendCompanyConstitution(constitution, { qualityFloor: 0.91 });
  assert.throws(() => assertConstitutionUnchanged(binding, amended), /changed after execution was bound/);
});

test("a plan violating the constitution cannot be bound to execution at all", () => {
  const fixture = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan(fixture);
  const constitution = fixtureConstitution({ prohibitedActions: ["draft-order"] });
  assert.throws(() => bindConstitutionToExecution({ constitution, contract: fixture.contract, plan }), /violates the constitution/);
});
