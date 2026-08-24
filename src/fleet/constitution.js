import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";

// The company constitution: a versioned, hash-sealed policy object that constrains
// planning and execution and cannot be altered while a plan is in flight.
//
// Composition rule for this module: it NEVER modifies the existing das.* records or
// the functions that produce them. It validates against them and emits its own
// fleetbrain.* records that reference their hashes. The constitution therefore
// constrains new runs without touching anything sealed evidence depends on.

const RISK_ORDER = { low: 0, medium: 1, high: 2 };

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function finite(value, label, { minimum = 0, exclusiveMinimum = false } = {}) {
  const number = Number(value);
  requireCondition(Number.isFinite(number) && (exclusiveMinimum ? number > minimum : number >= minimum), `${label} is invalid`);
  return number;
}

function sortedUnique(values, label) {
  requireCondition(Array.isArray(values), `${label} must be a list`);
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].sort();
}

export function createCompanyConstitution(input) {
  requireCondition(input?.companyId, "A constitution belongs to exactly one company");
  const version = Math.floor(finite(input.version ?? 1, "Constitution version", { minimum: 1 }));
  const previousVersionHash = String(input.previousVersionHash ?? "").trim();
  requireCondition(version === 1 ? previousVersionHash === "" : previousVersionHash.length > 0, "Constitution versions above 1 must chain to the exact previous version hash");
  const riskTolerance = String(input.riskTolerance ?? "").trim();
  requireCondition(riskTolerance in RISK_ORDER, "Constitution risk tolerance must be low, medium or high");
  const record = {
    schemaVersion: "fleetbrain.company-constitution.v1",
    companyId: String(input.companyId),
    version,
    previousVersionHash,
    prohibitedActions: sortedUnique(input.prohibitedActions ?? [], "Prohibited actions"),
    riskTolerance,
    qualityFloor: finite(input.qualityFloor ?? 0, "Constitution quality floor"),
    budgets: {
      maximumTotalCostUsd: finite(input.budgets?.maximumTotalCostUsd, "Constitution total budget", { minimum: 0, exclusiveMinimum: true }),
      maximumUnitCostUsd: finite(input.budgets?.maximumUnitCostUsd, "Constitution unit budget", { minimum: 0, exclusiveMinimum: true }),
    },
    latencyCeilingMs: finite(input.latencyCeilingMs ?? Number.MAX_SAFE_INTEGER, "Constitution latency ceiling", { minimum: 0, exclusiveMinimum: true }),
    // Company-wide caps that no single assignment can see: "at most N of this
    // action across the whole window". Declared policy, like the budget — the
    // planner refuses plans that would breach one, and the aggregate verifier
    // re-checks the combined effects afterward. This is the mechanism the A2
    // comparison case proved was missing from every arm.
    sharedInvariants: (input.sharedInvariants ?? []).map((raw, index) => {
      const action = String(raw?.action ?? "").trim();
      requireCondition(action, `Shared invariant ${index + 1} needs the action it caps`);
      return { kind: "max-action-count", action, limit: Math.floor(finite(raw.limit, `Shared invariant ${index + 1} limit`, { minimum: 0 })) };
    }).sort((left, right) => left.action.localeCompare(right.action)),
    approvalRules: {
      executionApprovalRequired: true,
      automaticSpendProhibited: true,
      automaticActivationProhibited: true,
      riskRequiringExplicitApproval: String(input.approvalRules?.riskRequiringExplicitApproval ?? "high"),
    },
    evidenceRequirements: {
      independentVerifierRequired: true,
      perAssignmentReceiptRequired: true,
    },
    evidenceBoundary: "A versioned company policy object. It constrains planning and execution; it grants no authority, and trusted code re-verifies its hash at every use so it cannot change mid-run.",
  };
  requireCondition(record.qualityFloor <= 1, "Constitution quality floor cannot exceed 1");
  requireCondition(record.approvalRules.riskRequiringExplicitApproval in RISK_ORDER, "Constitution approval-risk threshold must be low, medium or high");
  record.constitutionHash = digest(record);
  return Object.freeze(record);
}

export function assertCompanyConstitution(constitution) {
  requireCondition(constitution?.schemaVersion === "fleetbrain.company-constitution.v1", "Unsupported company constitution");
  requireCondition(constitution.constitutionHash && digest(withoutHash(constitution, "constitutionHash")) === constitution.constitutionHash, "Company constitution integrity mismatch");
  requireCondition(constitution.approvalRules.executionApprovalRequired === true && constitution.approvalRules.automaticSpendProhibited === true && constitution.approvalRules.automaticActivationProhibited === true, "Constitution approval rules cannot be weakened");
  requireCondition(constitution.evidenceRequirements.independentVerifierRequired === true && constitution.evidenceRequirements.perAssignmentReceiptRequired === true, "Constitution evidence requirements cannot be weakened");
  return true;
}

export function amendCompanyConstitution(previous, changes) {
  assertCompanyConstitution(previous);
  return createCompanyConstitution({
    companyId: previous.companyId,
    version: previous.version + 1,
    previousVersionHash: previous.constitutionHash,
    prohibitedActions: changes.prohibitedActions ?? previous.prohibitedActions,
    riskTolerance: changes.riskTolerance ?? previous.riskTolerance,
    qualityFloor: changes.qualityFloor ?? previous.qualityFloor,
    budgets: { ...previous.budgets, ...(changes.budgets ?? {}) },
    latencyCeilingMs: changes.latencyCeilingMs ?? previous.latencyCeilingMs,
    sharedInvariants: changes.sharedInvariants ?? previous.sharedInvariants,
    approvalRules: { riskRequiringExplicitApproval: changes.approvalRules?.riskRequiringExplicitApproval ?? previous.approvalRules.riskRequiringExplicitApproval },
  });
}

