import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { assertBoundedFleetContract, assertBoundedSpecialistRecord } from "./bounded-level2-contract.js";
import { assertFleetAssignmentObservation } from "./bounded-level2-controller.js";
import { assertBoundedFleetPlan } from "./bounded-level2-planner.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

export function createBoundedFleetContinuation({ contract, priorPlan, priorControllerState, expandedPlan, expandedPlanVerification, addedSpecialist, activation }) {
  assertBoundedFleetContract(contract);
  assertBoundedFleetPlan(priorPlan);
  assertBoundedFleetPlan(expandedPlan);
  assertBoundedSpecialistRecord(addedSpecialist);
  requireCondition(priorControllerState?.integrityHash && digest(withoutHash(priorControllerState, "integrityHash")) === priorControllerState.integrityHash, "Prior fleet controller state integrity mismatch");
  requireCondition(priorControllerState.status === "routable-work-completed-role-gap-blocked" && priorControllerState.planHash === priorPlan.planHash, "Fleet continuation requires safely completed routable work and an exact blocked prior plan");
  requireCondition(expandedPlanVerification?.passed === true && expandedPlanVerification.planHash === expandedPlan.planHash, "Fleet continuation requires an independently verified expanded plan");
  requireCondition(expandedPlan.status === "fully-routable-awaiting-execution-approval" && expandedPlan.selected.roleGaps.length === 0, "Expanded fleet plan must safely cover every prior role gap");
  requireCondition(activation?.activated === true && activation.current === addedSpecialist.id, "Added fleet specialist lacks exact bounded activation evidence");
  const priorAssignmentHashes = new Set(priorPlan.selected.assignments.map((item) => item.assignmentHash));
  const expandedByHash = new Map(expandedPlan.selected.assignments.map((item) => [item.assignmentHash, item]));
  requireCondition([...priorAssignmentHashes].every((hash) => expandedByHash.has(hash)), "Expanded fleet plan changed already completed assignments");
  requireCondition(priorControllerState.observations.length === priorPlan.selected.assignments.length && priorControllerState.observations.every((item) => priorAssignmentHashes.has(item.assignmentHash) && item.verificationPassed && item.unsafeAttempts === 0 && item.incorrectSideEffects === 0), "Prior fleet work is not fully and safely verified");
  const gapWorkloads = new Set(priorPlan.selected.roleGaps.flatMap((gap) => gap.workloads.map((item) => item.id)));
  const residualAssignments = expandedPlan.selected.assignments.filter((item) => !priorAssignmentHashes.has(item.assignmentHash));
  requireCondition(residualAssignments.length > 0 && residualAssignments.every((item) => gapWorkloads.has(item.workloadId) && item.specialistHash === addedSpecialist.specialistHash), "Expanded plan includes unapproved or repeated residual work");
  const continuation = {
    schemaVersion: "das.bounded-fleet-continuation.v1",
    status: "awaiting-residual-execution-approval",
    contractHash: contract.contractHash,
    priorPlanHash: priorPlan.planHash,
    priorControllerStateHash: priorControllerState.integrityHash,
    expandedPlanHash: expandedPlan.planHash,
    addedSpecialistHash: addedSpecialist.specialistHash,
    activationHash: digest(activation),
    carriedAssignmentHashes: [...priorAssignmentHashes].sort(),
    carriedObservationHashes: priorControllerState.observations.map((item) => item.observationHash).sort(),
    residualAssignments: structuredClone(residualAssignments),
    authority: { executionAuthorized: false, modelSpendAuthorized: false, roleCreationAuthorized: false },
    evidenceBoundary: "Residual-only continuation plan. Previously verified assignments are carried by hash and cannot be repeated through this controller.",
  };
  continuation.continuationHash = digest(continuation);
  return Object.freeze(continuation);
}

export function assertBoundedFleetContinuation(continuation) {
  requireCondition(continuation?.schemaVersion === "das.bounded-fleet-continuation.v1", "Unsupported fleet continuation");
  requireCondition(continuation.continuationHash && digest(withoutHash(continuation, "continuationHash")) === continuation.continuationHash, "Fleet continuation integrity mismatch");
  requireCondition(Object.values(continuation.authority).every((item) => item === false), "Fleet continuation cannot silently grant authority");
  return true;
}

