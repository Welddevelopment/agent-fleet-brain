import { digest } from "../core/canonical.js";
import { assertBoundedFleetContract, assertBoundedSpecialistRecord } from "./bounded-level2-contract.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(available, required) {
  const set = new Set(available);
  return required.every((item) => set.has(item));
}

export function specialistCompatibility(specialist, item) {
  assertBoundedSpecialistRecord(specialist);
  const requirement = item.requirement;
  const checks = {
    systems: includesAll(specialist.capability.systems, requirement.systems),
    tools: includesAll(specialist.capability.tools, requirement.tools),
    contextSources: includesAll(specialist.capability.contextSources, requirement.contextSources),
    authorityActions: includesAll(specialist.capability.authorityActions, requirement.authorityActions),
    verifier: specialist.capability.verifierId === requirement.verifierId,
    policy: specialist.capability.policyHash === requirement.policyHash,
    quality: specialist.performance.outcomeScore >= item.minimumOutcomeScore,
    unitCost: specialist.performance.meanUnitCostUsd <= item.maximumUnitCostUsd,
    latency: specialist.performance.medianLatencyMs <= item.dueWithinMs,
    safety: specialist.performance.unsafeAttempts === 0 && specialist.performance.passRate === 1,
  };
  return { compatible: Object.values(checks).every(Boolean), checks };
}

function rankingScore(specialist, priorities, strategy) {
  if (strategy === "quality-first") return specialist.performance.outcomeScore * 1_000_000 - specialist.performance.meanUnitCostUsd * 1_000 - specialist.performance.medianLatencyMs / 1_000;
  if (strategy === "cost-first") return -specialist.performance.meanUnitCostUsd * 1_000_000 + specialist.performance.outcomeScore * 1_000 - specialist.performance.medianLatencyMs / 1_000;
  if (strategy === "speed-first") return -specialist.performance.medianLatencyMs * 1_000 + specialist.performance.outcomeScore * 100 - specialist.performance.meanUnitCostUsd;
  return specialist.performance.outcomeScore * priorities.quality * 10_000 - specialist.performance.meanUnitCostUsd * priorities.cost * 1_000 - specialist.performance.medianLatencyMs / 1_000 * priorities.speed;
}

function roleGap(item) {
  const request = {
    schemaVersion: "das.bounded-role-gap-request.v1",
    id: `role-gap-${digest(item.requirement).slice(0, 16)}`,
    status: "awaiting-explicit-human-approval",
    workloads: [{ id: item.id, volume: item.volume, outcome: item.outcome }],
    outcome: item.outcome,
    requirement: structuredClone(item.requirement),
    observedVolume: item.volume,
    risk: item.risk,
    compilerAuthority: { modelSpendAuthorized: false, roleCreationAuthorized: false, activationAuthorized: false },
    nextStep: "Confirm this is a stable role boundary, then create a separate Level 1 comparison contract and independent verifier evidence.",
  };
  request.requestHash = digest(request);
  return request;
}

function mergeRoleGaps(gaps) {
  const grouped = new Map();
  for (const gap of gaps) {
    const key = digest(gap.requirement);
    const existing = grouped.get(key);
    if (!existing) grouped.set(key, structuredClone(gap));
    else {
      existing.workloads.push(...gap.workloads);
      existing.observedVolume += gap.observedVolume;
      existing.outcome = `${existing.outcome}; ${gap.outcome}`;
      delete existing.requestHash;
      existing.requestHash = digest(existing);
    }
  }
  return [...grouped.values()];
}

