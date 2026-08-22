import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { runModelProcurementCase } from "../experiments/model-procurement-runner.js";
import { runModelRevopsCase } from "../experiments/model-revops-runner.js";
import { runModelSupportCase } from "../experiments/model-support-runner.js";
import { BoundedFleetController, assertFleetAssignmentObservation, createFleetAssignmentObservation } from "./bounded-level2-controller.js";
import { runProspectiveFleetCampaignPreflight } from "./prospective-fleet-campaign-fixture.js";
import { createProspectiveFleetCampaignRuntime } from "./prospective-fleet-campaign.js";
import { PROSPECTIVE_FLEET_V2_CAMPAIGN } from "./prospective-fleet-v3.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function readJsonIfPresent(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function jsonStable(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

const EXECUTORS = Object.freeze({
  "realistic-procurement-specialist": runModelProcurementCase,
  "realistic-support-operations-specialist": runModelSupportCase,
  "realistic-revenue-operations-specialist": runModelRevopsCase,
});

export function createProspectiveFleetResultObservation({ intake, assignment, specialist, result }) {
  const checks = result?.verification?.checks ?? {};
  const unsafeAttempts = Number(result?.unsafeAttempts ?? (checks.noDeniedAttempts === false ? 1 : 0));
  const detectedIncorrect = ["noOutOfScopeWrites", "noDuplicateKeys", "protectedStateUnchanged", "protectedUnchanged"].some((key) => checks[key] === false) || result?.verification?.recoveryClass === "incorrect-side-effect";
  const incorrectSideEffects = Math.max(Number(result?.incorrectSideEffects ?? 0), detectedIncorrect ? 1 : 0);
  requireCondition(result?.candidateId === specialist.id, "Prospective Fleet result candidate does not match the assigned specialist");
  requireCondition(Number.isFinite(result?.modelCostUsd) && result.modelCostUsd >= 0, "Prospective Fleet result needs exact non-negative model cost");
  return createFleetAssignmentObservation({
    contract: intake.intake.contract,
    plan: intake.plan,
    assignment,
    specialist,
    result: {
      independentlyVerified: true,
      verifierId: assignment.verifierId,
      verificationPassed: result?.passed === true && result?.verification?.passed === true,
      completedQuantity: result?.passed === true && result?.verification?.passed === true ? assignment.quantity : 0,
      actualCostUsd: result.modelCostUsd,
      unsafeAttempts: Number.isInteger(unsafeAttempts) && unsafeAttempts >= 0 ? unsafeAttempts : 1,
      incorrectSideEffects: Number.isInteger(incorrectSideEffects) && incorrectSideEffects >= 0 ? incorrectSideEffects : 1,
      verificationReceiptHash: digest({ candidateId: result?.candidateId, candidateFingerprint: result?.candidateFingerprint, caseId: result?.caseId, status: result?.status, verification: result?.verification }),
      evidenceBoundary: "Fresh prospective local model-specialist outcome bound to the pre-existing Fleet plan and exact independent external-state verifier.",
    },
  });
}

export function createProspectiveFleetProgress({ campaignId, planHash, results, fleetStatus, budget, evidenceLedgerValid }) {
  const progress = jsonStable({
    schemaVersion: "das.prospective-fleet-progress.v1",
    campaignId,
    planHash,
    results: structuredClone(results),
    fleetStatus: structuredClone(fleetStatus),
    budget: structuredClone(budget),
    evidenceLedgerValid: evidenceLedgerValid === true,
  });
  progress.progressHash = digest(progress);
  return progress;
}

export function assertProspectiveFleetProgress({ progress, plan, intake, assignments, specialists, tasks }) {
  requireCondition(progress?.schemaVersion === "das.prospective-fleet-progress.v1", "Unsupported prospective Fleet progress");
  requireCondition(progress.progressHash && digest(withoutHash(progress, "progressHash")) === progress.progressHash, "Prospective Fleet progress integrity mismatch");
  requireCondition(progress.campaignId === plan.campaignId && progress.planHash === plan.planHash, "Prospective Fleet progress belongs to another campaign");
  requireCondition(Array.isArray(progress.results) && progress.results.length <= tasks.length, "Prospective Fleet progress result count is invalid");
  requireCondition(progress.evidenceLedgerValid === true, "Prospective Fleet progress records an invalid evidence ledger");
  const assignmentById = new Map(assignments.map((item) => [item.assignmentId, item]));
  const specialistById = new Map(specialists.map((item) => [item.id, item]));
  const taskByRole = new Map(tasks.map((item) => [item.roleId, item]));
  const seenAssignments = new Set();
  for (const entry of progress.results) {
    const assignment = assignmentById.get(entry?.assignmentId);
    const specialist = assignment ? specialistById.get(assignment.specialistId) : null;
    const task = specialist ? taskByRole.get(specialist.roleId) : null;
    requireCondition(assignment && specialist && task, "Prospective Fleet progress contains an unknown assignment");
    requireCondition(!seenAssignments.has(assignment.assignmentId), "Prospective Fleet progress contains a duplicate assignment");
    requireCondition(entry.roleId === task.roleId && entry.candidateId === specialist.id && entry.candidateFingerprint === plan.assignments.find((item) => item.assignmentId === assignment.assignmentId)?.candidateFingerprint, "Prospective Fleet progress identity changed");
    requireCondition(entry.caseId === task.testCase.id, "Prospective Fleet progress case changed");
    requireCondition(entry.result?.candidateId === entry.candidateId && entry.result?.candidateFingerprint === entry.candidateFingerprint && entry.result?.caseId === entry.caseId, "Prospective Fleet saved result identity changed");
    assertFleetAssignmentObservation(entry.observation);
    requireCondition(entry.observation.assignmentHash === assignment.assignmentHash && entry.observation.specialistHash === specialist.specialistHash, "Prospective Fleet progress observation binding changed");
    const rebuilt = createProspectiveFleetResultObservation({ intake, assignment, specialist, result: entry.result });
    requireCondition(rebuilt.observationHash === entry.observation.observationHash, "Prospective Fleet saved result differs from its observation");
    seenAssignments.add(assignment.assignmentId);
  }
  return true;
}

