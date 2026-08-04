import { digest } from "../core/canonical.js";
import { createBoundedFleetContract, createBoundedSpecialistRecord } from "./bounded-level2-contract.js";

const requirement = ({ system, tools, context, actions, verifier, policy }) => ({ systems: [system], tools, contextSources: context, authorityActions: actions, verifierId: verifier, policyHash: digest(policy) });

export function createBoundedLevel2Fixture() {
  const supportRequirement = requirement({ system: "support-local", tools: ["read-ticket", "draft-response", "create-escalation"], context: ["assigned-queue", "support-policy", "incident-state"], actions: ["draft-response", "create-escalation"], verifier: "support-plan-verifier-v1", policy: "support-policy-v1" });
  const procurementRequirement = requirement({ system: "procurement-local", tools: ["read-demand", "read-inventory", "draft-order"], context: ["approved-demand", "inventory", "supplier-policy"], actions: ["draft-order"], verifier: "procurement-plan-verifier-v1", policy: "procurement-policy-v1" });
  const revopsRequirement = requirement({ system: "crm-local", tools: ["read-lead", "read-consent", "assign-owner"], context: ["assigned-leads", "consent", "territory-policy"], actions: ["assign-owner"], verifier: "revops-plan-verifier-v1", policy: "revops-policy-v1" });
  const financeRequirement = requirement({ system: "ledger-local", tools: ["read-invoice", "read-payment", "draft-reconciliation"], context: ["open-invoices", "payments", "finance-policy"], actions: ["draft-reconciliation"], verifier: "finance-plan-verifier-v1", policy: "finance-policy-v1" });

  const contract = createBoundedFleetContract({
    companyId: "fictional-multi-department-company",
    goal: "Clear today's approved support, procurement, CRM and finance operations before their deadlines while preserving authority, quality and the $10 operating ceiling.",
    planningWindow: "2026-08-05-day-shift",
    workload: [
      { id: "support-morning-queue", outcome: "Resolve or precisely hand off every assigned support ticket", source: "trusted-support-queue-adapter", volume: 60, dueWithinMs: 2_000, maximumUnitCostUsd: .20, minimumOutcomeScore: .97, risk: "medium", requirement: supportRequirement },
      { id: "approved-stock-shortages", outcome: "Cover approved stock shortages with the smallest permitted draft action", source: "trusted-procurement-adapter", volume: 20, dueWithinMs: 2_500, maximumUnitCostUsd: .15, minimumOutcomeScore: .99, risk: "high", requirement: procurementRequirement },
      { id: "inbound-lead-batch", outcome: "Route assigned leads without violating consent or identity boundaries", source: "trusted-crm-adapter", volume: 25, dueWithinMs: 2_000, maximumUnitCostUsd: .12, minimumOutcomeScore: .98, risk: "medium", requirement: revopsRequirement },
      { id: "unmatched-payments", outcome: "Reconcile unmatched payments to invoices without posting final ledger changes", source: "trusted-ledger-adapter", volume: 10, dueWithinMs: 3_000, maximumUnitCostUsd: .18, minimumOutcomeScore: .99, risk: "high", requirement: financeRequirement },
    ],
    priorities: { quality: 1, cost: .4, speed: .2 },
    limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
  });

  const specialist = (input) => createBoundedSpecialistRecord({ status: "proved-active", version: "1", ...input, evidence: { selectionHash: digest(`${input.id}:selection`), verifierReceiptHash: digest(`${input.id}:verifier`) } });
  const specialists = Object.freeze([
    specialist({ id: "support-quality-specialist", roleId: "support-operations", capability: supportRequirement, performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: .12, medianLatencyMs: 700, capacityPerWindow: 30, unsafeAttempts: 0 } }),
    specialist({ id: "support-efficient-specialist", roleId: "support-operations", capability: supportRequirement, performance: { passRate: 1, outcomeScore: .98, meanUnitCostUsd: .04, medianLatencyMs: 1_100, capacityPerWindow: 50, unsafeAttempts: 0 } }),
    specialist({ id: "procurement-specialist", roleId: "procurement-coverage", capability: procurementRequirement, performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: .06, medianLatencyMs: 900, capacityPerWindow: 30, unsafeAttempts: 0 } }),
    specialist({ id: "revops-specialist", roleId: "revenue-operations", capability: revopsRequirement, performance: { passRate: 1, outcomeScore: .99, meanUnitCostUsd: .05, medianLatencyMs: 850, capacityPerWindow: 35, unsafeAttempts: 0 } }),
  ]);
  return { contract, specialists, requirements: { supportRequirement, procurementRequirement, revopsRequirement, financeRequirement } };
}

