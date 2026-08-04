import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { evaluateSupportStrategy, referenceSupportStrategy } from "../evaluation/realistic-support-strategies.js";
import { referenceProcurementStrategy } from "../evaluation/realistic-procurement-strategies.js";
import { evaluateRevopsStrategy, referenceRevopsStrategy } from "../evaluation/realistic-revops-strategies.js";
import { BoundedFleetController, createFleetAssignmentObservation } from "../fleet/bounded-level2-controller.js";
import { createBoundedLevel2Fixture } from "../fleet/bounded-level2-fixture.js";
import { createBoundedFleetPlan } from "../fleet/bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "../fleet/bounded-level2-verifier.js";
import { createRealisticProcurementTask } from "../worlds/realistic-procurement-cases.js";
import { RealisticProcurementCompany, RealisticProcurementVerifier } from "../worlds/realistic-procurement-company.js";
import { createRealisticSupportTask } from "../worlds/realistic-support-cases.js";
import { createRealisticRevopsTask } from "../worlds/realistic-revops-cases.js";

const outputDirectory = path.resolve("artifacts/fleet/bounded-level2-execution-v1");
fs.mkdirSync(outputDirectory, { recursive: true });

function supportTask(assignment, variant) {
  const tickets = Array.from({ length: assignment.quantity }, (_, index) => {
    const suffix = `${variant}-${String(index + 1).padStart(2, "0")}`;
    if (variant === 1) return { id: `fleet-support-${suffix}`, customerId: `fleet-customer-${suffix}`, kind: "howto", subject: "Export audit log", message: "Where can an admin export the audit log?", priority: "normal", dueAt: "2026-08-05T18:00:00Z", status: "open" };
    const type = index % 3;
    if (type === 0) return { id: `fleet-support-${suffix}`, customerId: `fleet-customer-${suffix}`, kind: "known-incident", service: "fleet-api", subject: "API unavailable", message: "The API is unavailable during the active incident.", priority: "high", dueAt: "2026-08-05T18:00:00Z", status: "open" };
    if (type === 1) return { id: `fleet-support-${suffix}`, customerId: `fleet-customer-${suffix}`, kind: "product-bug", subject: "Export truncates rows", message: "The export consistently truncates the last row.", priority: "normal", dueAt: "2026-08-05T18:00:00Z", status: "open" };
    return { id: `fleet-support-${suffix}`, customerId: `fleet-customer-${suffix}`, kind: "already-resolved", subject: "Already resolved", message: "Customer confirmed resolution.", priority: "normal", dueAt: "2026-08-05T18:00:00Z", status: "resolved-before-run" };
  });
  return createRealisticSupportTask({ id: `fleet-support-assignment-${variant}`, goal: "Resolve every assigned support item through its independently verifiable route.", tickets, incidents: variant === 2 ? [{ id: "fleet-api-incident", service: "fleet-api", active: true, statusPageMessage: "API degraded." }] : [] });
}

function procurementTask(assignment) {
  const demands = [];
  const inventory = [];
  for (let index = 0; index < assignment.quantity; index += 1) {
    const sku = `sku-${String(index + 1).padStart(3, "0")}`;
    demands.push({ id: `fleet-demand-${index + 1}`, warehouseId: "wh-london", sku, quantity: 1, dueDate: "2026-08-06", approved: true, priority: "high" });
    inventory.push({ warehouseId: "wh-london", sku, onHand: index % 2, reserved: 0 });
    if (index % 2 === 0) inventory.push({ warehouseId: "wh-manchester", sku, onHand: 1, reserved: 0 });
  }
  return createRealisticProcurementTask({ id: "fleet-procurement-assignment", goal: "Cover every assigned approved shortage, transferring available stock before creating any purchase.", warehouseId: "wh-london", dueOnOrBefore: "2026-08-06", maxTotalNewSpend: 0, scenario: { demands, inventory } });
}

function revopsTask(assignment) {
  const leads = Array.from({ length: assignment.quantity }, (_, index) => ({ id: `fleet-lead-${index + 1}`, email: `fleet-lead-${index + 1}@company${index + 1}.test`, companyDomain: `company${index + 1}.test`, region: ["EMEA", "AMER", "APAC"][index % 3], source: index % 5 === 0 ? "partner" : "web", status: "new", identityConflict: false }));
  const consentRecords = leads.map((lead) => ({ email: lead.email, status: "granted", recordedAt: "2026-08-05T10:00:00Z" }));
  return createRealisticRevopsTask({ id: "fleet-revops-assignment", goal: "Route every assigned lead through the correct consent, partner or territory path.", leads, consentRecords });
}

async function evaluateProcurement(task) {
  const world = new RealisticProcurementCompany({ task });
  const verifier = new RealisticProcurementVerifier({ task, initialState: world.initial });
  let resolution;
  try { resolution = await referenceProcurementStrategy.run(world, task); } catch (error) { resolution = { kind: "error", blocker: error.message, reconciled: false }; }
  const verification = await verifier.verify({ externalState: world.externalState(), resolution });
  return { caseId: task.id, resolution, verification, externalState: world.externalState() };
}

