import fs from "node:fs";
import path from "node:path";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { financeCloseRole } from "dynamic-agent-specialisation/src/roles/finance-close.js";
import { createBoundedSpecialistRecord } from "./bounded-level2-contract.js";
import { BoundedFleetController, createFleetAssignmentObservation } from "./bounded-level2-controller.js";
import { createBoundedFleetPlan } from "./bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "./bounded-level2-verifier.js";
import { createBoundedLevel2Fixture } from "./bounded-level2-fixture.js";
import {
  assertConstitutionUnchanged,
  bindConstitutionToExecution,
  createCompanyConstitution,
} from "./constitution.js";
import {
  createAssignmentEffectDeclaration,
  createSharedInvariant,
  verifyAggregateOutcome,
} from "./aggregate-verifier.js";
import { compileObjectiveIntake, createDeclaredObjective } from "./goal-compiler.js";
import { createExecutionSchedule } from "./scheduler.js";
import { executeAssignedUnits, unitsForWorkload } from "./comparison-work-engine.js";
import { createComparisonWorld, verifyComparisonAssignmentScope, verifyComparisonParentGoal } from "./comparison-world.js";
import { runRoleGapConstructionStage } from "./role-gap-construction.js";
import { createTrustedFleetAdapterDescriptor, createTrustedFleetWorkloadSnapshot } from "./fleet-intake.js";

// The Fleet Brain demo story: one deterministic run of the whole mechanism,
// written as sealed stage receipts a console can render and a person can retell.
//
// Four acts:
//   1. A fictional onboarding company, end to end: declared objective -> bounded
//      decomposition -> constitution -> plan -> independent verification ->
//      schedule -> exact-hash authorization -> deterministic execution ->
//      per-assignment verification -> aggregate invariants -> parent verdict.
//   2. A role gap resolved properly: the planner refuses to guess, the durable
//      controller issues a preparation, DAS's deterministic compiler builds a
//      specialist, the SAME admission gate re-checks it, and only the blocked
//      work is replanned. Planning and construction only — no execution claim.
//   3. Refusals, live: a constitution-prohibited objective and a hard-budget
//      blocked plan, both with the exact blocker on the record.
//   4. The comparison verdict, read from its own sealed artifacts — wins AND
//      losses — plus the paid V2/V3 evidence, never merged with anything.
//
// Zero model calls. Every stage receipt carries its own hash; the manifest hash
// covers them all; the console fails closed on any mismatch.

const DEMO_CLOCK = () => "2026-08-24T05:00:00.000Z";

const DEMO_CONSTANTS = Object.freeze({
  unitConstantsBySystem: Object.freeze({
    "billing-local": Object.freeze({ unitCostUsd: 0.05, unitLatencyMs: 1000 }),
    "crm-local": Object.freeze({ unitCostUsd: 0.02, unitLatencyMs: 900 }),
  }),
});

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function demoRequirement(system, tools, actions) {
  return { systems: [system], tools, contextSources: [`${system}-context`], authorityActions: actions, verifierId: `${system}-scope-verifier-v1`, policyHash: `policy-${system}` };
}

function demoAdapters(tenantId) {
  const billing = createTrustedFleetAdapterDescriptor({
    id: "billing-adapter", version: "1", tenantId, systemId: "billing-local", source: "customer-local-trusted-inventory",
    operations: {
      "provision-account": { outcome: "Provision the approved customer account", risk: "medium", requirement: demoRequirement("billing-local", ["read-signup", "create-account"], ["create-account"]) },
      "issue-first-invoice": { outcome: "Issue the first invoice for a provisioned account", risk: "high", requirement: demoRequirement("billing-local", ["read-account", "draft-invoice"], ["draft-invoice"]) },
    },
  });
  const crm = createTrustedFleetAdapterDescriptor({
    id: "crm-adapter", version: "1", tenantId, systemId: "crm-local", source: "customer-local-trusted-inventory",
    operations: {
      "record-welcome-call": { outcome: "Record the welcome call outcome for the new account", risk: "low", requirement: demoRequirement("crm-local", ["read-account", "log-call"], ["log-call"]) },
    },
  });
  return { billing, crm };
}

