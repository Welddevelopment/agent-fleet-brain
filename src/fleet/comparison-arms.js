import path from "node:path";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { BoundedFleetController, createFleetAssignmentObservation } from "./bounded-level2-controller.js";
import { createBoundedFleetPlan } from "./bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "./bounded-level2-verifier.js";
import { executeAssignedUnits, unitsForWorkload } from "./comparison-work-engine.js";
import { verifyComparisonAssignmentScope } from "./comparison-world.js";

// The four arms. One signature shape, one work engine, one world API, ONE CLAIM
// RULE — each arm is nothing but a coordination policy:
//
//   general  — one strong agent, serial, with the same aggregate budget pre-check
//              the planner has (v1 denied it that one-line competence; fixed).
//   sharded  — N clones of the general agent, work dealt round-robin, zero
//              coordination machinery. The strong simpler baseline v1 lacked.
//   static   — a frozen roster and a frozen mapping; no gap detection, no replanning.
//   adaptive — the shipped planner, verifier and controller unmodified, driven by
//              harness-constructed observations (the record-to-specialist partition
//              is a harness bridge — the shipped planner allocates quantities, not
//              records; stated here because calling this arm "verbatim" overstated it).
//
// v1 -> v2 changes, all from the adversarial fairness review (FB-0002):
//   unified claim rule: an arm claims completion iff nothing halted or refused AND
//     every scope receipt it holds passed (v1's static arm ignored its own failing
//     receipt, manufacturing a false completion in C1);
//   activation is charged per agent that actually received work, in every arm
//     (v1 charged 1x/3x/5x against the same roster);
//   the general agents run the planner's aggregate budget pre-check;
//   arm run records carry rosterAvailable so idle capacity is scored against the
//     roster an arm HOLDS, not the list it chose to report.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function armRunRecord(fields) {
  const record = { schemaVersion: "fleetbrain.comparison-arm-run.v2", ...fields };
  record.armRunHash = digest(record);
  return Object.freeze(record);
}

function lanesFrom(agentLanes, activationLatencyMs) {
  const lanes = [...agentLanes.entries()]
    .map(([agentId, lane]) => ({ agentId, unitCount: lane.unitCount, laneLatencyMs: activationLatencyMs + lane.workLatencyMs }))
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
  return { lanes, latencyProxyMs: lanes.length ? Math.max(...lanes.map((lane) => lane.laneLatencyMs)) : 0 };
}

// The one claim rule, applied to every arm: claim completion only when nothing
// halted or refused and every held scope receipt passed. Which scopes an arm
// verifies remains its coordination policy; believing its own verifier does not.
function unifiedClaim({ halted, refusal, scopeVerifications }) {
  if (halted || refusal) return false;
  return scopeVerifications.length > 0 && scopeVerifications.every((receipt) => receipt.passed);
}

function plannedUnitSpend(caseRecord, contract, constants) {
  return contract.workload.reduce((sum, item) => sum + unitsForWorkload(caseRecord, item.id, constants).reduce((inner, unit) => inner + unit.unitCostUsd, 0), 0);
}

function budgetRefusalRecord({ armId, policyDescription, plannedUsd, limitUsd, rosterAvailable }) {
  return armRunRecord({
    armId,
    policyDescription,
    rosterAvailable,
    activatedAgents: [],
    lanes: [],
    latencyProxyMs: 0,
    coordinationOverheadUsd: 0,
    effectSpendUsd: 0,
    totalCostUsd: 0,
    claimedCompleted: false,
    claimReason: "aggregate-budget-refusal",
    interventions: [{ kind: "aggregate-budget-refusal", detail: `Planned unit spend $${plannedUsd.toFixed(2)} exceeds the explicit hard cost limit of $${limitUsd}` }],
    refusal: { blockers: [{ code: "aggregate-budget-precheck", plannedUsd: Number(plannedUsd.toFixed(10)), limitUsd }] },
    scopeVerifications: [],
  });
}

