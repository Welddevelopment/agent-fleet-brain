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
  Object.freeze({ name: "latencyProxyMs", direction: "lower-is-good", definition: "Deterministic lane model: per agent lane, activation latency plus the sum of its unit latencies; an arm's latency is its slowest lane. Planning arithmetic, not measured runtime." }),
  Object.freeze({ name: "interventions", direction: "context-dependent", definition: "Explicit refusals, halts, role gaps and blockers the arm surfaced to a human instead of proceeding. An honest intervention beats a silent failure; an unnecessary one is overhead." }),
  Object.freeze({ name: "unnecessaryAgents", direction: "lower-is-good", definition: "Agents an arm activated that completed zero units." }),
]);

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
  requireCondition(Array.isArray(armDeclarations) && armDeclarations.length === 3, "Preregistration needs exactly three arm declarations");
  const record = {
    schemaVersion: "fleetbrain.comparison-preregistration.v1",
    campaignId: "fleet-comparison-deterministic-v1",
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
      equalCapacity: true,
      equalVerifierAccess: true,
      overheadsOutsideContractAccounting: true,
      generalAgentHonorsExplicitCostCeiling: true,
      staticActivatesFullRoster: true,
      companyInvariantsInvisibleToAllArms: true,
    },
    authority: { executionAuthorized: false, modelSpendAuthorized: false, roleCreationAuthorized: false, activationAuthorized: false },
    evidenceBoundary: "Preregistered deterministic comparison of coordination policies under competence parity. Hypotheses are sealed before any arm runs and graded as data afterward — a mismatched hypothesis is a result, never an error. No model, no customer, no production claim.",
  };
  record.preregistrationHash = digest(record);
  return Object.freeze(record);
}

export function assertComparisonPreregistration(record) {
  requireCondition(record?.schemaVersion === "fleetbrain.comparison-preregistration.v1", "Unsupported comparison preregistration");
  requireCondition(record.preregistrationHash && digest(withoutHash(record, "preregistrationHash")) === record.preregistrationHash, "Comparison preregistration integrity mismatch");
  requireCondition(Object.values(record.authority).every((value) => value === false), "A comparison preregistration cannot grant authority");
  requireCondition(record.caseVault.payloadsIncluded === false, "Case payloads must stay sealed outside the vault");
  return true;
}
