import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";

// Scoring lives OUTSIDE the arms, mirroring the independent-verifier philosophy:
// an arm reports what it did and claims what it claims; the scorer combines the
// arm run with the world-truth parent verification into the nine preregistered
// metrics. parentGoalCompleted comes from the parent verifier, never the arm.
// There is deliberately NO composite winner score anywhere — a scalar utility
// would be an arbitrary weighting inviting exactly the overclaim the hub bans.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function scoreComparisonArmRun({ caseRecord, armRun, parentVerification }) {
  requireCondition(caseRecord?.schemaVersion === "fleetbrain.comparison-case.v1", "Scoring needs the sealed case");
  requireCondition(armRun?.schemaVersion === "fleetbrain.comparison-arm-run.v1", "Scoring needs an arm run record");
  requireCondition(parentVerification?.schemaVersion === "fleetbrain.comparison-parent-verification.v1", "Scoring needs the parent verification");
  const result = {
    schemaVersion: "fleetbrain.comparison-case-result.v1",
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
      unnecessaryAgents: armRun.activatedAgents.filter((agent) => agent.unitsCompleted === 0).length,
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