export function runGeneralAgentArm({ caseRecord, contract, roster, world, constants }) {
  const agent = roster.generalAgent;
  const policyDescription = "One strong general agent with every permitted tool: everything serial, one activation, per-scope verification before claiming, and the same aggregate budget pre-check the planner has.";
  const plannedUsd = plannedUnitSpend(caseRecord, contract, constants);
  if (plannedUsd > contract.limits.maximumTotalCostUsd) {
    return budgetRefusalRecord({ armId: "general", policyDescription, plannedUsd, limitUsd: contract.limits.maximumTotalCostUsd, rosterAvailable: 1 });
  }
  const scopeVerifications = [];
  const interventions = [];
  let spendUsd = 0;
  let workLatencyMs = 0;
  let unitsCompleted = 0;
  let capacityRemaining = agent.capacityPerWindow;
  let halted = false;

  for (const item of contract.workload) {
    if (halted) break;
    const units = unitsForWorkload(caseRecord, item.id, constants);
    for (const unit of units) {
      if (capacityRemaining <= 0) {
        interventions.push({ kind: "capacity-halt", detail: `Capacity ${agent.capacityPerWindow} exhausted before ${unit.recordId}` });
        halted = true;
        break;
      }
      const outcome = executeAssignedUnits({ world, agentId: agent.id, agentAuthorityActions: agent.capability.authorityActions, units: [unit], capacityRemaining });
      capacityRemaining = outcome.capacityRemaining;
      spendUsd += outcome.spendUsd;
      workLatencyMs += outcome.workLatencyMs;
      unitsCompleted += outcome.executedCount + outcome.replayedCount;
    }
    if (!halted) {
      scopeVerifications.push(verifyComparisonAssignmentScope({
        world,
        workloadId: item.id,
        recordIds: caseRecord.workloadUnits[item.id],
        agentIds: [agent.id],
        claimedAction: item.requirement.authorityActions[0],
        verifierId: item.requirement.verifierId,
      }));
    }
  }

  const claimedCompleted = unifiedClaim({ halted, refusal: null, scopeVerifications });
  const { lanes, latencyProxyMs } = lanesFrom(new Map([[agent.id, { unitCount: unitsCompleted, workLatencyMs }]]), constants.activationOverhead.latencyMs);
  const coordinationOverheadUsd = constants.activationOverhead.costUsd;
  return armRunRecord({
    armId: "general",
    policyDescription,
    rosterAvailable: 1,
    activatedAgents: [{ agentId: agent.id, unitsCompleted }],
    lanes,
    latencyProxyMs,
    coordinationOverheadUsd,
    effectSpendUsd: Number(spendUsd.toFixed(10)),
    totalCostUsd: Number((spendUsd + coordinationOverheadUsd).toFixed(10)),
    claimedCompleted,
    claimReason: claimedCompleted ? "all-scope-receipts-passed" : halted ? interventions[interventions.length - 1].kind : "scope-verification-failed",
    interventions,
    refusal: null,
    scopeVerifications,
  });
}