function buildVariant({ contract, specialists, strategy }) {
  const remaining = new Map(specialists.map((item) => [item.id, item.performance.capacityPerWindow]));
  const assignments = [];
  const gaps = [];
  for (const item of contract.workload) {
    const compatible = specialists
      .filter((specialist) => specialistCompatibility(specialist, item).compatible)
      .sort((left, right) => rankingScore(right, contract.priorities, strategy) - rankingScore(left, contract.priorities, strategy) || left.id.localeCompare(right.id));
    let unassigned = item.volume;
    for (const specialist of compatible) {
      const quantity = Math.min(unassigned, remaining.get(specialist.id));
      if (!quantity) continue;
      assignments.push({ workloadId: item.id, specialistId: specialist.id, specialistHash: specialist.specialistHash, quantity, estimatedCostUsd: quantity * specialist.performance.meanUnitCostUsd, expectedOutcomeScore: specialist.performance.outcomeScore, expectedLatencyMs: specialist.performance.medianLatencyMs, verifierId: specialist.capability.verifierId });
      remaining.set(specialist.id, remaining.get(specialist.id) - quantity);
      unassigned -= quantity;
      if (!unassigned) break;
    }
    if (unassigned > 0) {
      const gap = roleGap({ ...item, volume: unassigned });
      gap.reason = compatible.length === 0 ? "no-compatible-proved-specialist" : "compatible-specialist-capacity-exhausted";
      delete gap.requestHash;
      gap.requestHash = digest(gap);
      gaps.push(gap);
    }
  }
  const roleGaps = mergeRoleGaps(gaps);
  const totalCostUsd = assignments.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
  const assignedVolume = assignments.reduce((sum, item) => sum + item.quantity, 0);
  const totalVolume = contract.workload.reduce((sum, item) => sum + item.volume, 0);
  const variant = {
    strategy,
    assignments,
    roleGaps,
    metrics: {
      assignedVolume,
      totalVolume,
      coverageRate: assignedVolume / totalVolume,
      totalCostUsd,
      withinHardCostLimit: totalCostUsd <= contract.limits.maximumTotalCostUsd,
      weightedOutcomeScore: assignedVolume ? assignments.reduce((sum, item) => sum + item.expectedOutcomeScore * item.quantity, 0) / assignedVolume : 0,
      maximumExpectedLatencyMs: assignments.length ? Math.max(...assignments.map((item) => item.expectedLatencyMs)) : 0,
      proposedRoles: roleGaps.length,
    },
  };
  variant.variantHash = digest(variant);
  return variant;
}

function variantUtility(variant, priorities) {
  const cost = variant.metrics.totalCostUsd;
  const speedSeconds = variant.metrics.maximumExpectedLatencyMs / 1_000;
  return variant.metrics.coverageRate * 1_000_000 + variant.metrics.weightedOutcomeScore * priorities.quality * 10_000 - cost * priorities.cost - speedSeconds * priorities.speed - variant.metrics.proposedRoles * 1_000;
}

export function createBoundedFleetPlan({ contract, specialists }) {
  assertBoundedFleetContract(contract);
  requireCondition(Array.isArray(specialists) && specialists.length > 0, "Fleet planning requires proved specialists");
  specialists.forEach(assertBoundedSpecialistRecord);
  requireCondition(new Set(specialists.map((item) => item.id)).size === specialists.length, "Fleet specialist ids must be unique");
  const variants = ["balanced", "quality-first", "cost-first", "speed-first"].map((strategy) => buildVariant({ contract, specialists, strategy }));
  const eligible = variants.filter((variant) => variant.metrics.withinHardCostLimit && variant.metrics.proposedRoles <= contract.limits.maximumNewRoleProposals);
  const selected = [...eligible].sort((left, right) => variantUtility(right, contract.priorities) - variantUtility(left, contract.priorities) || left.variantHash.localeCompare(right.variantHash))[0] ?? null;
  const plan = {
    schemaVersion: "das.bounded-fleet-plan.v1",
    status: selected ? (selected.roleGaps.length ? "partially-routable-awaiting-role-approval" : "fully-routable-awaiting-execution-approval") : "blocked-by-bounded-limits",
    contractHash: contract.contractHash,
    specialistHashes: specialists.map((item) => ({ id: item.id, specialistHash: item.specialistHash })),
    selectedVariantHash: selected?.variantHash ?? null,
    selected: selected ? structuredClone(selected) : null,
    alternatives: variants.map((item) => ({ strategy: item.strategy, variantHash: item.variantHash, metrics: structuredClone(item.metrics) })),
    authority: {
      executionAuthorized: false,
      modelSpendAuthorized: false,
      roleCreationAuthorized: false,
      activationAuthorized: false,
    },
    evidenceBoundary: "Bounded deterministic planning over trusted workload and proved specialist records. No task ran and no new specialist was created.",
  };
  plan.planHash = digest(plan);
  return Object.freeze(plan);
}

export function assertBoundedFleetPlan(plan) {
  requireCondition(plan?.schemaVersion === "das.bounded-fleet-plan.v1", "Unsupported bounded fleet plan");
  const copy = structuredClone(plan);
  const expected = copy.planHash;
  delete copy.planHash;
  requireCondition(expected && digest(copy) === expected, "Bounded fleet plan integrity mismatch");
  requireCondition(Object.values(plan.authority).every((item) => item === false), "Fleet plan cannot silently grant authority");
  return true;
}
