import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { EvidenceLedger } from "dynamic-agent-specialisation/src/core/evidence.js";
import { compileSpecialist } from "dynamic-agent-specialisation/src/compiler/compiler.js";
import { SpecialistRegistry } from "dynamic-agent-specialisation/src/compiler/registry.js";
import { DurableSpecialistRegistry } from "dynamic-agent-specialisation/src/compiler/durable-registry.js";
import { SpecialistControlPlane } from "dynamic-agent-specialisation/src/compiler/control-plane.js";
import { assertBoundedFleetContract, createBoundedSpecialistRecord } from "./bounded-level2-contract.js";
import { assertBoundedFleetPlan, createBoundedFleetPlan } from "./bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "./bounded-level2-verifier.js";

// Role-gap -> DAS construction as a SEPARATE CONTROLLED STAGE.
//
// This generalises the finance-close prototype (finance-role-gap.js): when a plan
// returns any role gap, an explicitly human-invoked stage may ask DAS's deterministic
// compiler for a specialist, re-admit the winner through the same integrity gates,
// and produce an expanded plan covering only the blocked work. Nothing here executes,
// spends, or activates automatically inside a live run: the stage consumes a
// preparation receipt the durable controller only issues after all routable work
// completed safely and an accountable owner approved the exact gap. Its output stops
// at "awaiting execution approval" — the same place every other plan stops.
//
// Zero model calls: compileSpecialist is DAS's deterministic path (candidate
// generation, frozen evaluation, staged tournament) with no model gateway anywhere.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(available, required) {
  const set = new Set(available);
  return required.every((item) => set.has(item));
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export function constructSpecialistForRoleGap({ roleGap, role, registryId, clock = () => new Date().toISOString() }) {
  requireCondition(roleGap?.status === "awaiting-explicit-human-approval" && roleGap?.requirement, "Role-gap construction requires an approved-plan role request");
  requireCondition(role?.id && role?.brief, "Role-gap construction requires a complete DAS role definition");
  requireCondition(roleGap.requirement.verifierId === role.brief.successCriteria.verifierId, `Role gap verifier does not match role ${role.id}`);
  requireCondition(roleGap.requirement.policyHash === digest(role.brief.policies), `Role gap policy does not match role ${role.id}`);

  const evidence = new EvidenceLedger();
  const compiled = compileSpecialist({ role, registry: new SpecialistRegistry(), evidence });
  const winner = compiled.retained.candidate;
  const winnerEvidence = compiled.tournament.recommendation;
  requireCondition(winnerEvidence?.candidateId === winner.id && winnerEvidence.successRate === 1 && winnerEvidence.safetyViolations === 0, `Compiled winner for ${role.id} did not pass its independent frozen comparison`);
  requireCondition(includesAll(winner.tools, roleGap.requirement.tools) && includesAll(winner.context.sources, roleGap.requirement.contextSources) && includesAll(winner.authority.allowedActions, roleGap.requirement.authorityActions), `Compiled winner for ${role.id} does not cover the approved role gap`);
  requireCondition(winner.verifier.binding === roleGap.requirement.verifierId, `Compiled winner verifier does not match the approved gap`);
  requireCondition(evidence.verify(), "Role-gap construction evidence ledger failed integrity verification");

  const compatibility = {
    roleTags: role.tags,
    environmentTags: role.brief.environment.tags,
    policyHash: digest(role.brief.policies),
    authorityHash: digest(role.brief.authority),
    toolsHash: digest(role.brief.environment.tools),
    verifierBinding: role.brief.successCriteria.verifierId,
  };
  const registry = new DurableSpecialistRegistry({ registryId: registryId ?? `fleet-role-gap-${role.id}`, clock });
  const selection = registry.registerSelection({
    role: { id: role.id, brief: role.brief },
    selectedCandidate: winner,
    alternatives: compiled.candidates.filter((item) => item.id !== winner.id).slice(0, 3).map((candidate) => ({ candidate, evidence: null })),
    decision: "activate-compiler-specialist",
    evidence: { candidateId: winner.id, successRate: 1, unsafeAttempts: 0, frozenResultHash: digest(winnerEvidence) },
    compatibility,
    evidenceReferences: [{ kind: "fleet-role-gap", hash: roleGap.requestHash }, { kind: "generic-level1-evidence-ledger", hash: evidence.lastHash }],
  });
  const control = new SpecialistControlPlane();
  const activation = control.activateRecommended({ compiled: { retained: registry.activationRecord(role.id) }, role, environment: { policyHash: compatibility.policyHash, authorityHash: compatibility.authorityHash, availableTools: role.brief.environment.tools } });
  requireCondition(activation.activated && activation.current === winner.id, `Compiled winner for ${role.id} failed bounded activation`);

  const specialist = createBoundedSpecialistRecord({
    id: winner.id,
    roleId: winner.roleId,
    version: winner.version,
    status: "proved-active",
    capability: structuredClone(roleGap.requirement),
    performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: winner.limits.maxCostPerTaskUsd, medianLatencyMs: winner.limits.maxLatencyMs, capacityPerWindow: roleGap.observedVolume, unsafeAttempts: 0 },
    evidence: { selectionHash: selection.recordHash, verifierReceiptHash: digest(winnerEvidence) },
  });
  return Object.freeze({
    compiled,
    evidence,
    registry,
    selection,
    activation,
    specialist,
    compatibility,
    evidenceBoundary: `Zero-cost deterministic Level 1 proof and local activation for role ${role.id}. It is not a model-backed commercial comparison or customer evidence.`,
  });
}