export function runShardedGeneralAgentsArm({ caseRecord, contract, roster, world, constants }) {
  const cloneCount = roster.specialists.length;
  const policyDescription = `${cloneCount} clones of the general agent with work dealt round-robin by record: zero planning, zero routing intelligence, zero conflict awareness. The strong simpler baseline — what a team gets by hiring generalists and splitting the pile.`;
  const plannedUsd = plannedUnitSpend(caseRecord, contract, constants);
  if (plannedUsd > contract.limits.maximumTotalCostUsd) {
    return budgetRefusalRecord({ armId: "sharded", policyDescription, plannedUsd, limitUsd: contract.limits.maximumTotalCostUsd, rosterAvailable: cloneCount });
  }
  const cloneIds = Array.from({ length: cloneCount }, (_, index) => `${roster.generalAgent.id}-clone-${index + 1}`);
  const unitsByClone = new Map(cloneIds.map((id) => [id, []]));
  let streamIndex = 0;
  for (const item of contract.workload) {
    for (const unit of unitsForWorkload(caseRecord, item.id, constants)) {
      unitsByClone.get(cloneIds[streamIndex % cloneCount]).push(unit);
      streamIndex += 1;
    }
  }
  const agentLanes = new Map();
  let spendUsd = 0;
  for (const cloneId of cloneIds) {
    const units = unitsByClone.get(cloneId);
    if (units.length === 0) continue;
    const outcome = executeAssignedUnits({ world, agentId: cloneId, agentAuthorityActions: roster.generalAgent.capability.authorityActions, units, capacityRemaining: roster.generalAgent.capacityPerWindow });
    spendUsd += outcome.spendUsd;
    agentLanes.set(cloneId, { unitCount: outcome.executedCount + outcome.replayedCount, workLatencyMs: outcome.workLatencyMs });
  }
  const scopeVerifications = contract.workload.map((item) => verifyComparisonAssignmentScope({
    world,
    workloadId: item.id,
    recordIds: caseRecord.workloadUnits[item.id],
    agentIds: cloneIds,
    claimedAction: item.requirement.authorityActions[0],
    verifierId: item.requirement.verifierId,
  }));
  const claimedCompleted = unifiedClaim({ halted: false, refusal: null, scopeVerifications });
  const { lanes, latencyProxyMs } = lanesFrom(agentLanes, constants.activationOverhead.latencyMs);
  const coordinationOverheadUsd = Number((agentLanes.size * constants.activationOverhead.costUsd).toFixed(10));
  return armRunRecord({
    armId: "sharded",
    policyDescription,
    rosterAvailable: cloneCount,
    activatedAgents: [...agentLanes.entries()].map(([agentId, lane]) => ({ agentId, unitsCompleted: lane.unitCount })).sort((left, right) => left.agentId.localeCompare(right.agentId)),
    lanes,
    latencyProxyMs,
    coordinationOverheadUsd,
    effectSpendUsd: Number(spendUsd.toFixed(10)),
    totalCostUsd: Number((spendUsd + coordinationOverheadUsd).toFixed(10)),
    claimedCompleted,
    claimReason: claimedCompleted ? "all-scope-receipts-passed" : "scope-verification-failed",
    interventions: [],
    refusal: null,
    scopeVerifications,
  });
}

export function runStaticFleetArm({ caseRecord, contract, roster, staticMapping, world, constants }) {
  const scopeVerifications = [];
  const agentLanes = new Map();
  const capacity = new Map(roster.specialists.map((specialist) => [specialist.id, specialist.performance.capacityPerWindow]));
  const byId = new Map(roster.specialists.map((specialist) => [specialist.id, specialist]));
  let spendUsd = 0;
  let halted = false;

  for (const item of contract.workload) {
    const agentId = staticMapping.classAgent[item.id];
    if (!agentId) continue; // Invisible: the mapping predates this class and cannot see it.
    const specialist = byId.get(agentId);
    const units = unitsForWorkload(caseRecord, item.id, constants);
    const outcome = executeAssignedUnits({
      world,
      agentId,
      agentAuthorityActions: specialist.capability.authorityActions,
      units,
      capacityRemaining: capacity.get(agentId),
    });
    capacity.set(agentId, outcome.capacityRemaining);
    spendUsd += outcome.spendUsd;
    if (!agentLanes.has(agentId)) agentLanes.set(agentId, { unitCount: 0, workLatencyMs: 0 });
    const lane = agentLanes.get(agentId);
    lane.unitCount += outcome.executedCount + outcome.replayedCount;
    lane.workLatencyMs += outcome.workLatencyMs;
    scopeVerifications.push(verifyComparisonAssignmentScope({
      world,
      workloadId: item.id,
      recordIds: caseRecord.workloadUnits[item.id],
      agentIds: [agentId],
      claimedAction: item.requirement.authorityActions[0],
      verifierId: item.requirement.verifierId,
    }));
  }

  const claimedCompleted = unifiedClaim({ halted, refusal: null, scopeVerifications });
  const { lanes, latencyProxyMs } = lanesFrom(agentLanes, constants.activationOverhead.latencyMs);
  const coordinationOverheadUsd = Number((agentLanes.size * constants.activationOverhead.costUsd).toFixed(10));
  return armRunRecord({
    armId: "static",
    policyDescription: "A frozen predefined fleet: each mapped class goes to its mapped agent, unmapped work is invisible, nothing replans. It believes its own verifier like every other arm; its pathology is the map, not the claim rule.",
    rosterAvailable: roster.specialists.length,
    activatedAgents: [...agentLanes.entries()].map(([agentId, lane]) => ({ agentId, unitsCompleted: lane.unitCount })).sort((left, right) => left.agentId.localeCompare(right.agentId)),
    lanes,
    latencyProxyMs,
    coordinationOverheadUsd,
    effectSpendUsd: Number(spendUsd.toFixed(10)),
    totalCostUsd: Number((spendUsd + coordinationOverheadUsd).toFixed(10)),
    claimedCompleted,
    claimReason: claimedCompleted ? "all-scope-receipts-passed" : "scope-verification-failed-or-work-unattempted",
    interventions: [],
    refusal: null,
    scopeVerifications,
  });
}

