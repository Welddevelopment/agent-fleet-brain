import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { createBoundedFleetContract, createBoundedSpecialistRecord } from "../src/fleet/bounded-level2-contract.js";
import { createBoundedFleetPlan } from "../src/fleet/bounded-level2-planner.js";
import { createBoundedLevel2Fixture } from "../src/fleet/bounded-level2-fixture.js";
import { createFleetAssignmentObservation } from "../src/fleet/bounded-level2-controller.js";
import { contractConstitutionCompatibility, createCompanyConstitution } from "../src/fleet/constitution.js";
import { createAssignmentEffectDeclaration, createSharedInvariant, verifyAggregateOutcome } from "../src/fleet/aggregate-verifier.js";
import { auditPlanForOverlapSplits, declareOverlapGroups } from "../src/fleet/overlap-guard.js";

// ---- Company invariants: declared in the constitution, enforced twice ----------

function escalationContract(volume) {
  const requirement = (system, tools, actions) => ({ systems: [system], tools, contextSources: [`${system}-context`], authorityActions: actions, verifierId: `${system}-v1`, policyHash: `policy-${system}` });
  return createBoundedFleetContract({
    companyId: "fictional-invariant-company",
    goal: "Clear today's escalations, tickets and filings without breaching any company-wide cap.",
    workload: [
      { id: "escalations", outcome: "Escalate approved incidents", source: "trusted-adapter", volume, dueWithinMs: 60_000, maximumUnitCostUsd: 0.1, minimumOutcomeScore: 0.95, risk: "medium", requirement: requirement("support-local", ["read-ticket", "create-escalation"], ["create-escalation"]) },
      { id: "tickets", outcome: "Answer tickets", source: "trusted-adapter", volume: 5, dueWithinMs: 60_000, maximumUnitCostUsd: 0.1, minimumOutcomeScore: 0.95, risk: "low", requirement: requirement("support-local", ["read-ticket", "draft-response"], ["draft-response"]) },
      { id: "filings", outcome: "File records", source: "trusted-adapter", volume: 5, dueWithinMs: 60_000, maximumUnitCostUsd: 0.1, minimumOutcomeScore: 0.95, risk: "low", requirement: requirement("archive-local", ["read-record", "file-record"], ["file-record"]) },
    ],
    priorities: { quality: 1, cost: 0.25, speed: 0.25 },
    limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
  });
}

function invariantConstitution(limit) {
  return createCompanyConstitution({
    companyId: "fictional-invariant-company",
    riskTolerance: "high",
    budgets: { maximumTotalCostUsd: 10, maximumUnitCostUsd: 0.5 },
    sharedInvariants: [{ action: "create-escalation", limit }],
  });
}

test("a plan that would breach a declared company cap is refused BEFORE execution, naming the exact numbers", () => {
  const result = contractConstitutionCompatibility(escalationContract(8), invariantConstitution(5));
  assert.equal(result.compatible, false);
  assert.equal(result.checks.sharedInvariantsRespectedInPlan, false);
  assert.deepEqual(result.details.invariantBreaches, [{ action: "create-escalation", limit: 5, plannedCount: 8 }]);
  // The same day under the cap is compatible.
  const fits = contractConstitutionCompatibility(escalationContract(5), invariantConstitution(5));
  assert.equal(fits.checks.sharedInvariantsRespectedInPlan, true);
});

test("the same cap is re-checked AFTER execution from combined effects — closing the A2 gap for declared invariants", () => {
  const fixture = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan(fixture);
  const observations = plan.selected.assignments.slice(0, 2).map((assignment) => {
    const specialist = fixture.specialists.find((item) => item.id === assignment.specialistId);
    return createFleetAssignmentObservation({
      contract: fixture.contract, plan, assignment, specialist,
      result: { verifierId: assignment.verifierId, independentlyVerified: true, verificationPassed: true, completedQuantity: assignment.quantity, actualCostUsd: 0, unsafeAttempts: 0, incorrectSideEffects: 0, verificationReceiptHash: digest({ x: assignment.assignmentId }) },
    });
  });
  // Each assignment declares two escalation effects — individually fine, five total against a cap of four.
  const declarations = [
    createAssignmentEffectDeclaration({ observation: observations[0], effects: [{ kind: "create-escalation", target: "incident-1" }, { kind: "create-escalation", target: "incident-2" }, { kind: "create-escalation", target: "incident-3" }] }),
    createAssignmentEffectDeclaration({ observation: observations[1], effects: [{ kind: "create-escalation", target: "incident-4" }, { kind: "create-escalation", target: "incident-5" }] }),
  ];
  const invariant = createSharedInvariant({ id: "escalation-cap", kind: "max-action-count", action: "create-escalation", limit: 4, description: "At most four escalations per window, company-wide" });
  const receipt = verifyAggregateOutcome({ invariants: [invariant], observations, effectDeclarations: declarations });
  assert.equal(receipt.status, "combined-effects-violation");
  assert.equal(receipt.individuallyGreenObservations, true);
  const result = receipt.results.find((item) => item.invariantId === "escalation-cap");
  assert.equal(result.actionCount, 5);
  assert.equal(result.violations[0].assignments.length, 2);
});