export function runRoleGapConstructionStage({ contract, specialists, priorPlan, preparation, role, approvedBy, registryId, clock = () => new Date().toISOString() }) {
  assertBoundedFleetContract(contract);
  assertBoundedFleetPlan(priorPlan);
  requireCondition(String(approvedBy ?? "").trim(), "Role-gap construction stage requires an accountable owner");
  requireCondition(preparation?.schemaVersion === "das.fleet-role-gap-preparation.v1", "Role-gap construction stage requires a controller preparation receipt");
  requireCondition(preparation.preparationHash && digest(withoutHash(preparation, "preparationHash")) === preparation.preparationHash, "Role-gap preparation receipt integrity mismatch");
  requireCondition(preparation.status === "approved-to-prepare-level1-contract", "Role-gap preparation was not approved by the durable controller");
  requireCondition(Object.values(preparation.authority).every((value) => value === false), "Role-gap preparation cannot carry authority");
  const roleGap = priorPlan.selected.roleGaps.find((item) => item.requestHash === preparation.requestHash);
  requireCondition(roleGap, "Preparation does not match any role gap in the exact prior plan");

  const construction = constructSpecialistForRoleGap({ roleGap, role, registryId, clock });
  const expandedSpecialists = [...specialists, construction.specialist];
  const expandedPlan = createBoundedFleetPlan({ contract, specialists: expandedSpecialists });
  const expandedPlanVerification = verifyBoundedFleetPlan({ contract, specialists: expandedSpecialists, plan: expandedPlan });
  requireCondition(expandedPlanVerification.passed === true, "Expanded plan failed independent verification");
  requireCondition(expandedPlan.status === "fully-routable-awaiting-execution-approval" && expandedPlan.selected.roleGaps.length === 0, "Expanded plan did not cover the role gap");
  const priorAssignmentHashes = new Set(priorPlan.selected.assignments.map((item) => item.assignmentHash));
  const expandedHashes = new Set(expandedPlan.selected.assignments.map((item) => item.assignmentHash));
  requireCondition([...priorAssignmentHashes].every((hash) => expandedHashes.has(hash)), "Expanded plan changed assignments that were already planned");
  const residual = expandedPlan.selected.assignments.filter((item) => !priorAssignmentHashes.has(item.assignmentHash));
  requireCondition(residual.length > 0 && residual.every((item) => item.specialistHash === construction.specialist.specialistHash), "Expanded plan routed residual work to an unapproved specialist");

  const receipt = {
    schemaVersion: "fleetbrain.role-gap-construction-stage.v1",
    status: "constructed-and-replanned-awaiting-execution-approval",
    approvedBy: String(approvedBy),
    approvedAt: clock(),
    roleId: role.id,
    contractHash: contract.contractHash,
    priorPlanHash: priorPlan.planHash,
    preparationHash: preparation.preparationHash,
    gapRequestHash: roleGap.requestHash,
    selectionRecordHash: construction.selection.recordHash,
    activationHash: digest(construction.activation),
    specialistHash: construction.specialist.specialistHash,
    expandedPlanHash: expandedPlan.planHash,
    residualAssignmentHashes: residual.map((item) => item.assignmentHash).sort(),
    modelCalls: 0,
    paidModelSpendUsd: 0,
    authority: { executionAuthorized: false, modelSpendAuthorized: false, roleCreationAuthorizedBeyondThisGap: false, activationAuthorized: false },
    evidenceBoundary: "A separate, explicitly approved construction stage: DAS's deterministic compiler proved a specialist for one approved role gap, the winner was re-admitted through the standard integrity gates, and only the blocked work was replanned. Prior assignments are carried unchanged by hash. Execution still requires its own approval.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze({ construction, expandedPlan, expandedPlanVerification, residualAssignments: residual, receipt: Object.freeze(receipt) });
}

export function assertRoleGapConstructionStageReceipt(receipt) {
  requireCondition(receipt?.schemaVersion === "fleetbrain.role-gap-construction-stage.v1", "Unsupported role-gap construction stage receipt");
  requireCondition(receipt.receiptHash && digest(withoutHash(receipt, "receiptHash")) === receipt.receiptHash, "Role-gap construction stage receipt integrity mismatch");
  requireCondition(Object.values(receipt.authority).every((value) => value === false), "Role-gap construction stage cannot grant authority");
  requireCondition(receipt.modelCalls === 0 && receipt.paidModelSpendUsd === 0, "Role-gap construction stage must be zero-spend");
  return true;
}
