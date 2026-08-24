import path from "node:path";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { createBoundedFleetContract } from "./bounded-level2-contract.js";
import { BoundedFleetController, createFleetAssignmentObservation } from "./bounded-level2-controller.js";
import { createBoundedFleetPlan } from "./bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "./bounded-level2-verifier.js";
import { executeAssignedUnits, unitsForWorkload } from "./comparison-work-engine.js";
import { verifyComparisonAssignmentScope } from "./comparison-world.js";

// The three arms. One signature shape, one work engine, one world API — each arm
// is nothing but a coordination policy:
//
//   general  — one strong agent, everything serial, honors the explicit cost limit.
//   static   — a frozen roster and a frozen mapping; no gap detection, no replanning.
//   adaptive — the existing bounded fleet pipeline VERBATIM: contract -> plan ->
//              independent verification -> exact-hash authorization -> durable
//              controller -> observations. Nothing is added that the shipped
//              modules do not already do; where the adaptive arm genuinely lacks a
//              control (cross-assignment conflict detection, company invariants),
//              it loses, and the loss is the result.

function armRunRecord(fields) {
  const record = {
    schemaVersion: "fleetbrain.comparison-arm-run.v1",
    ...fields,
  };
  record.armRunHash = digest(record);
  return Object.freeze(record);
}

function lanesFrom(agentLanes, activationLatencyMs) {
  const lanes = [...agentLanes.entries()]
    .map(([agentId, lane]) => ({ agentId, unitCount: lane.unitCount, laneLatencyMs: activationLatencyMs + lane.workLatencyMs }))
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
  return { lanes, latencyProxyMs: lanes.length ? Math.max(...lanes.map((lane) => lane.laneLatencyMs)) : 0 };
}

export function runGeneralAgentArm({ caseRecord, contract, roster, world, constants }) {
  const agent = roster.generalAgent;
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
      if (spendUsd + unit.unitCostUsd > contract.limits.maximumTotalCostUsd) {
        interventions.push({ kind: "budget-halt", detail: `Next unit ${unit.recordId} would exceed the explicit hard cost limit of $${contract.limits.maximumTotalCostUsd}` });
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

  const scopesPassed = scopeVerifications.length === contract.workload.length && scopeVerifications.every((receipt) => receipt.passed);
  const claimedCompleted = !halted && scopesPassed;
  const { lanes, latencyProxyMs } = lanesFrom(new Map([[agent.id, { unitCount: unitsCompleted, workLatencyMs }]]), constants.activationOverhead.latencyMs);
  const coordinationOverheadUsd = constants.activationOverhead.costUsd;
  return armRunRecord({
    armId: "general",
    policyDescription: "One strong general agent with every permitted tool: everything serial, one activation, per-scope verification before claiming, honors the explicit hard cost limit.",
    activatedAgents: [{ agentId: agent.id, unitsCompleted }],
    lanes,
    latencyProxyMs,
    coordinationOverheadUsd,
    effectSpendUsd: Number(spendUsd.toFixed(10)),
    totalCostUsd: Number((spendUsd + coordinationOverheadUsd).toFixed(10)),
    claimedCompleted,
    claimReason: claimedCompleted ? "every-unit-executed-and-scope-verified" : halted ? interventions[interventions.length - 1].kind : "scope-verification-failed",
    interventions,
    refusal: null,
    scopeVerifications,
  });
}

export function runStaticFleetArm({ caseRecord, contract, roster, staticMapping, world, constants }) {
  const scopeVerifications = [];
  const agentLanes = new Map(roster.specialists.map((specialist) => [specialist.id, { unitCount: 0, workLatencyMs: 0 }]));
  const capacity = new Map(roster.specialists.map((specialist) => [specialist.id, specialist.performance.capacityPerWindow]));
  const byId = new Map(roster.specialists.map((specialist) => [specialist.id, specialist]));
  let spendUsd = 0;
  let mappedClassesClean = true;

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
    const lane = agentLanes.get(agentId);
    lane.unitCount += outcome.executedCount + outcome.replayedCount;
    lane.workLatencyMs += outcome.workLatencyMs;
    if (outcome.deniedCount > 0 || outcome.notAttemptedCount > 0) mappedClassesClean = false;
    scopeVerifications.push(verifyComparisonAssignmentScope({
      world,
      workloadId: item.id,
      recordIds: caseRecord.workloadUnits[item.id],
      agentIds: [agentId],
      claimedAction: item.requirement.authorityActions[0],
      verifierId: item.requirement.verifierId,
    }));
  }

  // A standing team is the definition of a static fleet: the whole roster is
  // activated every window, whether or not its class showed up.
  const activatedAgents = roster.specialists.map((specialist) => ({ agentId: specialist.id, unitsCompleted: agentLanes.get(specialist.id).unitCount }));
  const { lanes, latencyProxyMs } = lanesFrom(agentLanes, constants.activationOverhead.latencyMs);
  const coordinationOverheadUsd = Number((roster.specialists.length * constants.activationOverhead.costUsd).toFixed(10));
  const claimedCompleted = mappedClassesClean;
  return armRunRecord({
    armId: "static",
    policyDescription: "A frozen predefined fleet: the full roster activates every window, each mapped class goes to its mapped agent, unmapped work is invisible, and nothing replans. Its pathology is silence.",
    activatedAgents,
    lanes,
    latencyProxyMs,
    coordinationOverheadUsd,
    effectSpendUsd: Number(spendUsd.toFixed(10)),
    totalCostUsd: Number((spendUsd + coordinationOverheadUsd).toFixed(10)),
    claimedCompleted,
    claimReason: claimedCompleted ? "every-mapped-unit-succeeded" : "denials-or-capacity-in-mapped-classes",
    interventions: [],
    refusal: null,
    scopeVerifications,
  });
}