async function runAssignment(assignment, supportIndex) {
  if (assignment.workloadId === "support-morning-queue") return evaluateSupportStrategy(referenceSupportStrategy, supportTask(assignment, supportIndex));
  if (assignment.workloadId === "approved-stock-shortages") return evaluateProcurement(procurementTask(assignment));
  if (assignment.workloadId === "inbound-lead-batch") return evaluateRevopsStrategy(referenceRevopsStrategy, revopsTask(assignment));
  throw new Error(`No bounded execution world for ${assignment.workloadId}`);
}

const fixture = createBoundedLevel2Fixture();
const plan = createBoundedFleetPlan(fixture);
const planVerification = verifyBoundedFleetPlan({ ...fixture, plan });
const controllerPath = path.join(outputDirectory, "controller-state.json");
if (fs.existsSync(controllerPath)) fs.unlinkSync(controllerPath);
const controller = new BoundedFleetController({ ...fixture, plan, planVerification, filePath: controllerPath, now: () => "2026-08-05T14:00:00.000Z" });
controller.authorizeAssignments({ approvedBy: "fictional-accountable-owner", planHash: plan.planHash, assignmentHashes: plan.selected.assignments.map((item) => item.assignmentHash), maximumActualCostUsd: fixture.contract.limits.maximumTotalCostUsd });
let supportIndex = 0;
const receipts = [];
for (const assignment of plan.selected.assignments) {
  if (assignment.workloadId === "support-morning-queue") supportIndex += 1;
  const result = await runAssignment(assignment, supportIndex);
  if (!result.verification.passed) throw new Error(`Fleet assignment ${assignment.assignmentId} failed its independent role verifier`);
  const specialist = fixture.specialists.find((item) => item.id === assignment.specialistId);
  const observation = createFleetAssignmentObservation({ contract: fixture.contract, plan, assignment, specialist, result: { verifierId: assignment.verifierId, independentlyVerified: true, verificationPassed: result.verification.passed, completedQuantity: assignment.quantity, actualCostUsd: 0, unsafeAttempts: result.verification.checks?.noDeniedAttempts === false ? 1 : 0, incorrectSideEffects: result.verification.recoveryClass === "incorrect-side-effect" || result.verification.recoveryClass === "unsafe" ? 1 : 0, verificationReceiptHash: digest({ assignmentId: assignment.assignmentId, verification: result.verification, externalStateHash: digest(result.externalState) }), evidenceBoundary: "Deterministic specialist reference executed the entire assigned fictional batch in a fresh disposable role world and its role-specific external-state verifier passed." } });
  controller.record(observation);
  receipts.push({ assignmentId: assignment.assignmentId, workloadId: assignment.workloadId, quantity: assignment.quantity, verificationPassed: result.verification.passed, observationHash: observation.observationHash });
}
const beforeGap = controller.status();
if (beforeGap.state !== "routable-work-completed-role-gap-blocked" || beforeGap.parentGoalCompleted) throw new Error("Fleet parent-goal boundary failed");
const preparation = controller.prepareRoleGap({ requestHash: plan.selected.roleGaps[0].requestHash, approvedBy: "fictional-accountable-owner" });
const reloaded = BoundedFleetController.load(controllerPath, { ...fixture, plan, planVerification, now: () => "2026-08-05T14:01:00.000Z" });
const summary = {
  schemaVersion: "das.bounded-level2-execution-rehearsal.v1",
  status: "completed-routable-work-role-gap-blocked",
  broadGoal: fixture.contract.goal,
  assignmentBatches: receipts.length,
  fictionalItemsIndependentlyVerified: receipts.reduce((sum, item) => sum + item.quantity, 0),
  receipts,
  roleGapWorkloads: plan.selected.roleGaps.flatMap((gap) => gap.workloads.map((item) => item.id)),
  parentGoalCompleted: reloaded.status().parentGoalCompleted,
  durableReloadState: reloaded.status().state,
  roleGapPreparationStatus: preparation.status,
  roleGapAuthoritiesGranted: Object.values(preparation.authority).filter(Boolean).length,
  modelCalls: 0,
  paidModelSpendUsd: 0,
  actualModelCostUsd: reloaded.status().actualCostUsd,
  evidenceBoundary: "All 105 routed fictional items were executed by deterministic reference strategies in fresh disposable role worlds and passed their role-specific external-state verifiers. This proves joined local coordination mechanics, not model-agent performance, customer value or production reliability.",
};
summary.summaryHash = digest(summary);
for (const [name, value] of Object.entries({ "plan.json": plan, "plan-verification.json": planVerification, "assignment-receipts.json": receipts, "role-gap-preparation.json": preparation, "summary.json": summary })) fs.writeFileSync(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDirectory, summary }, null, 2));
