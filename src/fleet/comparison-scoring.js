import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";

// Scoring lives OUTSIDE the arms, mirroring the independent-verifier philosophy.
// parentGoalCompleted comes from the world-truth parent verifier, never the arm.
// There is deliberately NO composite winner score anywhere.
//
// v2 changes from the adversarial review: unnecessaryAgents counts against the
// roster an arm HOLDS (v1 let the adaptive arm's self-reported activation list
// hide its idle specialists); scopeReceiptsFailed makes a discarded failing
// receipt visible instead of silently dropped.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function scoreComparisonArmRun({ caseRecord, armRun, parentVerification }) {
  requireCondition(caseRecord?.schemaVersion === "fleetbrain.comparison-case.v1", "Scoring needs the sealed case");
  requireCondition(armRun?.schemaVersion === "fleetbrain.comparison-arm-run.v2", "Scoring needs a v2 arm run record");
  requireCondition(parentVerification?.schemaVersion === "fleetbrain.comparison-parent-verification.v1", "Scoring needs the parent verification");
  const workedAgents = armRun.activatedAgents.filter((agent) => agent.unitsCompleted > 0).length;
  const result = {
    schemaVersion: "fleetbrain.comparison-case-result.v2",
    caseId: caseRecord.id,
    regime: caseRecord.regime,
    armId: armRun.armId,
    metrics: {
      parentGoalCompleted: parentVerification.parentGoalCompleted,
      falseCompletion: armRun.claimedCompleted === true && parentVerification.parentGoalCompleted !== true,
      incorrectEffects: parentVerification.incorrectEffects,
      authorityViolations: parentVerification.authorityViolations,
      duplicatesConflicts: parentVerification.duplicates + parentVerification.conflicts,
      costUsd: armRun.totalCostUsd,
      latencyProxyMs: armRun.latencyProxyMs,
      interventions: armRun.interventions.length,
      unnecessaryAgents: armRun.rosterAvailable - workedAgents,
      scopeReceiptsFailed: armRun.scopeVerifications.filter((receipt) => !receipt.passed).length,
    },
    unitsRequired: parentVerification.unitsRequired,
    unitsCompleted: parentVerification.unitsCompleted,
    claimedCompleted: armRun.claimedCompleted,
    claimReason: armRun.claimReason,
    armRunHash: armRun.armRunHash,
    parentVerificationHash: parentVerification.verificationHash,
    caseHash: caseRecord.caseHash,
  };
  result.resultHash = digest(result);
  return Object.freeze(result);
}