export class BoundedFleetContinuationController {
  constructor({ continuation, expandedPlan, specialists, filePath, now = () => new Date().toISOString(), state = null }) {
    assertBoundedFleetContinuation(continuation);
    assertBoundedFleetPlan(expandedPlan);
    specialists.forEach(assertBoundedSpecialistRecord);
    requireCondition(continuation.expandedPlanHash === expandedPlan.planHash && filePath, "Residual controller requires the exact expanded plan and durable path");
    this.continuation = continuation; this.expandedPlan = expandedPlan; this.specialists = new Map(specialists.map((item) => [item.id, item])); this.filePath = path.resolve(filePath); this.now = now;
    this.state = state ?? this.#initial();
    if (!state && fs.existsSync(this.filePath)) this.state = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    this.#assertState(this.state);
  }
  authorize({ approvedBy, continuationHash, assignmentHashes }) {
    requireCondition(this.state.status === "awaiting-residual-execution-approval", "Residual fleet work is not awaiting approval");
    const exact = this.continuation.residualAssignments.map((item) => item.assignmentHash).sort();
    requireCondition(approvedBy && continuationHash === this.continuation.continuationHash && JSON.stringify([...assignmentHashes].sort()) === JSON.stringify(exact), "Residual approval must bind the exact continuation and assignment set");
    this.state.authorization = { approvedBy: String(approvedBy), approvedAt: this.now(), assignmentHashes: exact };
    this.state.status = "residual-authorized"; this.save(); return this.status();
  }
  record(observation) {
    assertFleetAssignmentObservation(observation);
    requireCondition(observation.planHash === this.expandedPlan.planHash, "Residual observation belongs to another expanded plan");
    const assignment = this.continuation.residualAssignments.find((item) => item.assignmentId === observation.assignmentId);
    requireCondition(assignment?.assignmentHash === observation.assignmentHash, "Residual controller refuses repeated or unplanned work");
    const existing = this.state.observations.find((item) => item.assignmentId === observation.assignmentId);
    if (existing) { requireCondition(existing.observationHash === observation.observationHash, "Conflicting residual observation"); return this.status(); }
    requireCondition(["residual-authorized", "residual-running"].includes(this.state.status), "Residual work lacks exact execution approval");
    requireCondition(observation.specialistHash === assignment.specialistHash && this.specialists.get(observation.specialistId)?.specialistHash === assignment.specialistHash, "Residual specialist identity changed");
    this.state.observations.push(structuredClone(observation)); this.state.status = "residual-running";
    if (!observation.verificationPassed || observation.completedQuantity !== assignment.quantity || observation.unsafeAttempts > 0 || observation.incorrectSideEffects > 0) this.state.status = "halted";
    else if (this.state.observations.length === this.continuation.residualAssignments.length) this.state.status = "original-broad-goal-completed";
    this.save(); return this.status();
  }
  status() { return { schemaVersion: "das.bounded-fleet-continuation-status.v1", state: this.state.status, carriedAssignments: this.continuation.carriedAssignmentHashes.length, residualAssignments: this.continuation.residualAssignments.length, residualVerified: this.state.observations.filter((item) => item.verificationPassed).length, originalBroadGoalCompleted: this.state.status === "original-broad-goal-completed", evidenceBoundary: "Residual-only continuation state; carried work is referenced and not rerun." }; }
  snapshot() { const payload = structuredClone(this.state); delete payload.integrityHash; return { ...payload, integrityHash: digest(payload) }; }
  save() { const state = this.snapshot(); fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, this.filePath); this.state = state; return state; }
  static load(filePath, options) { return new BoundedFleetContinuationController({ ...options, filePath, state: JSON.parse(fs.readFileSync(filePath, "utf8")) }); }
  #initial() { const payload = { schemaVersion: "das.bounded-fleet-continuation-controller.v1", continuationHash: this.continuation.continuationHash, expandedPlanHash: this.expandedPlan.planHash, status: "awaiting-residual-execution-approval", authorization: null, observations: [] }; return { ...payload, integrityHash: digest(payload) }; }
  #assertState(state) { requireCondition(state?.schemaVersion === "das.bounded-fleet-continuation-controller.v1" && state.integrityHash === digest(withoutHash(state, "integrityHash")), "Fleet continuation controller integrity mismatch"); requireCondition(state.continuationHash === this.continuation.continuationHash && state.expandedPlanHash === this.expandedPlan.planHash, "Fleet continuation controller belongs to another plan"); }
}

