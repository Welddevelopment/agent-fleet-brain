import { digest } from "../core/canonical.js";
import { assertBoundedFleetContract, assertBoundedSpecialistRecord } from "./bounded-level2-contract.js";
import { assertBoundedFleetPlan, specialistCompatibility } from "./bounded-level2-planner.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function verifyBoundedFleetPlan({ contract, specialists, plan }) {
  assertBoundedFleetContract(contract);
  assertBoundedFleetPlan(plan);
  specialists.forEach(assertBoundedSpecialistRecord);
  requireCondition(plan.contractHash === contract.contractHash, "Fleet plan belongs to another workload contract");
  const specialistById = new Map(specialists.map((item) => [item.id, item]));
  const workloadById = new Map(contract.workload.map((item) => [item.id, item]));
  const assignedByWorkload = new Map();
  const capacityBySpecialist = new Map();
  let calculatedCost = 0;
  let incompatibleAssignments = 0;
  let changedHashes = 0;
  const assignmentIds = new Set();
  for (const assignment of plan.selected?.assignments ?? []) {
    const item = workloadById.get(assignment.workloadId);
    const specialist = specialistById.get(assignment.specialistId);
    if (!item || !specialist) { incompatibleAssignments += 1; continue; }
    const assignmentCopy = structuredClone(assignment);
    const assignmentHash = assignmentCopy.assignmentHash;
    delete assignmentCopy.assignmentHash;
    if (!assignment.assignmentId || assignmentIds.has(assignment.assignmentId) || digest(assignmentCopy) !== assignmentHash) changedHashes += 1;
    assignmentIds.add(assignment.assignmentId);
    if (assignment.specialistHash !== specialist.specialistHash) changedHashes += 1;
    if (!specialistCompatibility(specialist, item).compatible || assignment.verifierId !== item.requirement.verifierId) incompatibleAssignments += 1;
    assignedByWorkload.set(item.id, (assignedByWorkload.get(item.id) ?? 0) + assignment.quantity);
    capacityBySpecialist.set(specialist.id, (capacityBySpecialist.get(specialist.id) ?? 0) + assignment.quantity);
    calculatedCost += assignment.quantity * specialist.performance.meanUnitCostUsd;
  }
  const gapsByWorkload = new Map();
  for (const gap of plan.selected?.roleGaps ?? []) {
    if (gap.status !== "awaiting-explicit-human-approval" || Object.values(gap.compilerAuthority ?? {}).some(Boolean)) incompatibleAssignments += 1;
    for (const item of gap.workloads ?? []) gapsByWorkload.set(item.id, (gapsByWorkload.get(item.id) ?? 0) + item.volume);
  }
  const exactCoverage = contract.workload.every((item) => (assignedByWorkload.get(item.id) ?? 0) + (gapsByWorkload.get(item.id) ?? 0) === item.volume);
  const noDoubleRoute = contract.workload.every((item) => (assignedByWorkload.get(item.id) ?? 0) <= item.volume && (gapsByWorkload.get(item.id) ?? 0) <= item.volume);
  const capacityRespected = [...capacityBySpecialist].every(([id, volume]) => volume <= specialistById.get(id).performance.capacityPerWindow);
  const costExact = Math.abs(calculatedCost - Number(plan.selected?.metrics.totalCostUsd ?? 0)) < 1e-9;
  const hardBudgetRespected = calculatedCost <= contract.limits.maximumTotalCostUsd;
  const roleProposalLimitRespected = (plan.selected?.roleGaps.length ?? 0) <= contract.limits.maximumNewRoleProposals;
  const noAuthorityEscalation = Object.values(plan.authority).every((item) => item === false);
  const checks = { exactCoverage, noDoubleRoute, capacityRespected, costExact, hardBudgetRespected, roleProposalLimitRespected, noAuthorityEscalation, noIncompatibleAssignments: incompatibleAssignments === 0, specialistIdentityIntact: changedHashes === 0 };
  const verification = {
    schemaVersion: "das.bounded-fleet-verification.v1",
    verifierId: "bounded-level2-independent-plan-verifier-v1",
    independent: true,
    passed: Object.values(checks).every(Boolean),
    checks,
    assignmentCount: plan.selected?.assignments.length ?? 0,
    roleGapCount: plan.selected?.roleGaps.length ?? 0,
    calculatedCostUsd: calculatedCost,
    contractHash: contract.contractHash,
    planHash: plan.planHash,
  };
  verification.verificationHash = digest(verification);
  return Object.freeze(verification);
}