function demoSnapshots({ billing, crm }, capturedAt) {
  return [
    createTrustedFleetWorkloadSnapshot({
      descriptor: billing, capturedAt,
      items: [
        { id: "signup-batch", operationId: "provision-account", volume: 4, dueWithinMs: 60_000, maximumUnitCostUsd: 0.10, minimumOutcomeScore: 0.95 },
        { id: "invoice-batch", operationId: "issue-first-invoice", volume: 4, dueWithinMs: 60_000, maximumUnitCostUsd: 0.10, minimumOutcomeScore: 0.95 },
      ],
    }),
    createTrustedFleetWorkloadSnapshot({
      descriptor: crm, capturedAt,
      items: [{ id: "welcome-call-batch", operationId: "record-welcome-call", volume: 4, dueWithinMs: 60_000, maximumUnitCostUsd: 0.10, minimumOutcomeScore: 0.95 }],
    }),
  ];
}

function demoObjective(companyId) {
  return createDeclaredObjective({
    companyId,
    objectiveId: "onboard-new-customers",
    statement: "Onboard every approved new customer end to end: provision the account, issue the first invoice, and record the welcome call.",
    outcomeClasses: [
      { id: "provisioned", description: "Accounts provisioned", selector: { adapterId: "billing-adapter", operationId: "provision-account" } },
      { id: "invoiced", description: "First invoices issued", selector: { adapterId: "billing-adapter", operationId: "issue-first-invoice" }, dependsOn: ["provisioned"] },
      { id: "welcomed", description: "Welcome calls recorded", selector: { adapterId: "crm-adapter", operationId: "record-welcome-call" }, dependsOn: ["provisioned"] },
    ],
  });
}

function demoSpecialists() {
  const proved = (input) => createBoundedSpecialistRecord({ status: "proved-active", version: "1", ...input, evidence: { selectionHash: `demo-sel-${input.id}`, verifierReceiptHash: `demo-ver-${input.id}` } });
  return [
    proved({ id: "billing-provisioner", roleId: "billing-provisioning", capability: demoRequirement("billing-local", ["read-signup", "create-account"], ["create-account"]), performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: 0.05, medianLatencyMs: 1000, capacityPerWindow: 10, unsafeAttempts: 0 } }),
    proved({ id: "billing-invoicer", roleId: "billing-invoicing", capability: demoRequirement("billing-local", ["read-account", "draft-invoice"], ["draft-invoice"]), performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: 0.05, medianLatencyMs: 1000, capacityPerWindow: 10, unsafeAttempts: 0 } }),
    proved({ id: "crm-caller", roleId: "crm-welcome", capability: demoRequirement("crm-local", ["read-account", "log-call"], ["log-call"]), performance: { passRate: 1, outcomeScore: 0.99, meanUnitCostUsd: 0.02, medianLatencyMs: 900, capacityPerWindow: 10, unsafeAttempts: 0 } }),
  ];
}

// The execution world for act one, built as a real sealed case record: one record
// per unit of declared work, grouped by workload class.
function demoExecutionCase(contract) {
  const workloadUnits = {};
  const sharedRecords = [];
  for (const item of contract.workload) {
    const ids = Array.from({ length: item.volume }, (_, index) => `${item.id}-${String(index + 1).padStart(2, "0")}`);
    workloadUnits[item.id] = ids;
    for (const recordId of ids) sharedRecords.push({ recordId, system: item.requirement.systems[0], requiredAction: item.requirement.authorityActions[0], workloadIds: [item.id] });
  }
  const record = {
    schemaVersion: "fleetbrain.comparison-case.v1",
    id: "demo-onboarding",
    regime: "demo",
    title: "The onboarding company, end to end",
    narrative: "Twelve fictional units across two systems, executed deterministically under the full control chain.",
    contractInput: { workload: structuredClone(contract.workload) },
    workloadUnits,
    sharedRecords: sharedRecords.sort((left, right) => left.recordId.localeCompare(right.recordId)),
    preregisteredExpectation: { hypothesis: "The chain completes and every check holds.", primaryMetrics: ["parentGoalCompleted"] },
    evidenceBoundary: "A fictional execution world for the demo story. Deterministic; no model, no customer, no real system.",
  };
  record.caseHash = digest(record);
  return Object.freeze(record);
}

