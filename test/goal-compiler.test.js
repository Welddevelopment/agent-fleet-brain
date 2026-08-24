import assert from "node:assert/strict";
import test from "node:test";
import { createCompanyConstitution } from "../src/fleet/constitution.js";
import { createTrustedFleetAdapterDescriptor, createTrustedFleetWorkloadSnapshot } from "../src/fleet/fleet-intake.js";
import {
  assertGoalWorkGraph,
  bindWorkGraphToContract,
  compileGoalWorkGraph,
  compileObjectiveIntake,
  createDeclaredObjective,
} from "../src/fleet/goal-compiler.js";

const TENANT = "fictional-onboarding-company:local";

function requirement(system, tools, actions, verifier) {
  return { systems: [system], tools, contextSources: [`${system}-context`], authorityActions: actions, verifierId: verifier, policyHash: `policy-${system}` };
}

function fixtureAdapters() {
  const billing = createTrustedFleetAdapterDescriptor({
    id: "billing-adapter", version: "1", tenantId: TENANT, systemId: "billing-local", source: "customer-local-trusted-inventory",
    operations: {
      "provision-account": { outcome: "Provision the approved customer account", risk: "medium", requirement: requirement("billing-local", ["read-signup", "create-account"], ["create-account"], "billing-verifier-v1") },
      "issue-first-invoice": { outcome: "Issue the first invoice for a provisioned account", risk: "high", requirement: requirement("billing-local", ["read-account", "draft-invoice"], ["draft-invoice"], "billing-verifier-v1") },
    },
  });
  const crm = createTrustedFleetAdapterDescriptor({
    id: "crm-adapter", version: "1", tenantId: TENANT, systemId: "crm-local", source: "customer-local-trusted-inventory",
    operations: {
      "record-welcome-call": { outcome: "Record the welcome call outcome for the new account", risk: "low", requirement: requirement("crm-local", ["read-account", "log-call"], ["log-call"], "crm-verifier-v1") },
    },
  });
  return { billing, crm };
}

function fixtureSnapshots({ billing, crm }, { includeInvoices = true } = {}) {
  const snapshots = [
    createTrustedFleetWorkloadSnapshot({
      descriptor: billing, capturedAt: "2026-08-24T02:00:00.000Z",
      items: [
        { id: "signup-batch", operationId: "provision-account", volume: 4, dueWithinMs: 5_000, maximumUnitCostUsd: 0.1, minimumOutcomeScore: 0.98 },
        ...(includeInvoices ? [{ id: "invoice-batch", operationId: "issue-first-invoice", volume: 4, dueWithinMs: 8_000, maximumUnitCostUsd: 0.2, minimumOutcomeScore: 0.99 }] : []),
      ],
    }),
    createTrustedFleetWorkloadSnapshot({
      descriptor: crm, capturedAt: "2026-08-24T02:00:00.000Z",
      items: [{ id: "welcome-call-batch", operationId: "record-welcome-call", volume: 4, dueWithinMs: 6_000, maximumUnitCostUsd: 0.05, minimumOutcomeScore: 0.97 }],
    }),
  ];
  return snapshots;
}

function fixtureObjective(overrides = {}) {
  return createDeclaredObjective({
    companyId: "fictional-onboarding-company",
    objectiveId: "onboard-new-customers",
    statement: "Onboard every approved new customer end to end: provision the account, issue the first invoice, and record the welcome call.",
    outcomeClasses: [
      { id: "provisioned", description: "Accounts provisioned", selector: { adapterId: "billing-adapter", operationId: "provision-account" } },
      { id: "invoiced", description: "First invoices issued", selector: { adapterId: "billing-adapter", operationId: "issue-first-invoice" }, dependsOn: ["provisioned"] },
      { id: "welcomed", description: "Welcome calls recorded", selector: { adapterId: "crm-adapter", operationId: "record-welcome-call" }, dependsOn: ["provisioned"] },
    ],
    ...overrides,
  });
}