export function runAdaptiveFleetArm({ caseRecord, contract, roster, world, constants, stateDirectory }) {
  const specialists = roster.specialists;
  const plan = createBoundedFleetPlan({ contract, specialists });
  const planVerification = verifyBoundedFleetPlan({ contract, specialists, plan });
  const policyDescription = "The shipped planner, independent verifier and durable controller, unmodified, driven by harness-constructed observations. The record-to-specialist partition is a harness bridge; the shipped planner allocates quantities, not records.";

  if (!plan.selected) {
    return armRunRecord({
      armId: "adaptive",
      policyDescription,
      rosterAvailable: specialists.length,
      activatedAgents: [],
      lanes: [],
      latencyProxyMs: 0,
      coordinationOverheadUsd: 0,
      effectSpendUsd: 0,
      totalCostUsd: 0,
      claimedCompleted: false,
      claimReason: "plan-blocked-by-bounded-limits",
      interventions: plan.blockers.map((blocker) => ({ kind: `plan-blocker:${blocker.code}`, detail: JSON.stringify(blocker) })),
      refusal: { blockers: structuredClone(plan.blockers) },
      scopeVerifications: [],
      adaptiveEvidence: { planHash: plan.planHash, planStatus: plan.status, planVerificationHash: planVerification.verificationHash ?? "", controllerStatusState: "never-constructed" },
    });
  }

  const controller = new BoundedFleetController({
    contract,
    specialists,
    plan,
    planVerification,
    filePath: path.join(stateDirectory, `${caseRecord.id}-adaptive-controller.json`),
    now: () => "2026-08-24T04:00:00.000Z",
  });
  controller.authorizeAssignments({
    approvedBy: "fleet-comparison-harness-fictional-owner",
    planHash: plan.planHash,
    assignmentHashes: plan.selected.assignments.map((item) => item.assignmentHash),
    maximumActualCostUsd: plan.selected.metrics.totalCostUsd,
  });

  const interventions = plan.selected.roleGaps.map((gap) => ({ kind: "role-gap", detail: `${gap.workloads.map((item) => item.id).join(",")} has no proved specialist; returned for explicit human approval` }));
  const scopeVerifications = [];
  const agentLanes = new Map();
  const capacity = new Map(specialists.map((specialist) => [specialist.id, specialist.performance.capacityPerWindow]));
  const byId = new Map(specialists.map((specialist) => [specialist.id, specialist]));
  const consumedPerWorkload = new Map();
  let spendUsd = 0;
  let halted = false;

  for (const assignment of plan.selected.assignments) {
    const specialist = byId.get(assignment.specialistId);
    const allUnits = unitsForWorkload(caseRecord, assignment.workloadId, constants);
    const offset = consumedPerWorkload.get(assignment.workloadId) ?? 0;
    const units = allUnits.slice(offset, offset + assignment.quantity);
    consumedPerWorkload.set(assignment.workloadId, offset + assignment.quantity);

    const outcome = executeAssignedUnits({
      world,
      agentId: specialist.id,
      agentAuthorityActions: specialist.capability.authorityActions,
      units,
      capacityRemaining: capacity.get(specialist.id),
    });
    capacity.set(specialist.id, outcome.capacityRemaining);
    spendUsd += outcome.spendUsd;
    if (!agentLanes.has(specialist.id)) agentLanes.set(specialist.id, { unitCount: 0, workLatencyMs: 0 });
    const lane = agentLanes.get(specialist.id);
    lane.unitCount += outcome.executedCount + outcome.replayedCount;
    lane.workLatencyMs += outcome.workLatencyMs;

    const scope = verifyComparisonAssignmentScope({
      world,
      workloadId: assignment.workloadId,
      recordIds: units.map((unit) => unit.recordId),
      agentIds: [specialist.id],
      claimedAction: units[0]?.action ?? "",
      verifierId: assignment.verifierId,
    });
    scopeVerifications.push(scope);

    const observation = createFleetAssignmentObservation({
      contract,
      plan,
      assignment,
      specialist,
      result: {
        verifierId: assignment.verifierId,
        independentlyVerified: true,
        verificationPassed: scope.passed,
        completedQuantity: outcome.executedCount + outcome.replayedCount,
        actualCostUsd: outcome.spendUsd,
        unsafeAttempts: outcome.deniedCount,
        // Not a measurement: no per-assignment side-effect channel exists in this
        // harness, so the controller's halt-on-incorrect-effect control is never
        // exercised here. Declared in the preregistration; world-truth incorrect
        // effects are counted by the independent parent verifier instead.
        incorrectSideEffects: 0,
        verificationReceiptHash: scope.receiptHash,
        evidenceBoundary: "Deterministic comparison-world execution independently checked by a scope verifier.",
      },
    });
    controller.record(observation);
    if (controller.status().state === "halted") {
      interventions.push({ kind: "controller-halt", detail: `Controller halted after ${assignment.assignmentId}` });
      halted = true;
      break;
    }
  }

  const status = controller.status();
  const activatedAgents = [...agentLanes.entries()].map(([agentId, lane]) => ({ agentId, unitsCompleted: lane.unitCount })).sort((left, right) => left.agentId.localeCompare(right.agentId));
  const { lanes, latencyProxyMs } = lanesFrom(agentLanes, constants.activationOverhead.latencyMs);
  const coordinationOverheadUsd = Number((agentLanes.size * constants.activationOverhead.costUsd).toFixed(10));
  // The controller's own completion state and the unified claim rule must agree
  // for a completion claim: the controller adds role-gap awareness the receipts
  // cannot see, and the receipts add scope failures the controller cannot see.
  const claimedCompleted = status.parentGoalCompleted === true && unifiedClaim({ halted, refusal: null, scopeVerifications });
  return armRunRecord({
    armId: "adaptive",
    policyDescription,
    rosterAvailable: specialists.length,
    activatedAgents,
    lanes,
    latencyProxyMs,
    coordinationOverheadUsd,
    effectSpendUsd: Number(spendUsd.toFixed(10)),
    totalCostUsd: Number((spendUsd + coordinationOverheadUsd).toFixed(10)),
    claimedCompleted,
    claimReason: `controller:${status.state}`,
    interventions,
    refusal: null,
    scopeVerifications,
    adaptiveEvidence: {
      planHash: plan.planHash,
      planStatus: plan.status,
      planVerificationHash: planVerification.verificationHash ?? "",
      controllerStatusState: status.state,
    },
  });
}
