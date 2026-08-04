import { digest } from "../core/canonical.js";

const RISK = new Set(["low", "medium", "high"]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueStrings(values, label) {
  const result = [...new Set((values ?? []).map((item) => String(item).trim()).filter(Boolean))].sort();
  requireCondition(result.length > 0, `${label} cannot be empty`);
  return result;
}

function finite(value, label, { minimum = 0, exclusiveMinimum = false } = {}) {
  const number = Number(value);
  requireCondition(Number.isFinite(number) && (exclusiveMinimum ? number > minimum : number >= minimum), `${label} is invalid`);
  return number;
}

function normalizeRequirement(input, label) {
  const requirement = {
    systems: uniqueStrings(input?.systems, `${label} systems`),
    tools: uniqueStrings(input?.tools, `${label} tools`),
    contextSources: uniqueStrings(input?.contextSources, `${label} context sources`),
    authorityActions: uniqueStrings(input?.authorityActions, `${label} authority actions`),
    verifierId: String(input?.verifierId ?? "").trim(),
    policyHash: String(input?.policyHash ?? "").trim(),
  };
  requireCondition(requirement.verifierId && requirement.policyHash, `${label} needs an independent verifier and policy hash`);
  return requirement;
}

export function createBoundedFleetContract(input) {
  requireCondition(input?.companyId && input?.goal, "Fleet contract requires a company and ordinary broad goal");
  const seen = new Set();
  const workload = (input.workload ?? []).map((raw, index) => {
    const id = String(raw?.id ?? "").trim();
    requireCondition(id && !seen.has(id), `Workload item ${index + 1} needs a unique id`);
    seen.add(id);
    return {
      id,
      outcome: String(raw.outcome ?? "").trim(),
      source: String(raw.source ?? "").trim(),
      volume: Math.floor(finite(raw.volume, `Workload ${id} volume`, { minimum: 0, exclusiveMinimum: true })),
      dueWithinMs: finite(raw.dueWithinMs, `Workload ${id} deadline`, { minimum: 0, exclusiveMinimum: true }),
      maximumUnitCostUsd: finite(raw.maximumUnitCostUsd, `Workload ${id} unit budget`),
      minimumOutcomeScore: finite(raw.minimumOutcomeScore, `Workload ${id} quality floor`),
      risk: RISK.has(raw.risk) ? raw.risk : "",
      requirement: normalizeRequirement(raw.requirement, `Workload ${id}`),
    };
  });
  requireCondition(workload.length >= 3 && workload.every((item) => item.outcome && item.source && item.risk && item.minimumOutcomeScore <= 1), "Fleet contract needs at least three complete bounded workload classes");
  const priorities = {
    quality: finite(input.priorities?.quality ?? 1, "Quality priority"),
    cost: finite(input.priorities?.cost ?? .25, "Cost priority"),
    speed: finite(input.priorities?.speed ?? .25, "Speed priority"),
  };
  requireCondition(priorities.quality + priorities.cost + priorities.speed > 0, "At least one fleet priority is required");
  const record = {
    schemaVersion: "das.bounded-fleet-contract.v1",
    companyId: String(input.companyId),
    goal: String(input.goal),
    planningWindow: String(input.planningWindow ?? "current-bounded-window"),
    workload,
    priorities,
    limits: {
      maximumTotalCostUsd: finite(input.limits?.maximumTotalCostUsd, "Fleet hard cost limit"),
      maximumNewRoleProposals: Math.floor(finite(input.limits?.maximumNewRoleProposals ?? 1, "New-role proposal limit")),
      allowAutomaticRoleCreation: false,
      allowAutomaticSpend: false,
      allowAutomaticActivation: false,
    },
    evidenceBoundary: "Trusted bounded workload inventory and planning limits. This contract does not authorize execution, model spend, role creation or activation.",
  };
  record.contractHash = digest(record);
  return Object.freeze(record);
}

export function assertBoundedFleetContract(contract) {
  requireCondition(contract?.schemaVersion === "das.bounded-fleet-contract.v1", "Unsupported fleet contract");
  const copy = structuredClone(contract);
  const expected = copy.contractHash;
  delete copy.contractHash;
  requireCondition(expected && digest(copy) === expected, "Fleet contract integrity mismatch");
  requireCondition(contract.limits.allowAutomaticRoleCreation === false && contract.limits.allowAutomaticSpend === false && contract.limits.allowAutomaticActivation === false, "Bounded fleet authority cannot be widened");
  return true;
}

export function createBoundedSpecialistRecord(input) {
  const record = {
    schemaVersion: "das.bounded-fleet-specialist.v1",
    id: String(input?.id ?? "").trim(),
    roleId: String(input?.roleId ?? "").trim(),
    version: String(input?.version ?? "").trim(),
    status: input?.status === "proved-active" ? "proved-active" : "",
    capability: normalizeRequirement(input?.capability, `Specialist ${input?.id ?? "unknown"}`),
    performance: {
      passRate: finite(input?.performance?.passRate, "Specialist pass rate"),
      outcomeScore: finite(input?.performance?.outcomeScore, "Specialist outcome score"),
      meanUnitCostUsd: finite(input?.performance?.meanUnitCostUsd, "Specialist unit cost"),
      medianLatencyMs: finite(input?.performance?.medianLatencyMs, "Specialist latency"),
      capacityPerWindow: Math.floor(finite(input?.performance?.capacityPerWindow, "Specialist capacity", { minimum: 0, exclusiveMinimum: true })),
      unsafeAttempts: Math.floor(finite(input?.performance?.unsafeAttempts, "Specialist unsafe attempts")),
      ...(input?.performance?.latencyBasis ? { latencyBasis: String(input.performance.latencyBasis) } : {}),
      ...(input?.performance?.capacityBasis ? { capacityBasis: String(input.performance.capacityBasis) } : {}),
    },
    evidence: {
      selectionHash: String(input?.evidence?.selectionHash ?? "").trim(),
      verifierReceiptHash: String(input?.evidence?.verifierReceiptHash ?? "").trim(),
    },
  };
  requireCondition(record.id && record.roleId && record.version && record.status && record.evidence.selectionHash && record.evidence.verifierReceiptHash, "Fleet specialist needs complete proved identity and evidence");
  requireCondition(record.performance.passRate === 1 && record.performance.outcomeScore <= 1 && record.performance.unsafeAttempts === 0, "Only perfectly safe proved specialists enter bounded fleet planning");
  record.specialistHash = digest(record);
  return Object.freeze(record);
}

export function assertBoundedSpecialistRecord(record) {
  requireCondition(record?.schemaVersion === "das.bounded-fleet-specialist.v1", "Unsupported fleet specialist record");
  const copy = structuredClone(record);
  const expected = copy.specialistHash;
  delete copy.specialistHash;
  requireCondition(expected && digest(copy) === expected, "Fleet specialist integrity mismatch");
  requireCondition(record.status === "proved-active" && record.performance.unsafeAttempts === 0, "Fleet planning requires a proved safe active specialist");
  return true;
}
