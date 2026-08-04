import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { assertBoundedFleetPlan } from "../fleet/bounded-level2-planner.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function assertSummaryHash(summary, schemaVersion) {
  requireCondition(summary?.schemaVersion === schemaVersion, `Unsupported fleet summary: ${schemaVersion}`);
  const payload = structuredClone(summary);
  const expected = payload.summaryHash;
  delete payload.summaryHash;
  requireCondition(expected && digest(payload) === expected, "Fleet summary integrity mismatch");
  return true;
}

function humanize(value) {
  return String(value).replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function loadFleetConsoleState({
  executionSummaryPath = "artifacts/fleet/bounded-level2-execution-v1/summary.json",
  returnSummaryPath = "artifacts/fleet/bounded-level2-role-gap-return-v1/summary.json",
  expandedPlanPath = "artifacts/fleet/bounded-level2-role-gap-return-v1/expanded-plan.json",
} = {}) {
  try {
    const execution = readJson(executionSummaryPath);
    const returned = readJson(returnSummaryPath);
    const expandedPlan = readJson(expandedPlanPath);
    assertSummaryHash(execution, "das.bounded-level2-execution-rehearsal.v1");
    assertSummaryHash(returned, "das.bounded-level2-role-gap-return.v1");
    assertBoundedFleetPlan(expandedPlan);
    requireCondition(execution.parentGoalCompleted === false && execution.fictionalItemsIndependentlyVerified === 105, "Fleet execution checkpoint is not the expected blocked state");
    requireCondition(returned.originalBroadGoalCompleted === true && returned.expandedCoverageRate === 1 && returned.expandedRoleGaps === 0, "Fleet return checkpoint did not safely complete");
    requireCondition(returned.priorVerifiedItemsCarriedWithoutRerun === execution.fictionalItemsIndependentlyVerified, "Fleet return did not preserve prior verified work");
    requireCondition(expandedPlan.selected.metrics.assignedVolume === 115 && expandedPlan.selected.roleGaps.length === 0, "Expanded fleet plan is incomplete");

    const assignments = expandedPlan.selected.assignments.map((assignment) => ({
      workloadId: assignment.workloadId,
      workload: humanize(assignment.workloadId),
      specialistId: assignment.specialistId,
      specialist: humanize(assignment.specialistId.replace(/:.+$/, "")),
      quantity: assignment.quantity,
      estimatedCostUsd: assignment.estimatedCostUsd,
      expectedOutcomeScore: assignment.expectedOutcomeScore,
      expectedLatencyMs: assignment.expectedLatencyMs,
      verifier: humanize(assignment.verifierId),
      phase: assignment.workloadId === "unmatched-payments" ? "residual" : "carried",
      verified: true,
    }));
    return {
      status: "completed",
      integrity: "valid",
      broadGoal: execution.broadGoal,
      initial: {
        assigned: execution.fictionalItemsIndependentlyVerified,
        total: execution.fictionalItemsIndependentlyVerified + 10,
        roleGap: humanize(execution.roleGapWorkloads[0]),
        parentCompleted: false,
      },
      roleGap: {
        role: "Finance close",
        selectedCandidate: returned.newRole.candidateId,
        frozenPassRate: returned.newRole.level1SuccessRate,
        safetyViolations: returned.newRole.level1SafetyViolations,
        activated: returned.newRole.activated,
      },
      continuation: {
        carriedWithoutRerun: returned.priorVerifiedItemsCarriedWithoutRerun,
        residualExecuted: returned.residualItemsExecuted,
        residualSuccessRate: returned.residualSuccessRate,
        residualSafetyViolations: returned.residualSafetyViolations,
        totalVerified: expandedPlan.selected.metrics.assignedVolume,
        total: expandedPlan.selected.metrics.totalVolume,
        finalState: returned.status,
        parentCompleted: returned.originalBroadGoalCompleted,
      },
      plan: {
        strategy: humanize(expandedPlan.selected.strategy),
        estimatedCostUsd: expandedPlan.selected.metrics.totalCostUsd,
        hardCostLimitUsd: 10,
        expectedOutcomeScore: expandedPlan.selected.metrics.weightedOutcomeScore,
        assignments,
      },
      boundary: returned.evidenceBoundary,
      nextGate: "Fresh model-backed specialist construction and improvement remain separately paid empirical gates.",
    };
  } catch (error) {
    return { status: "invalid", integrity: "invalid", error: error instanceof Error ? error.message : String(error), assignments: [] };
  }
}
