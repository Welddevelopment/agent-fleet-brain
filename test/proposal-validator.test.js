import assert from "node:assert/strict";
import test from "node:test";
import { validateDecompositionProposal } from "../src/fleet/proposal-validator.js";
import { createCompanyConstitution } from "../src/fleet/constitution.js";
import { onboardingAdapters, onboardingSnapshots } from "./helpers/onboarding-fixture.js";

const COMPANY = "fictional-onboarding-company";

function companyInputs() {
  const adapters = onboardingAdapters();
  return { adapters: Object.values(adapters), snapshots: onboardingSnapshots(adapters) };
}

function goodProposal() {
  return {
    objectiveId: "onboard-new-customers",
    statement: "Onboard every approved new customer end to end: provision, invoice, and record the welcome call.",
    outcomeClasses: [
      { id: "provisioned", description: "Accounts provisioned", selector: { adapterId: "billing-adapter", operationId: "provision-account" } },
      { id: "invoiced", description: "First invoices issued", selector: { adapterId: "billing-adapter", operationId: "issue-first-invoice" }, dependsOn: ["provisioned"] },
      { id: "welcomed", description: "Welcome calls recorded", selector: { adapterId: "crm-adapter", operationId: "record-welcome-call" }, dependsOn: ["provisioned"] },
    ],
  };
}

test("a well-grounded untrusted proposal compiles into a verified graph with an acceptance receipt", () => {
  const { adapters, snapshots } = companyInputs();
  const result = validateDecompositionProposal({ proposal: goodProposal(), companyId: COMPANY, adapters, snapshots });
  assert.equal(result.accepted, true);
  assert.equal(result.graph.nodes.length, 3);
  assert.equal(result.receipt.schemaVersion, "fleetbrain.decomposition-proposal-acceptance.v1");
  assert.equal(result.receipt.workloadItems, 3);
});

test("a proposal inventing an operation is refused at grounding, naming the invention", () => {
  const { adapters, snapshots } = companyInputs();
  const proposal = goodProposal();
  proposal.outcomeClasses.push({ id: "imagined", description: "x", selector: { adapterId: "billing-adapter", operationId: "wire-funds-offshore" } });
  const result = validateDecompositionProposal({ proposal, companyId: COMPANY, adapters, snapshots });
  assert.equal(result.accepted, false);
  assert.equal(result.stage, "grounding");
  assert.match(result.reason, /operation no trusted adapter declares: wire-funds-offshore/);
});

test("a proposal that quietly drops work is refused — coverage must be complete", () => {
  const { adapters, snapshots } = companyInputs();
  const proposal = goodProposal();
  proposal.outcomeClasses = proposal.outcomeClasses.filter((item) => item.id !== "invoiced");
  const result = validateDecompositionProposal({ proposal, companyId: COMPANY, adapters, snapshots });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /invoice-batch.*not covered/);
});

test("a proposal with circular dependencies is refused with the cycle spelled out", () => {
  const { adapters, snapshots } = companyInputs();
  const proposal = goodProposal();
  proposal.outcomeClasses[0].dependsOn = ["invoiced"];
  const result = validateDecompositionProposal({ proposal, companyId: COMPANY, adapters, snapshots });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /cycle/);
});

test("a proposal requiring a constitutionally banned action is refused", () => {
  const { adapters, snapshots } = companyInputs();
  const constitution = createCompanyConstitution({ companyId: COMPANY, riskTolerance: "high", budgets: { maximumTotalCostUsd: 5, maximumUnitCostUsd: 0.5 }, prohibitedActions: ["draft-invoice"] });
  const result = validateDecompositionProposal({ proposal: goodProposal(), companyId: COMPANY, adapters, snapshots, constitution });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /prohibited actions: draft-invoice/);
});

test("smuggled unknown fields are refused outright — untrusted input gets no unchecked properties", () => {
  const { adapters, snapshots } = companyInputs();
  const withTopLevel = { ...goodProposal(), executionAuthorized: true };
  const first = validateDecompositionProposal({ proposal: withTopLevel, companyId: COMPANY, adapters, snapshots });
  assert.equal(first.accepted, false);
  assert.match(first.reason, /unknown fields.*executionAuthorized/);
  const withClassLevel = goodProposal();
  withClassLevel.outcomeClasses[0].authorityOverride = "all";
  const second = validateDecompositionProposal({ proposal: withClassLevel, companyId: COMPANY, adapters, snapshots });
  assert.equal(second.accepted, false);
  assert.match(second.reason, /unknown fields.*authorityOverride/);
});

test("garbage input produces a sealed rejection receipt, never an exception", () => {
  const { adapters, snapshots } = companyInputs();
  for (const garbage of [null, 42, "drop table", [], { outcomeClasses: "nope" }]) {
    const result = validateDecompositionProposal({ proposal: garbage, companyId: COMPANY, adapters, snapshots });
    assert.equal(result.accepted, false);
    assert.equal(result.receipt.schemaVersion, "fleetbrain.decomposition-proposal-rejection.v1");
    assert.ok(result.receipt.receiptHash);
  }
});
