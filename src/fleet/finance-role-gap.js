import { digest } from "../core/canonical.js";
import { EvidenceLedger } from "../core/evidence.js";
import { compileSpecialist } from "../compiler/compiler.js";
import { SpecialistRegistry } from "../compiler/registry.js";
import { DurableSpecialistRegistry } from "../compiler/durable-registry.js";
import { SpecialistControlPlane } from "../compiler/control-plane.js";
import { createBoundedSpecialistRecord } from "./bounded-level2-contract.js";
import { financeCloseRole } from "../roles/finance-close.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(available, required) {
  const set = new Set(available);
  return required.every((item) => set.has(item));
}

export function proveFinanceRoleGap({ roleGap, clock = () => "2026-08-05T15:00:00.000Z" }) {
  requireCondition(roleGap?.status === "awaiting-explicit-human-approval" && roleGap?.requirement, "Finance role-gap proof requires an approved-plan role request");
  requireCondition(roleGap.requirement.verifierId === financeCloseRole.brief.successCriteria.verifierId, "Finance role gap verifier does not match the Level 1 role");
  requireCondition(roleGap.requirement.policyHash === digest(financeCloseRole.brief.policies), "Finance role gap policy does not match the Level 1 role");
  const evidence = new EvidenceLedger();
  const compiled = compileSpecialist({ role: financeCloseRole, registry: new SpecialistRegistry(), evidence });
  const winner = compiled.retained.candidate;
  const winnerEvidence = compiled.tournament.recommendation;
  requireCondition(winnerEvidence?.candidateId === winner.id && winnerEvidence.successRate === 1 && winnerEvidence.safetyViolations === 0, "Finance Level 1 winner did not pass its independent frozen comparison");
  requireCondition(includesAll(winner.tools, roleGap.requirement.tools) && includesAll(winner.context.sources, roleGap.requirement.contextSources) && includesAll(winner.authority.allowedActions, roleGap.requirement.authorityActions), "Finance Level 1 winner does not cover the approved role gap");
  requireCondition(winner.verifier.binding === roleGap.requirement.verifierId, "Finance winner verifier does not match the approved gap");
  requireCondition(evidence.verify(), "Finance Level 1 evidence ledger failed integrity verification");

  const compatibility = {
    roleTags: financeCloseRole.tags,
    environmentTags: financeCloseRole.brief.environment.tags,
    policyHash: digest(financeCloseRole.brief.policies),
    authorityHash: digest(financeCloseRole.brief.authority),
    toolsHash: digest(financeCloseRole.brief.environment.tools),
    verifierBinding: financeCloseRole.brief.successCriteria.verifierId,
  };
  const registry = new DurableSpecialistRegistry({ registryId: "bounded-level2-finance-gap-v1", clock });
  const selection = registry.registerSelection({
    role: { id: financeCloseRole.id, brief: financeCloseRole.brief },
    selectedCandidate: winner,
    alternatives: compiled.candidates.filter((item) => item.id !== winner.id).slice(0, 3).map((candidate) => ({ candidate, evidence: null })),
    decision: "activate-compiler-specialist",
    evidence: { candidateId: winner.id, successRate: 1, unsafeAttempts: 0, frozenResultHash: digest(winnerEvidence) },
    compatibility,
    evidenceReferences: [{ kind: "finance-role-gap", hash: roleGap.requestHash }, { kind: "generic-level1-evidence-ledger", hash: evidence.lastHash }],
  });
  const control = new SpecialistControlPlane();
  const activation = control.activateRecommended({ compiled: { retained: registry.activationRecord(financeCloseRole.id) }, role: financeCloseRole, environment: { policyHash: compatibility.policyHash, authorityHash: compatibility.authorityHash, availableTools: financeCloseRole.brief.environment.tools } });
  requireCondition(activation.activated && activation.current === winner.id, "Finance Level 1 winner failed bounded activation");
  const specialist = createBoundedSpecialistRecord({
    id: winner.id,
    roleId: winner.roleId,
    version: winner.version,
    status: "proved-active",
    capability: structuredClone(roleGap.requirement),
    performance: { passRate: 1, outcomeScore: 1, meanUnitCostUsd: winner.limits.maxCostPerTaskUsd, medianLatencyMs: winner.limits.maxLatencyMs, capacityPerWindow: roleGap.observedVolume, unsafeAttempts: 0 },
    evidence: { selectionHash: selection.recordHash, verifierReceiptHash: digest(winnerEvidence) },
  });
  return Object.freeze({ compiled, evidence, registry, selection, activation, specialist, compatibility, evidenceBoundary: "Zero-cost deterministic generic Level 1 finance-role proof and local activation. It is not a model-backed commercial comparison or customer evidence." });
}

