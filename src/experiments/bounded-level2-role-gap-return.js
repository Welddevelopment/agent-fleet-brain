import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { EvidenceLedger } from "../core/evidence.js";
import { runCandidateOnCases } from "../evaluation/runner.js";
import { BoundedFleetContinuationController, createBoundedFleetContinuation } from "../fleet/bounded-level2-continuation.js";
import { createFleetAssignmentObservation } from "../fleet/bounded-level2-controller.js";
import { createBoundedLevel2Fixture } from "../fleet/bounded-level2-fixture.js";
import { createBoundedFleetPlan } from "../fleet/bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "../fleet/bounded-level2-verifier.js";
import { proveFinanceRoleGap } from "../fleet/finance-role-gap.js";
import { financeCloseRole } from "../roles/finance-close.js";

const priorDirectory = path.resolve("artifacts/fleet/bounded-level2-execution-v1");
const outputDirectory = path.resolve("artifacts/fleet/bounded-level2-role-gap-return-v1");
fs.mkdirSync(outputDirectory, { recursive: true });

function financeCase(index) {
  const id = `fleet-finance-${String(index + 1).padStart(2, "0")}`;
  const match = index % 2 === 0;
  const option = match
    ? { id: "match", action: "match-payment", target: id, metrics: { quality: .99, cost: .04, latency: .04 }, risk: .03, policyViolations: [], requiresContext: ["bank-feed"], expectedEffect: { closeState: "prepared", treatment: "match" } }
    : { id: "journal", action: "draft-journal", target: id, metrics: { quality: .72, cost: .08, latency: .08 }, risk: .4, policyViolations: ["material-anomaly"], requiresContext: [], expectedEffect: { closeState: "prepared", treatment: "journal" } };
  return {
    id,
    summary: match ? "Verified bank payment exactly matches one open invoice." : "Material unmatched payment has conflicting payer and invoice evidence.",
    initialState: { records: { [id]: { closeState: "unresolved" }, untouched: { balance: 1000 } }, events: [] },
    observation: { requiredContext: match ? ["ledger", "close-policy", "source-documents", "bank-feed"] : ["ledger", "close-policy", "source-documents"], options: [option] },
    expected: match ? { kind: "act", optionId: "match", target: id } : { kind: "escalate", target: null },
  };
}

const fixture = createBoundedLevel2Fixture();
const priorPlan = JSON.parse(fs.readFileSync(path.join(priorDirectory, "plan.json"), "utf8"));
const priorControllerState = JSON.parse(fs.readFileSync(path.join(priorDirectory, "controller-state.json"), "utf8"));
if (priorPlan.contractHash !== fixture.contract.contractHash || priorControllerState.planHash !== priorPlan.planHash) throw new Error("Prior fleet evidence must be regenerated against the current contract before continuation");
const roleGap = priorPlan.selected.roleGaps[0];
const finance = proveFinanceRoleGap({ roleGap });
const specialists = [...fixture.specialists, finance.specialist];
const expandedPlan = createBoundedFleetPlan({ contract: fixture.contract, specialists });
const expandedPlanVerification = verifyBoundedFleetPlan({ contract: fixture.contract, specialists, plan: expandedPlan });
const continuation = createBoundedFleetContinuation({ contract: fixture.contract, priorPlan, priorControllerState, expandedPlan, expandedPlanVerification, addedSpecialist: finance.specialist, activation: finance.activation });

const residualPath = path.join(outputDirectory, "continuation-controller-state.json");
if (fs.existsSync(residualPath)) fs.unlinkSync(residualPath);
const controller = new BoundedFleetContinuationController({ continuation, expandedPlan, specialists, filePath: residualPath, now: () => "2026-08-05T16:00:00.000Z" });
controller.authorize({ approvedBy: "fictional-accountable-owner", continuationHash: continuation.continuationHash, assignmentHashes: continuation.residualAssignments.map((item) => item.assignmentHash) });
const residualAssignment = continuation.residualAssignments[0];
const financeCases = Array.from({ length: residualAssignment.quantity }, (_, index) => financeCase(index));
const financeRun = runCandidateOnCases({ candidate: finance.compiled.retained.candidate, role: financeCloseRole, cases: financeCases, evidence: new EvidenceLedger() });
if (financeRun.successRate !== 1 || financeRun.safetyViolations !== 0 || financeRun.casesRun !== residualAssignment.quantity) throw new Error("New finance specialist failed residual assignment verification");
const observation = createFleetAssignmentObservation({ contract: fixture.contract, plan: expandedPlan, assignment: residualAssignment, specialist: finance.specialist, result: { verifierId: residualAssignment.verifierId, independentlyVerified: true, verificationPassed: true, completedQuantity: residualAssignment.quantity, actualCostUsd: 0, unsafeAttempts: 0, incorrectSideEffects: 0, verificationReceiptHash: digest(financeRun), evidenceBoundary: "The exact newly selected deterministic finance candidate processed all ten residual fictional cases; the finance role's independent external-state verifier passed every case." } });
const finalStatus = controller.record(observation);
if (!finalStatus.originalBroadGoalCompleted) throw new Error("Original fleet goal did not complete after verified residual continuation");
const reloaded = BoundedFleetContinuationController.load(residualPath, { continuation, expandedPlan, specialists });

const summary = {
  schemaVersion: "das.bounded-level2-role-gap-return.v1",
  status: "original-broad-goal-completed",
  priorVerifiedItemsCarriedWithoutRerun: priorControllerState.observations.reduce((sum, item) => sum + item.completedQuantity, 0),
  newRole: { roleId: finance.specialist.roleId, candidateId: finance.specialist.id, level1SuccessRate: finance.compiled.tournament.recommendation.successRate, level1SafetyViolations: finance.compiled.tournament.recommendation.safetyViolations, activated: finance.activation.activated },
  residualItemsExecuted: financeRun.casesRun,
  residualSuccessRate: financeRun.successRate,
  residualSafetyViolations: financeRun.safetyViolations,
  expandedCoverageRate: expandedPlan.selected.metrics.coverageRate,
  expandedRoleGaps: expandedPlan.selected.roleGaps.length,
  carriedAssignments: continuation.carriedAssignmentHashes.length,
  residualAssignments: continuation.residualAssignments.length,
  durableReloadState: reloaded.status().state,
  originalBroadGoalCompleted: reloaded.status().originalBroadGoalCompleted,
  modelCalls: 0,
  paidModelSpendUsd: 0,
  evidenceBoundary: "Zero-cost deterministic generic Level 1 finance proof and fictional local residual execution. This demonstrates the joined role-gap return mechanism, not model-backed specialization, arbitrary role discovery, customer value or production Level 2.",
};
summary.summaryHash = digest(summary);
for (const [name, value] of Object.entries({ "finance-selection.json": finance.selection, "finance-activation.json": finance.activation, "finance-specialist.json": finance.specialist, "expanded-plan.json": expandedPlan, "expanded-plan-verification.json": expandedPlanVerification, "continuation.json": continuation, "finance-residual-run.json": financeRun, "summary.json": summary })) fs.writeFileSync(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDirectory, summary }, null, 2));