function stageReceipt(stage, status, fields) {
  const receipt = { schemaVersion: "fleetbrain.demo-stage.v1", stage, status, ...fields };
  receipt.stageHash = digest(receipt);
  return Object.freeze(receipt);
}

export async function runFleetBrainDemo({ outputDirectory, approvedBy = "demo-operator", clock = DEMO_CLOCK }) {
  requireCondition(outputDirectory, "The demo needs an output directory");
  fs.mkdirSync(outputDirectory, { recursive: true });
  requireCondition(fs.readdirSync(outputDirectory).length === 0, `Demo output directory is not empty: ${outputDirectory} — pick a fresh one; demo runs never overwrite evidence`);
  requireCondition(String(approvedBy ?? "").trim(), "The demo needs an accountable operator name");
  const stages = [];

  // ---- ACT 1 — the onboarding company, end to end -------------------------
  const companyId = "fictional-onboarding-company";
  const tenantId = `${companyId}:local`;
  const constitution = createCompanyConstitution({
    companyId,
    riskTolerance: "high",
    qualityFloor: 0.9,
    budgets: { maximumTotalCostUsd: 5, maximumUnitCostUsd: 0.5 },
    latencyCeilingMs: 60_000,
    prohibitedActions: ["transfer-funds", "delete-customer-data"],
  });
  stages.push(stageReceipt("constitution", "sealed", {
    constitutionHash: constitution.constitutionHash,
    version: constitution.version,
    prohibitedActions: constitution.prohibitedActions,
    summaryLine: `Company constitution v${constitution.version} sealed: risk tolerance ${constitution.riskTolerance}, $${constitution.budgets.maximumTotalCostUsd} ceiling, ${constitution.prohibitedActions.length} prohibited actions. Trusted code re-verifies its hash at every later step.`,
  }));

  const adapters = demoAdapters(tenantId);
  const objective = demoObjective(companyId);
  const compiled = compileObjectiveIntake({
    objective,
    adapters: Object.values(adapters),
    snapshots: demoSnapshots(adapters, "2026-08-24T05:00:00.000Z"),
    constitution,
    tenantId,
    planningWindow: "demo-onboarding-window",
    priorities: { quality: 1, cost: 0.3, speed: 0.2 },
    limits: { maximumTotalCostUsd: 5, maximumNewRoleProposals: 1 },
    now: "2026-08-24T05:01:00.000Z",
  });
  stages.push(stageReceipt("goal-compilation", "objective-decomposed-and-bound", {
    objectiveHash: objective.objectiveHash,
    graphHash: compiled.graph.graphHash,
    contractHash: compiled.intake.contract.contractHash,
    bindingReceiptHash: compiled.receipt.receiptHash,
    nodes: compiled.graph.nodes.length,
    executionOrder: compiled.graph.executionOrder,
    coverage: compiled.graph.coverage,
    summaryLine: `One declared broad objective decomposed into ${compiled.graph.nodes.length} outcome classes over ${compiled.graph.coverage.mappedItems} workload items — coverage exact, dependencies acyclic, every operation adapter-declared, authority checked against the constitution. Declared decomposition, not open-ended strategy.`,
  }));

  const specialists = demoSpecialists();
  const contract = compiled.intake.contract;
  const plan = createBoundedFleetPlan({ contract, specialists });
  const planVerification = verifyBoundedFleetPlan({ contract, specialists, plan });
  requireCondition(planVerification.passed === true && plan.selected, "Demo plan failed independent verification");
  stages.push(stageReceipt("plan", plan.status, {
    planHash: plan.planHash,
    strategy: plan.selected.strategy,
    assignments: plan.selected.assignments.length,
    estimatedCostUsd: plan.selected.metrics.totalCostUsd,
    independentlyVerified: true,
    summaryLine: `Four strategy variants scored; ${plan.selected.strategy} selected: ${plan.selected.assignments.length} assignments, $${plan.selected.metrics.totalCostUsd.toFixed(2)} estimated, independently re-verified by a separate checker.`,
  }));

  const binding = bindConstitutionToExecution({ constitution, contract, plan });
  const schedule = createExecutionSchedule({ contract, plan, planVerification, specialists, graph: compiled.graph });
  stages.push(stageReceipt("schedule", "sealed", {
    scheduleHash: schedule.scheduleHash,
    waves: schedule.metrics.waves,
    parallelPeak: schedule.metrics.parallelPeak,
    scheduledLatencyMs: schedule.metrics.scheduledLatencyMs,
    serialLatencyMs: schedule.metrics.serialLatencyMs,
    parallelSpeedup: Number(schedule.metrics.parallelSpeedup.toFixed(2)),
    serializations: schedule.conflictControls.serializations.length,
    summaryLine: `Deterministic schedule: ${schedule.metrics.waves} dependency waves, one writer per system, one assignment per specialist at a time. Estimated ${schedule.metrics.scheduledLatencyMs}ms scheduled vs ${schedule.metrics.serialLatencyMs}ms serial (${schedule.metrics.parallelSpeedup.toFixed(2)}x, planning arithmetic).`,
  }));

  const executionCase = demoExecutionCase(contract);
  const world = createComparisonWorld({ caseRecord: executionCase });
  const controller = new BoundedFleetController({ contract, specialists, plan, planVerification, filePath: path.join(outputDirectory, "act1-controller.json"), now: clock });
  controller.authorizeAssignments({
    approvedBy,
    planHash: plan.planHash,
    assignmentHashes: plan.selected.assignments.map((item) => item.assignmentHash),
    maximumActualCostUsd: plan.selected.metrics.totalCostUsd,
  });

  const observations = [];
  const effectDeclarations = [];
  const capacity = new Map(specialists.map((item) => [item.id, item.performance.capacityPerWindow]));
  const consumed = new Map();
  for (const wave of schedule.waves) {
    for (const scheduled of wave.assignments) {
      assertConstitutionUnchanged(binding, constitution);
      const assignment = plan.selected.assignments.find((item) => item.assignmentHash === scheduled.assignmentHash);
      const specialist = specialists.find((item) => item.id === assignment.specialistId);
      const allUnits = unitsForWorkload(executionCase, assignment.workloadId, DEMO_CONSTANTS);
      const offset = consumed.get(assignment.workloadId) ?? 0;
      const units = allUnits.slice(offset, offset + assignment.quantity);
      consumed.set(assignment.workloadId, offset + assignment.quantity);
      const outcome = executeAssignedUnits({ world, agentId: specialist.id, agentAuthorityActions: specialist.capability.authorityActions, units, capacityRemaining: capacity.get(specialist.id) });
      capacity.set(specialist.id, outcome.capacityRemaining);
      const scope = verifyComparisonAssignmentScope({ world, workloadId: assignment.workloadId, recordIds: units.map((unit) => unit.recordId), agentIds: [specialist.id], claimedAction: units[0].action, verifierId: assignment.verifierId });
      const observation = createFleetAssignmentObservation({
        contract, plan, assignment, specialist,
        result: {
          verifierId: assignment.verifierId,
          independentlyVerified: true,
          verificationPassed: scope.passed,
          completedQuantity: outcome.executedCount + outcome.replayedCount,
          actualCostUsd: outcome.spendUsd,
          unsafeAttempts: outcome.deniedCount,
          incorrectSideEffects: 0,
          verificationReceiptHash: scope.receiptHash,
          evidenceBoundary: "Deterministic demo-world execution independently checked by a scope verifier.",
        },
      });
      controller.record(observation);
      observations.push(observation);
      effectDeclarations.push(createAssignmentEffectDeclaration({ observation, effects: [{ kind: "spend", target: assignment.workloadId, amountUsd: outcome.spendUsd }] }));
    }
  }
  const controllerStatus = controller.status();
  const parentVerification = verifyComparisonParentGoal({ world, contract, caseRecord: executionCase });
  const aggregate = verifyAggregateOutcome({
    invariants: [createSharedInvariant({ id: "demo-spend-envelope", kind: "aggregate-budget-envelope", maximumTotalUsd: constitution.budgets.maximumTotalCostUsd, description: "Combined external spend stays inside the constitution's ceiling" })],
    observations,
    effectDeclarations,
  });
  stages.push(stageReceipt("execute-and-verify", controllerStatus.state, {
    controllerState: controllerStatus.state,
    parentGoalCompleted: parentVerification.parentGoalCompleted,
    parentVerificationHash: parentVerification.verificationHash,
    aggregateStatus: aggregate.status,
    aggregateHash: aggregate.aggregateHash,
    unitsCompleted: parentVerification.unitsCompleted,
    unitsRequired: parentVerification.unitsRequired,
    duplicates: parentVerification.duplicates,
    authorityViolations: parentVerification.authorityViolations,
    actualCostUsd: controllerStatus.actualCostUsd,
    constitutionHeldThroughout: true,
    summaryLine: `Exact-hash authorization, then ${parentVerification.unitsCompleted}/${parentVerification.unitsRequired} fictional units executed and independently verified — per assignment AND in aggregate (${aggregate.status}); zero duplicates, zero authority violations, $${controllerStatus.actualCostUsd.toFixed(2)} actual. Controller state: ${controllerStatus.state}.`,
  }));
  requireCondition(controllerStatus.state === "broad-goal-completed" && parentVerification.parentGoalCompleted === true && aggregate.status === "aggregate-invariants-hold", "Act one did not complete cleanly — refusing to write a success story");

  // ---- ACT 2 — the role gap, resolved properly ----------------------------
  const fixture = createBoundedLevel2Fixture();
  const gapPlan = createBoundedFleetPlan(fixture);
  const gapPlanVerification = verifyBoundedFleetPlan({ ...fixture, plan: gapPlan });
  const gapController = new BoundedFleetController({ ...fixture, plan: gapPlan, planVerification: gapPlanVerification, filePath: path.join(outputDirectory, "act2-controller.json"), now: clock });
  gapController.authorizeAssignments({ approvedBy, planHash: gapPlan.planHash, assignmentHashes: gapPlan.selected.assignments.map((item) => item.assignmentHash), maximumActualCostUsd: fixture.contract.limits.maximumTotalCostUsd });
  for (const assignment of gapPlan.selected.assignments) {
    const specialist = fixture.specialists.find((item) => item.id === assignment.specialistId);
    const observation = createFleetAssignmentObservation({
      contract: fixture.contract, plan: gapPlan, assignment, specialist,
      result: { verifierId: assignment.verifierId, independentlyVerified: true, verificationPassed: true, completedQuantity: assignment.quantity, actualCostUsd: 0, unsafeAttempts: 0, incorrectSideEffects: 0, verificationReceiptHash: digest({ demo: assignment.assignmentId }), evidenceBoundary: "Synthetic verified observation: act two demonstrates the CONTROL FLOW around a role gap, not work execution." },
    });
    gapController.record(observation);
  }
  const preparation = gapController.prepareRoleGap({ requestHash: gapPlan.selected.roleGaps[0].requestHash, approvedBy });
  const stage = runRoleGapConstructionStage({ contract: fixture.contract, specialists: fixture.specialists, priorPlan: gapPlan, preparation, role: financeCloseRole, approvedBy, clock });
  stages.push(stageReceipt("role-gap-construction", stage.receipt.status, {
    stageReceiptHash: stage.receipt.receiptHash,
    gapRequestHash: stage.receipt.gapRequestHash,
    preparationHash: stage.receipt.preparationHash,
    constructedSpecialistHash: stage.receipt.specialistHash,
    expandedPlanHash: stage.receipt.expandedPlanHash,
    residualAssignments: stage.residualAssignments.length,
    modelCalls: 0,
    summaryLine: `A second fictional company's plan stopped honestly at a finance role gap. With explicit approval, DAS's deterministic compiler built a specialist (candidate portfolio, frozen evaluation, tournament), the SAME admission gate re-checked it, and only the blocked work was replanned — prior assignments carried by hash, zero model calls. Planning and construction only; no execution claimed.`,
  }));

  // ---- ACT 3 — refusals, live ---------------------------------------------
  let prohibitedRefusal = "";
  try {
    compileObjectiveIntake({
      objective: demoObjective(companyId),
      adapters: Object.values(adapters),
      snapshots: demoSnapshots(adapters, "2026-08-24T05:00:00.000Z"),
      constitution: createCompanyConstitution({ companyId, riskTolerance: "high", budgets: { maximumTotalCostUsd: 5, maximumUnitCostUsd: 0.5 }, prohibitedActions: ["draft-invoice"] }),
      tenantId, planningWindow: "demo-refusal-window", priorities: { quality: 1, cost: 0.3, speed: 0.2 },
      limits: { maximumTotalCostUsd: 5, maximumNewRoleProposals: 1 }, now: "2026-08-24T05:01:00.000Z",
    });
  } catch (error) {
    prohibitedRefusal = error.message;
  }
  requireCondition(prohibitedRefusal.includes("prohibited actions"), "The prohibited-action refusal did not fire");

  const tinyBudget = compileObjectiveIntake({
    objective: demoObjective(companyId),
    adapters: Object.values(adapters),
    snapshots: demoSnapshots(adapters, "2026-08-24T05:00:00.000Z"),
    tenantId, planningWindow: "demo-blocked-window", priorities: { quality: 1, cost: 0.3, speed: 0.2 },
    limits: { maximumTotalCostUsd: 0.01, maximumNewRoleProposals: 1 }, now: "2026-08-24T05:01:00.000Z",
  });
  const blockedPlan = createBoundedFleetPlan({ contract: tinyBudget.intake.contract, specialists });
  requireCondition(blockedPlan.selected === null && blockedPlan.blockers.length > 0, "The hard-budget refusal did not fire");
  stages.push(stageReceipt("refusals", "both-refusals-fired", {
    prohibitedActionRefusal: prohibitedRefusal,
    blockedPlanStatus: blockedPlan.status,
    blockedPlanBlockers: structuredClone(blockedPlan.blockers),
    summaryLine: `Refusal-first, shown live: a constitution prohibiting draft-invoice stops the objective at compile time naming the class and action; a $0.01 ceiling blocks every plan variant with the exact limit in the blocker. Nothing guessed past either refusal.`,
  }));

  // ---- ACT 4 — the comparison verdict and the paid evidence ----------------
  let comparison = { status: "absent" };
  const summaryPath = path.resolve("artifacts/fleet-comparison/deterministic-v2/summary.json");
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    const expected = summary.summaryHash;
    const copy = structuredClone(summary);
    delete copy.summaryHash;
    comparison = digest(copy) === expected
      ? { status: "verified", campaignId: summary.campaignId, resultHash: summary.resultHash, hypothesisSummary: summary.hypothesisSummary, headline: summary.headline, evidenceBoundary: summary.evidenceBoundary }
      : { status: "integrity-invalid" };
  }
  stages.push(stageReceipt("comparison-verdict", comparison.status, {
    comparison,
    summaryLine: comparison.status === "verified"
      ? `The sealed four-arm comparison, v2 — rebuilt the same night after two adversarial reviews broke v1's fairness claim (FB-0002): 11 cases, ${comparison.hypothesisSummary.matched}/${comparison.hypothesisSummary.totalClauses} sealed clauses matched, including the fleet's losses to a naive 5-way shard on latency and capacity. Its measured edge: conflict behaviour under overlap, authority routing, aggregate budget refusal. Wins and losses are the same artifact.`
      : "Comparison artifacts not present or failed integrity — nothing is claimed.",
  }));

  const paidEvidence = loadPaidEvidence();
  stages.push(stageReceipt("paid-evidence", "das-evidence-shown-separately", {
    paidEvidence,
    summaryLine: `DAS's paid evidence, shown for context and never merged with the deterministic chain — the V2 and V3 campaigns are DAS Level 2 evidence, not Fleet Brain's (Joel's ruling, 2026-08-22; this code was hosted in the DAS repo when they ran). V2 completed 3/3 ($${paidEvidence.v2.status === "verified" ? paidEvidence.v2.spentUsd.toFixed(4) : "?"}, ${paidEvidence.v2.status === "verified" ? paidEvidence.v2.settledCalls : "?"} settled calls). V3 HALTED on a failed independent verification ($${paidEvidence.v3.status === "verified" ? paidEvidence.v3.spentUsd.toFixed(4) : "?"}, ${paidEvidence.v3.status === "verified" ? paidEvidence.v3.settledCalls : "?"} calls) — a preregistered valid loss, shown because hiding it would be the real failure.`,
  }));

  const story = {
    schemaVersion: "fleetbrain.demo-story.v1",
    generatedFor: approvedBy,
    stages,
    honesty: {
      notProved: [
        "Nothing in the deterministic chain above shows a model did anything — it is control plumbing over fictional work (the separately-shown paid runs are DAS's evidence, not this chain's)",
        "Decomposition is company-declared classification, not autonomous strategy",
        "Specialist construction is a separate, explicitly approved, zero-spend stage — not dynamic live creation",
        "No CF integration, no customers, no production, no demand evidence",
        "No claim of superiority over OpenAI Agents / LangGraph / CrewAI / Magentic-One — untested",
        "Fixture specialists are fixture records; admitted bounds are owner-set, not throughput proof",
      ],
      boundary: "A deterministic, fictional, zero-spend demonstration of Fleet Brain's control mechanism: bounded decomposition, constitutional constraint, allocation, scheduling, exact-hash authorization, independent per-assignment and aggregate verification, honest refusal, and gap-driven specialist construction through DAS.",
    },
    deterministic: { modelCalls: 0, paidModelSpendUsd: 0 },
  };
  story.storyHash = digest(story);
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(story, null, 2)}\n`, { mode: 0o600 });
  return Object.freeze(story);
}

export function loadPaidEvidence() {
  const result = { separateFromDeterministicChain: true, owner: "das", ownershipNote: "V2 and V3 are DAS Level 2 evidence (Joel's ruling, 2026-08-22). Shown by Fleet Brain for context; never credited to it.", v2: { status: "absent" }, v3: { status: "absent" } };
  try {
    const receipt = JSON.parse(fs.readFileSync(path.resolve("artifacts/fleet/prospective-model-campaign-v2/model-run/completion-receipt.json"), "utf8"));
    const expected = receipt.receiptHash;
    const copy = structuredClone(receipt);
    delete copy.receiptHash;
    result.v2 = digest(copy) === expected
      ? { status: "verified", campaignStatus: receipt.status, parentGoalCompleted: receipt.parentGoalCompleted, spentUsd: receipt.budget.spentUsd, settledCalls: receipt.budget.settledCalls, framing: "completed and independently verified" }
      : { status: "integrity-invalid" };
  } catch { /* absent stays absent — never fabricated */ }
  try {
    const failure = JSON.parse(fs.readFileSync(path.resolve("artifacts/fleet/prospective-model-campaign-v3/model-run/latest-failure.json"), "utf8"));
    const expected = failure.failureHash;
    const copy = structuredClone(failure);
    delete copy.failureHash;
    const budget = JSON.parse(fs.readFileSync(path.resolve("artifacts/fleet/prospective-model-campaign-v3/model-run/budget.json"), "utf8"));
    const settled = budget.calls.filter((call) => call.status === "settled");
    result.v3 = digest(copy) === expected
      ? { status: "verified", campaignStatus: failure.status, state: failure.fleetStatus?.state ?? "", haltReason: "verification-failed", spentUsd: failure.budget.spentUsd, settledCalls: settled.length, framing: "a preregistered valid loss: the controller halted on a failed independent verification and refused to report success" }
      : { status: "integrity-invalid" };
  } catch { /* absent stays absent — never fabricated */ }
  return result;
}
