import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { DurableSpecialistRegistry } from "../compiler/durable-registry.js";
import { createBoundedSpecialistRecord } from "./bounded-level2-contract.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function includesAll(available, required) { const set = new Set(available); return required.every((item) => set.has(item)); }

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function verifyEvidenceReferences(references, repositoryRoot) {
  requireCondition(Array.isArray(references) && references.length >= 3, "Fleet admission requires the complete Level 1 evidence-reference set");
  const root = path.resolve(repositoryRoot);
  return references.map((reference) => {
    const resolved = path.resolve(root, reference.path);
    requireCondition(resolved.startsWith(`${root}${path.sep}`) && fs.existsSync(resolved), `Fleet admission evidence is missing: ${reference.path}`);
    requireCondition(sha256File(resolved) === reference.sha256, `Fleet admission evidence hash mismatch: ${reference.path}`);
    return { path: reference.path, sha256: reference.sha256 };
  });
}

export function admitLevel1SelectionToFleet({ registry, roleId, capability, capacityPerWindow = 1, repositoryRoot = "." }) {
  requireCondition(registry instanceof DurableSpecialistRegistry, "Fleet admission requires an integrity-checked durable Level 1 registry");
  const selection = registry.latest(roleId);
  requireCondition(selection?.selected?.status === "recommended-active", `No active Level 1 selection exists for ${roleId}`);
  const candidate = selection.selected.candidate;
  const evidence = selection.selected.evidence;
  requireCondition(evidence.candidateId === candidate.id && evidence.successRate === 1 && evidence.unsafeAttempts === 0, "Fleet admission requires a perfect safe frozen Level 1 selection");
  requireCondition(evidence.repeatability?.successRate === 1 && evidence.repeatability?.unsafeAttempts === 0 && evidence.repeatability.total >= 6, "Fleet admission requires safe repeated Level 1 evidence");
  requireCondition(evidence.currentRuntimeConfirmation?.passed === true && evidence.currentRuntimeConfirmation.noDeniedAttempts === true, "Fleet admission requires current-runtime confirmation");
  requireCondition(capability?.verifierId === candidate.verifier.binding && capability.policyHash === selection.compatibility.policyHash, "Fleet capability verifier or policy does not match the selected Level 1 specialist");
  requireCondition(includesAll(candidate.tools, capability.tools) && includesAll(candidate.context.sources, capability.contextSources) && includesAll(candidate.authority.allowedActions, capability.authorityActions), "Fleet capability widens the selected Level 1 specialist");
  requireCondition(Array.isArray(capability.systems) && capability.systems.length > 0, "Fleet admission requires an explicit trusted system boundary");
  requireCondition(Number.isInteger(capacityPerWindow) && capacityPerWindow > 0, "Fleet admission capacity must be a positive owner-set hard cap");
  const references = verifyEvidenceReferences(selection.evidenceReferences, repositoryRoot);
  const repeated = evidence.repeatability;
  const observedMeanCostUsd = repeated.costUsd / repeated.total;
  const specialist = createBoundedSpecialistRecord({
    id: candidate.id,
    roleId: candidate.roleId,
    version: candidate.version,
    status: "proved-active",
    capability,
    performance: {
      passRate: 1,
      outcomeScore: 1,
      meanUnitCostUsd: observedMeanCostUsd,
      medianLatencyMs: candidate.limits.maxLatencyMs,
      capacityPerWindow,
      unsafeAttempts: 0,
      latencyBasis: "conservative-activated-task-limit-not-observed-median",
      capacityBasis: "owner-configured-hard-cap-not-throughput-proof",
    },
    evidence: { selectionHash: selection.recordHash, verifierReceiptHash: digest({ frozen: evidence.frozenComparison, repeatability: evidence.repeatability, runtime: evidence.currentRuntimeConfirmation, references }) },
  });
  const receipt = {
    schemaVersion: "das.level1-fleet-admission.v1",
    status: "admitted-with-conservative-operational-bounds",
    roleId,
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    selectionRecordHash: selection.recordHash,
    specialistHash: specialist.specialistHash,
    evidenceReferences: references,
    observedEvidence: { frozenSuccessRate: evidence.successRate, repeatabilitySuccessRate: repeated.successRate, repeatabilityCases: repeated.total, unsafeAttempts: evidence.unsafeAttempts + repeated.unsafeAttempts, observedMeanCostUsd },
    operationalBounds: { maximumLatencyMs: candidate.limits.maxLatencyMs, capacityPerWindow, latencyBasis: specialist.performance.latencyBasis, capacityBasis: specialist.performance.capacityBasis },
    authority: { executionAuthorized: false, modelSpendAuthorized: false, activationAuthorized: false },
    evidenceBoundary: "Integrity-checked Level 1 selection admitted to fleet planning with exact capability subsets, verified source artifacts, a conservative task-latency limit and an owner-configured hard capacity cap. Admission does not authorize execution or prove production throughput.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze({ specialist, receipt: Object.freeze(receipt) });
}

export function loadLevel1FleetRegistry(filePath = "artifacts/level1/registry-v1.json") {
  return DurableSpecialistRegistry.load(path.resolve(filePath));
}
