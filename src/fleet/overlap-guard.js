import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { assertBoundedFleetContract } from "./bounded-level2-contract.js";
import { assertBoundedFleetPlan } from "./bounded-level2-planner.js";

// Conflict PREVENTION for overlapping work queues.
//
// The v2 comparison's C2 case proved the gap: when two queues contain some of the
// same underlying records and capacity forces the planner to split them across two
// specialists, the second specialist re-does the shared work — duplicates happen,
// and the machinery only notices AFTER the writes exist. Detection is late.
//
// Prevention, in this codebase's idiom, is refusal: the company DECLARES which
// queues may overlap (it knows its own mail rules; the planner cannot invent this),
// and before anything executes, the guard audits the plan. Every declared overlap
// group must land entirely on ONE specialist — whose idempotent writes make the
// shared records physically safe. A split group is not patched or re-partitioned by
// guesswork; it is refused, with the exact group and specialists named, and a human
// re-scopes the day. No duplicate can survive this to execution.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export function declareOverlapGroups({ contract, groups }) {
  assertBoundedFleetContract(contract);
  requireCondition(Array.isArray(groups) && groups.length > 0, "An overlap declaration needs at least one group");
  const byId = new Map(contract.workload.map((item) => [item.id, item]));
  const seen = new Set();
  const normalized = groups.map((group, index) => {
    const id = String(group?.id ?? "").trim();
    requireCondition(id && !seen.has(id), `Overlap group ${index + 1} needs a unique id`);
    seen.add(id);
    const workloadIds = [...new Set((group.workloadIds ?? []).map((item) => String(item).trim()))].sort();
    requireCondition(workloadIds.length >= 2, `Overlap group ${id} needs at least two workload classes`);
    const items = workloadIds.map((workloadId) => {
      const item = byId.get(workloadId);
      requireCondition(item, `Overlap group ${id} names a workload the contract does not contain: ${workloadId}`);
      return item;
    });
    const systems = new Set(items.map((item) => item.requirement.systems[0]));
    const actions = new Set(items.map((item) => item.requirement.authorityActions[0]));
    requireCondition(systems.size === 1 && actions.size === 1, `Overlap group ${id} must share one system and one action — queues on different systems cannot contain the same records`);
    return { id, workloadIds, sharedRecordCount: Math.floor(Number(group.sharedRecordCount ?? 0)) };
  });
  const declaration = {
    schemaVersion: "fleetbrain.overlap-declaration.v1",
    contractHash: contract.contractHash,
    groups: normalized.sort((left, right) => left.id.localeCompare(right.id)),
    evidenceBoundary: "Company-declared knowledge that these queues may contain the same underlying records. Declaration is human; the guard enforces consolidation before execution. Grants nothing.",
  };
  declaration.declarationHash = digest(declaration);
  return Object.freeze(declaration);
}

export function assertOverlapDeclaration(declaration) {
  requireCondition(declaration?.schemaVersion === "fleetbrain.overlap-declaration.v1", "Unsupported overlap declaration");
  requireCondition(declaration.declarationHash && digest(withoutHash(declaration, "declarationHash")) === declaration.declarationHash, "Overlap declaration integrity mismatch");
  return true;
}

export function auditPlanForOverlapSplits({ plan, declaration }) {
  assertBoundedFleetPlan(plan);
  assertOverlapDeclaration(declaration);
  requireCondition(plan.contractHash === declaration.contractHash, "Overlap audit requires the declaration for this exact contract");
  requireCondition(plan.selected, "Cannot audit a plan with no selected variant");
  const violations = [];
  for (const group of declaration.groups) {
    const specialists = [...new Set(
      plan.selected.assignments
        .filter((assignment) => group.workloadIds.includes(assignment.workloadId))
        .map((assignment) => assignment.specialistId),
    )].sort();
    if (specialists.length > 1) {
      violations.push({ groupId: group.id, workloadIds: group.workloadIds, specialists, reason: "overlap-group-split-across-specialists" });
    }
  }
  const audit = {
    schemaVersion: "fleetbrain.overlap-audit.v1",
    contractHash: plan.contractHash,
    planHash: plan.planHash,
    declarationHash: declaration.declarationHash,
    consolidated: violations.length === 0,
    violations,
    verdict: violations.length === 0
      ? "every-declared-overlap-group-lands-on-one-specialist"
      : "refuse-execution-a-split-overlap-group-would-duplicate-shared-records",
    evidenceBoundary: "Pre-execution audit: a declared overlap group split across specialists is refused before any write exists — prevention by refusal, never by silent re-partitioning.",
  };
  audit.auditHash = digest(audit);
  return Object.freeze(audit);
}
