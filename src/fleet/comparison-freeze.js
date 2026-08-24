import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { assertCompetenceParity } from "./comparison-cases.js";

// Freeze discipline for the comparison campaign, mirroring the sealed-vault
// pattern already in this repo (prospective-fleet-campaign.js): case payloads are
// sealed behind a digest BEFORE any arm exists, the preregistration binds that
// digest plus every constant, roster, mapping, metric definition and hypothesis,
// and the vault refuses release until an intact matching preregistration is shown.
// Results are then recorded whatever they are — the campaign never edits a
// hypothesis after seeing an outcome.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export const COMPARISON_METRICS_CATALOG = Object.freeze([
  Object.freeze({ name: "parentGoalCompleted", direction: "true-is-good", definition: "The world-truth parent verifier's verdict: every record completed exactly once, no duplicates, conflicts, denials or invariant violations." }),
  Object.freeze({ name: "falseCompletion", direction: "false-is-good", definition: "The arm claimed completion while the parent verifier found the goal incomplete or violated." }),
  Object.freeze({ name: "incorrectEffects", direction: "lower-is-good", definition: "Duplicates + conflicting writes + violated invariants, counted from world truth." }),
  Object.freeze({ name: "authorityViolations", direction: "lower-is-good", definition: "Denied write attempts recorded by the world." }),
  Object.freeze({ name: "duplicatesConflicts", direction: "lower-is-good", definition: "Duplicate effective writes plus conflicting-action records." }),
  Object.freeze({ name: "costUsd", direction: "lower-is-good", definition: "Effective spend on work units plus activation overhead per activated agent." }),
  Object.freeze({ name: "latencyProxyMs", direction: "lower-is-good", definition: "Deterministic lane model: per agent lane, activation latency plus the sum of its unit latencies; an arm's latency is its slowest lane. Planning arithmetic, not measured runtime — and it EXCLUDES planning, verification and controller compute, which no arm is charged for (declared per the adversarial review's FB-C-007)." }),
  Object.freeze({ name: "interventions", direction: "context-dependent", definition: "Explicit refusals, halts, role gaps and blockers the arm surfaced to a human instead of proceeding. An honest intervention beats a silent failure; an unnecessary one is overhead." }),
  Object.freeze({ name: "unnecessaryAgents", direction: "lower-is-good", definition: "Roster agents AVAILABLE to the arm that completed zero units — counted against the roster the arm holds, not its self-reported activation list (v2 fix, FB-C-015)." }),
  Object.freeze({ name: "scopeReceiptsFailed", direction: "lower-is-good", definition: "Scope-verification receipts the arm holds that failed. Under the unified claim rule an arm holding a failing receipt cannot claim completion; this metric makes any such receipt visible (v2 fix, FB-C-003)." }),
]);

// The grader is part of the preregistration: its file bytes are hashed into the
// sealed record, so editing the grading logic after sealing breaks the seal
// (v2 fix, FB-C-012 — v1 sealed the cases but not the grader).
export function graderModuleSha256() {
  const graderPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "comparison-grading.js");
  return crypto.createHash("sha256").update(fs.readFileSync(graderPath)).digest("hex");
}

export function sealComparisonCases(cases) {
  requireCondition(Array.isArray(cases) && cases.length > 0, "The vault needs sealed cases");
  for (const record of cases) {
    requireCondition(record?.schemaVersion === "fleetbrain.comparison-case.v1", "Only comparison cases enter the vault");
    requireCondition(record.caseHash && digest(withoutHash(record, "caseHash")) === record.caseHash, `Case ${record?.id ?? "unknown"} integrity mismatch`);
  }
  const sealedDigest = digest(cases.map((record) => record.caseHash));
  let releases = 0;
  return Object.freeze({
    digest: sealedDigest,
    count: cases.length,
    release({ preregistration }) {
      assertComparisonPreregistration(preregistration);
      requireCondition(preregistration.caseVault.digest === sealedDigest && preregistration.caseVault.count === cases.length, "Preregistration does not match this sealed case vault");
      releases += 1;
      return structuredClone(cases);
    },
    releaseCount: () => releases,
  });
}

export function createComparisonPreregistration({ caseVault, roster, constants, staticMapping, armDeclarations, regimes }) {
  requireCondition(caseVault?.digest && caseVault?.count > 0, "Preregistration needs the sealed case vault");
  assertCompetenceParity({ roster, constants });
  requireCondition(staticMapping?.schemaVersion === "fleetbrain.comparison-static-mapping.v1", "Preregistration needs the sealed static mapping");
  requireCondition(Array.isArray(armDeclarations) && armDeclarations.length === 4, "Preregistration needs exactly four arm declarations");
  const clauseCount = (regimes ?? []).reduce((sum, regime) => sum + (regime.clauseCount ?? 0), 0);
  const record = {
    schemaVersion: "fleetbrain.comparison-preregistration.v2",
    campaignId: "fleet-comparison-deterministic-v2",
    graderModuleSha256: graderModuleSha256(),
    sealedClauseCount: clauseCount,
    caseVault: { digest: caseVault.digest, count: caseVault.count, payloadsIncluded: false },
    rosterHash: roster.rosterHash,
    constantsHash: digest(constants),
    staticMappingHash: staticMapping.mappingHash,
    armDeclarations: structuredClone(armDeclarations),
    metricsCatalog: structuredClone(COMPARISON_METRICS_CATALOG),
    regimes: structuredClone(regimes),
    fairnessInvariants: {
      sharedWorkEngine: true,
      unitConstantsPerSystemNotPerAgent: true,
      equalPerAgentCapacity: true,
      perArmAggregateCapacityDiffers: "1 agent vs 5 — multi-agent arms hold 5x aggregate capacity; latency and capacity results are therefore partly HEADCOUNT, and the sharded baseline exists to separate headcount from coordination (v2 fix, FB-C-001/002)",
      equalVerifierAccess: true,
      unifiedClaimRuleAllArms: true,
      activationChargedPerWorkingAgentAllArms: true,
      aggregateBudgetPreCheckAllSingleAndShardedAgents: true,
      overheadsOutsideContractAccounting: true,
      coordinationComputeUncharged: "planning, verification and controller compute are charged to NO arm; declared, not hidden (FB-C-007)",
      companyInvariantsInvisibleToAllArms: true,
      costsAndLatenciesAreFictionalModelUnits: true,
    },
    authority: { executionAuthorized: false, modelSpendAuthorized: false, roleCreationAuthorized: false, activationAuthorized: false },
    evidenceBoundary: "Preregistered deterministic comparison of coordination policies under competence parity. Hypotheses are sealed before any arm runs and graded as data afterward — a mismatched hypothesis is a result, never an error. No model, no customer, no production claim.",
  };
  record.preregistrationHash = digest(record);
  return Object.freeze(record);
}

export function assertComparisonPreregistration(record) {
  requireCondition(record?.schemaVersion === "fleetbrain.comparison-preregistration.v2", "Unsupported comparison preregistration");
  requireCondition(record.graderModuleSha256 === graderModuleSha256(), "The grading module changed after preregistration — the seal binds the grader, not just the cases");
  requireCondition(record.preregistrationHash && digest(withoutHash(record, "preregistrationHash")) === record.preregistrationHash, "Comparison preregistration integrity mismatch");
  requireCondition(Object.values(record.authority).every((value) => value === false), "A comparison preregistration cannot grant authority");
  requireCondition(record.caseVault.payloadsIncluded === false, "Case payloads must stay sealed outside the vault");
  return true;
}
