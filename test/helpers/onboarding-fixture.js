import { createBoundedSpecialistRecord } from "../../src/fleet/bounded-level2-contract.js";
import { createTrustedFleetAdapterDescriptor, createTrustedFleetWorkloadSnapshot } from "../../src/fleet/fleet-intake.js";
import { createDeclaredObjective } from "../../src/fleet/goal-compiler.js";

// A self-contained fictional onboarding company used by the goal-compiler,
// scheduler and harness tests: two systems, three operations, a declared
// objective with real dependencies, and specialists proved for each operation.

export const ONBOARDING_TENANT = "fictional-onboarding-company:local";

export function onboardingRequirement(system, tools, actions, verifier) {
  return { systems: [system], tools, contextSources: [`${system}-context`], authorityActions: actions, verifierId: verifier, policyHash: `policy-${system}` };
}

export function onboardingAdapters() {
  const billing = createTrustedFleetAdapterDescriptor({
    id: "billing-adapter", version: "1", tenantId: ONBOARDING_TENANT, systemId: "billing-local", source: "customer-local-trusted-inventory",
    operations: {
      "provision-account": { outcome: "Provision the approved customer account", risk: "medium", requirement: onboardingRequirement("billing-local", ["read-signup", "create-account"], ["create-account"], "billing-verifier-v1") },
      "issue-first-invoice": { outcome: "Issue the first invoice for a provisioned account", risk: "high", requirement: onboardingRequirement("billing-local", ["read-account", "draft-invoice"], ["draft-invoice"], "billing-verifier-v1") },
    },
  });
  const crm = createTrustedFleetAdapterDescriptor({
    id: "crm-adapter", version: "1", tenantId: ONBOARDING_TENANT, systemId: "crm-local", source: "customer-local-trusted-inventory",
    operations: {
      "record-welcome-call": { outcome: "Record the welcome call outcome for the new account", risk: "low", requirement: onboardingRequirement("crm-local", ["read-account", "log-call"], ["log-call"], "crm-verifier-v1") },
    },
  });
  return { billing, crm };
}

export function onboardingSnapshots({ billing, crm }) {
  return [
    createTrustedFleetWorkloadSnapshot({
      descriptor: billing, capturedAt: "2026-08-24T02:00:00.000Z",
      items: [
        { id: "signup-batch", operationId: "provision-account", volume: 4, dueWithinMs: 5_000, maximumUnitCostUsd: 0.1, minimumOutcomeScore: 0.98 },
        { id: "invoice-batch", operationId: "issue-first-invoice", volume: 4, dueWithinMs: 8_000, maximumUnitCostUsd: 0.2, minimumOutcomeScore: 0.99 },
      ],
    }),
    createTrustedFleetWorkloadSnapshot({
      descriptor: crm, capturedAt: "2026-08-24T02:00:00.000Z",
      items: [{ id: "welcome-call-batch", operationId: "record-welcome-call", volume: 4, dueWithinMs: 6_000, maximumUnitCostUsd: 0.05, minimumOutcomeScore: 0.97 }],
    }),
  ];
}

export function onboardingObjective() {
  return createDeclaredObjective({
    companyId: "fictional-onboarding-company",
    objectiveId: "onboard-new-customers",
    statement: "Onboard every approved new customer end to end: provision the account, issue the first invoice, and record the welcome call.",
    outcomeClasses: [
      { id: "provisioned", description: "Accounts provisioned", selector: { adapterId: "billing-adapter", operationId: "provision-account" } },
      { id: "invoiced", description: "First invoices issued", selector: { adapterId: "billing-adapter", operationId: "issue-first-invoice" }, dependsOn: ["provisioned"] },
      { id: "welcomed", description: "Welcome calls recorded", selector: { adapterId: "crm-adapter", operationId: "record-welcome-call" }, dependsOn: ["provisioned"] },
    ],
  });
}

export function onboardingSpecialists() {
  const proved = (input) => createBoundedSpecialistRecord({ status: "proved-active", version: "1", ...input, evidence: { selectionHash: `sel-${input.id}`, verifierReceiptHash: `ver-${input.id}` } });
  return [
    proved({ id: "billing-provisioner", roleId: "billing-provisioning", capability: onboardingRequirement("billing-local", ["read-signup", "create-account"], ["create-account"], "billing-verifier-v1"), performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: 0.04, medianLatencyMs: 800, capacityPerWindow: 10, unsafeAttempts: 0 } }),
    proved({ id: "billing-invoicer", roleId: "billing-invoicing", capability: onboardingRequirement("billing-local", ["read-account", "draft-invoice"], ["draft-invoice"], "billing-verifier-v1"), performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: 0.06, medianLatencyMs: 1_200, capacityPerWindow: 10, unsafeAttempts: 0 } }),
    proved({ id: "crm-caller", roleId: "crm-welcome", capability: onboardingRequirement("crm-local", ["read-account", "log-call"], ["log-call"], "crm-verifier-v1"), performance: { passRate: 1, outcomeScore: 0.99, meanUnitCostUsd: 0.02, medianLatencyMs: 900, capacityPerWindow: 10, unsafeAttempts: 0 } }),
  ];
}

export function onboardingIntakeArguments() {
  return {
    tenantId: ONBOARDING_TENANT,
    planningWindow: "onboarding-window",
    priorities: { quality: 1, cost: 0.3, speed: 0.2 },
    limits: { maximumTotalCostUsd: 5, maximumNewRoleProposals: 1 },
    now: "2026-08-24T02:01:00.000Z",
  };
}