// ---- Overlap prevention: declared groups, consolidation audited, splits refused --

function overlapFixture({ capacity }) {
  const requirement = { systems: ["support-local"], tools: ["read-ticket", "draft-response"], contextSources: ["support-local-context"], authorityActions: ["draft-response"], verifierId: "support-v1", policyHash: "policy-support" };
  const contract = createBoundedFleetContract({
    companyId: "fictional-overlap-company",
    goal: "Work both support queues knowing a mail rule copies some tickets into each of them.",
    workload: [
      { id: "queue-a", outcome: "Answer queue A", source: "trusted-adapter", volume: 6, dueWithinMs: 60_000, maximumUnitCostUsd: 0.1, minimumOutcomeScore: 0.95, risk: "low", requirement: structuredClone(requirement) },
      { id: "queue-b", outcome: "Answer queue B", source: "trusted-adapter", volume: 6, dueWithinMs: 60_000, maximumUnitCostUsd: 0.1, minimumOutcomeScore: 0.95, risk: "low", requirement: structuredClone(requirement) },
      { id: "filings", outcome: "File records", source: "trusted-adapter", volume: 3, dueWithinMs: 60_000, maximumUnitCostUsd: 0.1, minimumOutcomeScore: 0.95, risk: "low", requirement: { systems: ["archive-local"], tools: ["file-record"], contextSources: ["archive-local-context"], authorityActions: ["file-record"], verifierId: "archive-v1", policyHash: "policy-archive" } },
    ],
    priorities: { quality: 1, cost: 0.25, speed: 0.25 },
    limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
  });
  const proved = (id, cap) => createBoundedSpecialistRecord({
    id, roleId: "support-operations", version: "1", status: "proved-active",
    capability: structuredClone(requirement),
    performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: 0.05, medianLatencyMs: 800, capacityPerWindow: cap, unsafeAttempts: 0 },
    evidence: { selectionHash: `sel-${id}`, verifierReceiptHash: `ver-${id}` },
  });
  const archivist = createBoundedSpecialistRecord({
    id: "archivist-1", roleId: "records-archiving", version: "1", status: "proved-active",
    capability: { systems: ["archive-local"], tools: ["file-record"], contextSources: ["archive-local-context"], authorityActions: ["file-record"], verifierId: "archive-v1", policyHash: "policy-archive" },
    performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: 0.02, medianLatencyMs: 500, capacityPerWindow: 50, unsafeAttempts: 0 },
    evidence: { selectionHash: "sel-arch", verifierReceiptHash: "ver-arch" },
  });
  const specialists = [proved("support-a", capacity), proved("support-b", capacity), archivist];
  const plan = createBoundedFleetPlan({ contract, specialists });
  return { contract, specialists, plan };
}

test("ample capacity: both overlapping queues land on one specialist and the audit passes", () => {
  const { contract, plan } = overlapFixture({ capacity: 50 });
  const declaration = declareOverlapGroups({ contract, groups: [{ id: "mail-rule-copy", workloadIds: ["queue-a", "queue-b"], sharedRecordCount: 3 }] });
  const audit = auditPlanForOverlapSplits({ plan, declaration });
  assert.equal(audit.consolidated, true);
  assert.deepEqual(audit.violations, []);
});

test("forced split: the audit REFUSES execution and names the group and both specialists — no duplicate can reach the world", () => {
  // Capacity 8 against 12 support units forces the planner to split the queues.
  const { contract, plan } = overlapFixture({ capacity: 8 });
  const declaration = declareOverlapGroups({ contract, groups: [{ id: "mail-rule-copy", workloadIds: ["queue-a", "queue-b"], sharedRecordCount: 3 }] });
  const audit = auditPlanForOverlapSplits({ plan, declaration });
  assert.equal(audit.consolidated, false);
  assert.equal(audit.violations[0].groupId, "mail-rule-copy");
  assert.equal(audit.violations[0].specialists.length, 2);
  assert.match(audit.verdict, /refuse-execution/);
});

test("a declaration across different systems is refused — queues on different systems cannot share records", () => {
  const { contract } = overlapFixture({ capacity: 50 });
  assert.throws(
    () => declareOverlapGroups({ contract, groups: [{ id: "impossible", workloadIds: ["queue-a", "filings"] }] }),
    /must share one system and one action/,
  );
});

test("a tampered declaration is refused by the audit", () => {
  const { contract, plan } = overlapFixture({ capacity: 50 });
  const declaration = declareOverlapGroups({ contract, groups: [{ id: "mail-rule-copy", workloadIds: ["queue-a", "queue-b"] }] });
  const tampered = structuredClone(declaration);
  tampered.groups[0].workloadIds = ["queue-a"];
  assert.throws(() => auditPlanForOverlapSplits({ plan, declaration: tampered }), /integrity mismatch/);
});