test("a declared objective compiles into a verified, ordered, system-annotated work graph", () => {
  const adapters = fixtureAdapters();
  const graph = compileGoalWorkGraph({ objective: fixtureObjective(), adapters: Object.values(adapters), snapshots: fixtureSnapshots(adapters) });
  assert.equal(assertGoalWorkGraph(graph), true);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.coverage.mappedItems, 3);
  assert.equal(graph.coverage.orphanItems, 0);
  assert.ok(graph.executionOrder.indexOf("provisioned") < graph.executionOrder.indexOf("invoiced"));
  assert.ok(graph.executionOrder.indexOf("provisioned") < graph.executionOrder.indexOf("welcomed"));
  const invoiced = graph.nodes.find((node) => node.id === "invoiced");
  assert.deepEqual(invoiced.sharesSystemWith, ["provisioned"]);
  assert.deepEqual(invoiced.workloadItemIds, ["invoice-batch"]);
  assert.equal(invoiced.totalVolume, 4);
  assert.deepEqual(Object.values(graph.authority), [false, false, false]);
});

test("workload no outcome class covers is refused by name — coverage must be complete", () => {
  const adapters = fixtureAdapters();
  const objective = fixtureObjective({
    outcomeClasses: [
      { id: "provisioned", description: "Accounts provisioned", selector: { adapterId: "billing-adapter", operationId: "provision-account" } },
      { id: "welcomed", description: "Welcome calls recorded", selector: { adapterId: "crm-adapter", operationId: "record-welcome-call" }, dependsOn: ["provisioned"] },
    ],
  });
  assert.throws(
    () => compileGoalWorkGraph({ objective, adapters: Object.values(adapters), snapshots: fixtureSnapshots(adapters) }),
    /invoice-batch.*not covered by any declared outcome class/,
  );
});

test("an objective referencing an undeclared operation is refused — nothing is invented", () => {
  const adapters = fixtureAdapters();
  const objective = fixtureObjective({
    outcomeClasses: [
      { id: "provisioned", description: "x", selector: { adapterId: "billing-adapter", operationId: "provision-account" } },
      { id: "invoiced", description: "x", selector: { adapterId: "billing-adapter", operationId: "issue-first-invoice" } },
      { id: "welcomed", description: "x", selector: { adapterId: "crm-adapter", operationId: "record-welcome-call" } },
      { id: "imagined", description: "x", selector: { adapterId: "billing-adapter", operationId: "grant-free-credit" } },
    ],
  });
  assert.throws(
    () => compileGoalWorkGraph({ objective, adapters: Object.values(adapters), snapshots: fixtureSnapshots(adapters) }),
    /operation no trusted adapter declares: grant-free-credit/,
  );
});

test("cyclic dependencies are refused with the cycle spelled out", () => {
  const adapters = fixtureAdapters();
  const objective = fixtureObjective({
    outcomeClasses: [
      { id: "provisioned", description: "x", selector: { adapterId: "billing-adapter", operationId: "provision-account" }, dependsOn: ["invoiced"] },
      { id: "invoiced", description: "x", selector: { adapterId: "billing-adapter", operationId: "issue-first-invoice" }, dependsOn: ["provisioned"] },
      { id: "welcomed", description: "x", selector: { adapterId: "crm-adapter", operationId: "record-welcome-call" } },
    ],
  });
  assert.throws(
    () => compileGoalWorkGraph({ objective, adapters: Object.values(adapters), snapshots: fixtureSnapshots(adapters) }),
    /contain a cycle/,
  );
});

test("a required class with no live workload refuses; an optional one is dropped with a record", () => {
  const adapters = fixtureAdapters();
  const snapshots = fixtureSnapshots(adapters, { includeInvoices: false });
  assert.throws(
    () => compileGoalWorkGraph({ objective: fixtureObjective(), adapters: Object.values(adapters), snapshots }),
    /Required outcome class invoiced has no current workload/,
  );
  const optional = fixtureObjective({
    outcomeClasses: [
      { id: "provisioned", description: "x", selector: { adapterId: "billing-adapter", operationId: "provision-account" } },
      { id: "invoiced", description: "x", selector: { adapterId: "billing-adapter", operationId: "issue-first-invoice" }, required: false, dependsOn: ["provisioned"] },
      { id: "welcomed", description: "x", selector: { adapterId: "crm-adapter", operationId: "record-welcome-call" }, dependsOn: ["provisioned"] },
    ],
  });
  const graph = compileGoalWorkGraph({ objective: optional, adapters: Object.values(adapters), snapshots });
  assert.deepEqual(graph.coverage.droppedOptionalClasses, ["invoiced"]);
  assert.equal(graph.nodes.length, 2);
});