export function restoreProspectiveFleetProgress({ progress, plan, intake, assignments, specialists, tasks, controller }) {
  if (!progress) return [];
  assertProspectiveFleetProgress({ progress, plan, intake, assignments, specialists, tasks });
  const recordedByAssignment = new Map(controller.snapshot().observations.map((item) => [item.assignmentId, item]));
  for (const entry of progress.results) {
    const recorded = recordedByAssignment.get(entry.assignmentId);
    if (recorded) requireCondition(recorded.observationHash === entry.observation.observationHash, `Prospective Fleet durable observation conflicts with progress: ${entry.assignmentId}`);
    else controller.record(entry.observation);
  }
  return structuredClone(progress.results);
}

function persistProgress({ file, preflight, results, controller, runtime }) {
  const progress = createProspectiveFleetProgress({
    campaignId: preflight.plan.campaignId,
    planHash: preflight.plan.planHash,
    results,
    fleetStatus: controller.status(),
    budget: runtime.budget.snapshot(),
    evidenceLedgerValid: runtime.evidence.verify(),
  });
  writePrivate(file, progress);
  return progress;
}

export async function runProspectiveFleetModelCampaign({ environment = process.env, campaign = PROSPECTIVE_FLEET_V2_CAMPAIGN, stateDirectory, fetchImpl = fetch } = {}) {
  const preflight = await runProspectiveFleetCampaignPreflight(campaign.preflight);
  // The runner used to hardcode V2's paths while taking its campaign id from the
  // preflight. That is how a paid V3 attempt on 2026-08-22 nearly re-ran the
  // already-completed V2. Bind the two together explicitly instead.
  requireCondition(preflight.plan.campaignId === campaign.campaignId, `Prospective Fleet preflight built ${preflight.plan.campaignId}, not the requested ${campaign.campaignId}`);
  const frozenPlanFile = path.resolve(path.join(campaign.artifactRoot, "plan.json"));
  const runDirectory = stateDirectory ?? path.join(campaign.artifactRoot, "model-run");
  requireCondition(fs.existsSync(frozenPlanFile), "Frozen prospective Fleet plan artifact is missing");
  const savedPlan = JSON.parse(fs.readFileSync(frozenPlanFile, "utf8"));
  requireCondition(savedPlan.planHash === preflight.plan.planHash && digest(Object.fromEntries(Object.entries(savedPlan).filter(([key]) => key !== "planHash"))) === savedPlan.planHash, "Prospective Fleet runner plan differs from the committed preflight");
  const runtime = createProspectiveFleetCampaignRuntime({ plan: preflight.plan, environment, stateDirectory: runDirectory, fetchImpl, campaignApproval: campaign.campaignApproval, ...(campaign.pricing ? { pricing: campaign.pricing } : {}) });
  const tasks = preflight.vault.release({ plan: preflight.plan, authorization: runtime.authorization });
  const selections = new Map(preflight.selections.map((selection) => [selection.roleId, selection]));
  const specialists = preflight.intake.admission.admissions.map((item) => item.specialist);
  const specialistByRole = new Map(specialists.map((specialist) => [specialist.roleId, specialist]));
  const controllerPath = path.join(runtime.root, "fleet-controller.json");
  const controller = new BoundedFleetController({ contract: preflight.intake.intake.contract, specialists, plan: preflight.intake.plan, planVerification: preflight.intake.verification, filePath: controllerPath });
  if (controller.status().state === "awaiting-execution-approval") controller.authorizeAssignments({ approvedBy: campaign.approvedBy, planHash: preflight.intake.plan.planHash, assignmentHashes: preflight.intake.plan.selected.assignments.map((item) => item.assignmentHash), maximumActualCostUsd: runtime.authorization.limitUsd });
  const progressPath = path.join(runtime.root, "progress.json");
  const savedProgress = readJsonIfPresent(progressPath);
  const results = restoreProspectiveFleetProgress({ progress: savedProgress, plan: preflight.plan, intake: preflight.intake, assignments: preflight.intake.plan.selected.assignments, specialists, tasks, controller });
  try {
    persistProgress({ file: progressPath, preflight, results, controller, runtime });
    for (const task of tasks) {
      const selection = selections.get(task.roleId);
      const specialist = specialistByRole.get(task.roleId);
      const assignment = preflight.intake.plan.selected.assignments.find((item) => item.specialistId === specialist?.id);
      const execute = EXECUTORS[task.roleId];
      requireCondition(selection?.selected?.candidate && specialist && assignment && execute, `Prospective Fleet role binding is incomplete: ${task.roleId}`);
      if (controller.snapshot().observations.some((item) => item.assignmentId === assignment.assignmentId)) continue;
      requireCondition(["authorized-not-started", "running"].includes(controller.status().state), `Prospective Fleet stopped before ${task.roleId}: ${controller.status().state}`);
      const candidate = selection.selected.candidate;
      const planAssignment = preflight.plan.assignments.find((item) => item.assignmentId === assignment.assignmentId);
      requireCondition(planAssignment?.maximumModelTurns, `Prospective Fleet assignment lacks its frozen role turn ceiling: ${task.roleId}`);
      const result = await execute({ candidate, testCase: task.testCase, gateway: runtime.gateway, evidence: runtime.evidence, executionModel: candidate.model.family, maxTurns: planAssignment.maximumModelTurns, tenantPrefix: `${campaign.tenantPrefix}:${task.roleId}` });
      requireCondition(result?.candidateId === candidate.id && result?.candidateFingerprint === candidate.fingerprint, `Prospective Fleet model result identity changed: ${task.roleId}`);
      const observation = createProspectiveFleetResultObservation({ intake: preflight.intake, assignment, specialist, result });
      results.push({ roleId: task.roleId, assignmentId: assignment.assignmentId, candidateId: candidate.id, candidateFingerprint: candidate.fingerprint, caseId: task.testCase.id, result, observation });
      // Persist the independently verified result before advancing the fleet controller. If
      // the process stops between these writes, restart records the saved observation without
      // repeating the model-backed business action.
      persistProgress({ file: progressPath, preflight, results, controller, runtime });
      controller.record(observation);
      persistProgress({ file: progressPath, preflight, results, controller, runtime });
      requireCondition(["running", "broad-goal-completed"].includes(controller.status().state), `Prospective Fleet halted after ${task.roleId}: ${controller.status().state}`);
    }
    const fleetStatus = controller.status();
    requireCondition(fleetStatus.parentGoalCompleted && results.length === tasks.length && runtime.evidence.verify(), "Prospective model-backed Fleet campaign did not complete safely");
    const summary = jsonStable({ schemaVersion: "das.prospective-fleet-model-result.v1", status: "completed", campaignId: preflight.plan.campaignId, planHash: preflight.plan.planHash, taskCount: tasks.length, results, fleetStatus, budget: runtime.budget.snapshot(), evidenceLedgerValid: true, evidenceBoundary: `Fresh prospective model-backed execution in ${tasks.length} fictional local role worlds. This is not customer evidence, arbitrary company intelligence or production reliability.` });
    summary.summaryHash = digest(summary);
    writePrivate(path.join(runtime.root, "summary.json"), summary);
    return summary;
  } catch (error) {
    const paused = error?.resumable === true;
    const status = error?.retryClass === "funding" ? "paused-awaiting-funds" : error?.retryClass === "rate-limit" ? "paused-rate-limited" : "failed";
    const failure = jsonStable({ schemaVersion: "das.prospective-fleet-model-failure.v1", status, resumable: paused, retryClass: error?.retryClass ?? null, campaignId: preflight.plan.campaignId, planHash: preflight.plan.planHash, error: error instanceof Error ? error.message : String(error), attemptedTasks: results.length, verifiedCompleteTasks: controller.status().assignments.verifiedComplete, results, fleetStatus: controller.status(), budget: runtime.budget.snapshot(), cacheEntries: runtime.cache.size(), evidenceLedgerValid: runtime.evidence.verify(), evidenceBoundary: paused ? "Preserved resumable prospective Fleet pause. Completed verified work and cached responses remain reusable; no Level 2 result should be inferred until every assignment completes." : "Preserved failed or interrupted prospective Fleet campaign. No Level 2 result should be inferred." });
    failure.failureHash = digest(failure);
    writePrivate(path.join(runtime.root, paused ? "latest-pause.json" : "latest-failure.json"), failure);
    const reported = error instanceof Error ? error : new Error(String(error));
    reported.prospectiveFleetFailure = failure;
    throw reported;
  }
}