export function runAdaptiveFleetArm({ caseRecord, contract, roster, world, constants, stateDirectory }) {
  const specialists = roster.specialists;
  const plan = createBoundedFleetPlan({ contract, specialists });
  const planVerification = verifyBoundedFleetPlan({ contract, specialists, plan });

  if (!plan.selected) {
    // The refusal path: the planner blocked on the bounded limits. No controller is
    // constructed, no agent activates, nothing touches the world.
    return armRunRecord({
      armId: "adaptive",
      policyDescription: "The existing bounded fleet pipeline verbatim: plan, independent verification, exact-hash authorization, durable controller, independent observations.",
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
        incorrectSideEffects: 0,
        verificationReceiptHash: scope.receiptHash,
        evidenceBoundary: "Deterministic comparison-world execution independently checked by a scope verifier.",
      },
    });
    controller.record(observation);
    const state = controller.status().state;
    if (state === "halted") {
      interventions.push({ kind: "controller-halt", detail: `Controller halted after ${assignment.assignmentId}` });
      break;
    }
  }

  const status = controller.status();
  const activatedAgents = [...agentLanes.entries()].map(([agentId, lane]) => ({ agentId, unitsCompleted: lane.unitCount })).sort((left, right) => left.agentId.localeCompare(right.agentId));
  const { lanes, latencyProxyMs } = lanesFrom(agentLanes, constants.activationOverhead.latencyMs);
  const coordinationOverheadUsd = Number((agentLanes.size * constants.activationOverhead.costUsd).toFixed(10));
  return armRunRecord({
    armId: "adaptive",
    policyDescription: "The existing bounded fleet pipeline verbatim: plan, independent verification, exact-hash authorization, durable controller, independent observations. The completion claim is the controller's status, nothing else.",
    activatedAgents,
    lanes,
    latencyProxyMs,
    coordinationOverheadUsd,
    effectSpendUsd: Number(spendUsd.toFixed(10)),
    totalCostUsd: Number((spendUsd + coordinationOverheadUsd).toFixed(10)),
    claimedCompleted: status.parentGoalCompleted === true,
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