// Non-throwing compatibility check, in the style of specialistCompatibility: the caller
// decides whether a failure is a blocker or an exception.
export function contractConstitutionCompatibility(contract, constitution) {
  assertCompanyConstitution(constitution);
  requireCondition(contract?.schemaVersion === "das.bounded-fleet-contract.v1", "Constitution checks apply to bounded fleet contracts");
  const prohibited = new Set(constitution.prohibitedActions);
  const offendingActions = [...new Set(contract.workload.flatMap((item) => item.requirement.authorityActions.filter((action) => prohibited.has(action))))].sort();
  const overRisk = contract.workload.filter((item) => RISK_ORDER[item.risk] > RISK_ORDER[constitution.riskTolerance]).map((item) => item.id);
  const underQuality = contract.workload.filter((item) => item.minimumOutcomeScore < constitution.qualityFloor).map((item) => item.id);
  const overUnitCost = contract.workload.filter((item) => item.maximumUnitCostUsd > constitution.budgets.maximumUnitCostUsd).map((item) => item.id);
  const invariantBreaches = constitution.sharedInvariants
    .map((invariant) => {
      const plannedCount = contract.workload
        .filter((item) => item.requirement.authorityActions.includes(invariant.action))
        .reduce((sum, item) => sum + item.volume, 0);
      return { action: invariant.action, limit: invariant.limit, plannedCount };
    })
    .filter((entry) => entry.plannedCount > entry.limit);
  const checks = {
    sameCompany: contract.companyId === constitution.companyId,
    noProhibitedActions: offendingActions.length === 0,
    riskWithinTolerance: overRisk.length === 0,
    qualityFloorsRespected: underQuality.length === 0,
    unitCostsWithinBudget: overUnitCost.length === 0,
    totalBudgetWithinConstitution: contract.limits.maximumTotalCostUsd <= constitution.budgets.maximumTotalCostUsd,
    authorityNotWidened: contract.limits.allowAutomaticRoleCreation === false && contract.limits.allowAutomaticSpend === false && contract.limits.allowAutomaticActivation === false,
    sharedInvariantsRespectedInPlan: invariantBreaches.length === 0,
  };
  return {
    compatible: Object.values(checks).every(Boolean),
    checks,
    details: { offendingActions, overRisk, underQuality, overUnitCost, invariantBreaches },
  };
}

export function assertContractWithinConstitution(contract, constitution) {
  const result = contractConstitutionCompatibility(contract, constitution);
  requireCondition(result.compatible, `Fleet contract violates the company constitution: ${Object.entries(result.checks).filter(([, passed]) => !passed).map(([name]) => name).join(", ")}`);
  return result;
}

export function planConstitutionCompatibility({ contract, plan, constitution }) {
  assertCompanyConstitution(constitution);
  requireCondition(plan?.schemaVersion === "das.bounded-fleet-plan.v1" && plan.contractHash === contract.contractHash, "Constitution checks require the plan for this exact contract");
  const contractResult = contractConstitutionCompatibility(contract, constitution);
  const selected = plan.selected;
  const checks = {
    ...contractResult.checks,
    planCostWithinConstitution: selected ? selected.metrics.totalCostUsd <= constitution.budgets.maximumTotalCostUsd : true,
    planLatencyWithinCeiling: selected ? selected.metrics.maximumExpectedLatencyMs <= constitution.latencyCeilingMs : true,
  };
  return { compatible: Object.values(checks).every(Boolean), checks, details: contractResult.details };
}

// The execution binding: seals which constitution version governs which contract and
// plan. Trusted code re-verifies the constitution hash against this binding at every
// step, so nothing — model or human — can swap or soften the constitution mid-run.
export function bindConstitutionToExecution({ constitution, contract, plan }) {
  const compatibility = planConstitutionCompatibility({ contract, plan, constitution });
  requireCondition(compatibility.compatible, `Cannot bind execution to a plan that violates the constitution: ${Object.entries(compatibility.checks).filter(([, passed]) => !passed).map(([name]) => name).join(", ")}`);
  const binding = {
    schemaVersion: "fleetbrain.constitution-execution-binding.v1",
    companyId: constitution.companyId,
    constitutionHash: constitution.constitutionHash,
    constitutionVersion: constitution.version,
    contractHash: contract.contractHash,
    planHash: plan.planHash,
    checks: compatibility.checks,
    evidenceBoundary: "Binds one constitution version to one contract and plan. Execution steps must re-verify the constitution against this binding; a changed constitution fails the check rather than silently applying.",
  };
  binding.bindingHash = digest(binding);
  return Object.freeze(binding);
}

export function assertConstitutionUnchanged(binding, constitution) {
  requireCondition(binding?.schemaVersion === "fleetbrain.constitution-execution-binding.v1", "Unsupported constitution execution binding");
  requireCondition(binding.bindingHash && digest(withoutHash(binding, "bindingHash")) === binding.bindingHash, "Constitution execution binding integrity mismatch");
  assertCompanyConstitution(constitution);
  requireCondition(constitution.constitutionHash === binding.constitutionHash && constitution.version === binding.constitutionVersion, "The constitution changed after execution was bound to it");
  return true;
}