test("a constitution prohibiting an action refuses the objective naming class and action", () => {
  const adapters = fixtureAdapters();
  const constitution = createCompanyConstitution({
    companyId: "fictional-onboarding-company",
    riskTolerance: "high",
    budgets: { maximumTotalCostUsd: 5, maximumUnitCostUsd: 1 },
    prohibitedActions: ["draft-invoice"],
  });
  assert.throws(
    () => compileGoalWorkGraph({ objective: fixtureObjective(), adapters: Object.values(adapters), snapshots: fixtureSnapshots(adapters), constitution }),
    /Outcome class invoiced requires prohibited actions: draft-invoice/,
  );
});

test("a tampered objective is refused before any compilation", () => {
  const adapters = fixtureAdapters();
  const objective = fixtureObjective();
  const tampered = structuredClone(objective);
  tampered.outcomeClasses[0].selector.operationId = "issue-first-invoice";
  assert.throws(
    () => compileGoalWorkGraph({ objective: tampered, adapters: Object.values(adapters), snapshots: fixtureSnapshots(adapters) }),
    /integrity mismatch/,
  );
});

test("the one-call path: objective -> graph -> contract -> exact binding receipt, and the graph agrees with the contract", () => {
  const adapters = fixtureAdapters();
  const result = compileObjectiveIntake({
    objective: fixtureObjective(),
    adapters: Object.values(adapters),
    snapshots: fixtureSnapshots(adapters),
    tenantId: TENANT,
    planningWindow: "onboarding-window",
    priorities: { quality: 1, cost: 0.3, speed: 0.2 },
    limits: { maximumTotalCostUsd: 5, maximumNewRoleProposals: 1 },
    now: "2026-08-24T02:01:00.000Z",
  });
  assert.equal(result.receipt.coverage, "exact");
  assert.equal(result.receipt.graphHash, result.graph.graphHash);
  assert.equal(result.receipt.contractHash, result.intake.contract.contractHash);
  assert.equal(result.receipt.objectiveHash, result.objective.objectiveHash);
  assert.equal(result.receipt.workloadItems, 3);
});

test("a graph cannot bind to a contract covering different work", () => {
  const adapters = fixtureAdapters();
  const graph = compileGoalWorkGraph({ objective: fixtureObjective(), adapters: Object.values(adapters), snapshots: fixtureSnapshots(adapters) });
  // A second, different snapshot set: same operations, but the invoice batch is a
  // different item id — so the contract covers three items, one of which the graph
  // never mapped, and one graph item is missing from the contract.
  const differentSnapshots = [
    createTrustedFleetWorkloadSnapshot({
      descriptor: adapters.billing, capturedAt: "2026-08-24T02:00:00.000Z",
      items: [
        { id: "signup-batch", operationId: "provision-account", volume: 4, dueWithinMs: 5_000, maximumUnitCostUsd: 0.1, minimumOutcomeScore: 0.98 },
        { id: "late-invoice-batch", operationId: "issue-first-invoice", volume: 2, dueWithinMs: 8_000, maximumUnitCostUsd: 0.2, minimumOutcomeScore: 0.99 },
      ],
    }),
    createTrustedFleetWorkloadSnapshot({
      descriptor: adapters.crm, capturedAt: "2026-08-24T02:00:00.000Z",
      items: [{ id: "welcome-call-batch", operationId: "record-welcome-call", volume: 4, dueWithinMs: 6_000, maximumUnitCostUsd: 0.05, minimumOutcomeScore: 0.97 }],
    }),
  ];
  const different = compileObjectiveIntake({
    objective: fixtureObjective(),
    adapters: Object.values(adapters),
    snapshots: differentSnapshots,
    tenantId: TENANT,
    planningWindow: "onboarding-window",
    priorities: { quality: 1, cost: 0.3, speed: 0.2 },
    limits: { maximumTotalCostUsd: 5, maximumNewRoleProposals: 1 },
    now: "2026-08-24T02:01:00.000Z",
  });
  assert.throws(() => bindWorkGraphToContract({ graph, contract: different.intake.contract }), /cover different work/);
});
