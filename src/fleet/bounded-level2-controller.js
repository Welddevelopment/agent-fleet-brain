import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { assertBoundedFleetContract, assertBoundedSpecialistRecord } from "./bounded-level2-contract.js";
import { assertBoundedFleetPlan } from "./bounded-level2-planner.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export function createFleetAssignmentObservation({ contract, plan, assignment, specialist, result }) {
  assertBoundedFleetContract(contract);
  assertBoundedFleetPlan(plan);
  assertBoundedSpecialistRecord(specialist);
  requireCondition(plan.selected?.assignments.some((item) => item.assignmentHash === assignment?.assignmentHash), "Fleet observation assignment is absent from the selected plan");
  requireCondition(assignment.specialistId === specialist.id && assignment.specialistHash === specialist.specialistHash, "Fleet observation specialist does not match the assignment");
  requireCondition(result?.independentlyVerified === true && result.verifierId === assignment.verifierId, "Fleet assignment needs its exact independent verifier");
  requireCondition(Number.isInteger(result.completedQuantity) && result.completedQuantity >= 0 && result.completedQuantity <= assignment.quantity, "Fleet observation completed quantity is invalid");
  requireCondition(Number.isFinite(result.actualCostUsd) && result.actualCostUsd >= 0, "Fleet observation actual cost is invalid");
  requireCondition(Number.isInteger(result.unsafeAttempts) && result.unsafeAttempts >= 0, "Fleet observation unsafe-attempt count is invalid");
  requireCondition(result.verificationReceiptHash, "Fleet observation needs an external verification receipt hash");
  const observation = {
    schemaVersion: "das.fleet-assignment-observation.v1",
    contractHash: contract.contractHash,
    planHash: plan.planHash,
    assignmentId: assignment.assignmentId,
    assignmentHash: assignment.assignmentHash,
    workloadId: assignment.workloadId,
    specialistId: specialist.id,
    specialistHash: specialist.specialistHash,
    verifierId: result.verifierId,
    independentlyVerified: true,
    verificationPassed: result.verificationPassed === true,
    completedQuantity: result.completedQuantity,
    actualCostUsd: result.actualCostUsd,
    unsafeAttempts: result.unsafeAttempts,
    incorrectSideEffects: Number(result.incorrectSideEffects ?? 0),
    verificationReceiptHash: String(result.verificationReceiptHash),
    evidenceBoundary: String(result.evidenceBoundary ?? "Independent specialist assignment outcome observation."),
  };
  requireCondition(Number.isInteger(observation.incorrectSideEffects) && observation.incorrectSideEffects >= 0, "Fleet observation incorrect-side-effect count is invalid");
  observation.observationHash = digest(observation);
  return Object.freeze(observation);
}

export function assertFleetAssignmentObservation(observation) {
  requireCondition(observation?.schemaVersion === "das.fleet-assignment-observation.v1", "Unsupported fleet assignment observation");
  requireCondition(observation.observationHash && digest(withoutHash(observation, "observationHash")) === observation.observationHash, "Fleet assignment observation integrity mismatch");
  requireCondition(observation.independentlyVerified === true, "Fleet assignment observation is not independently verified");
  return true;
}

export class BoundedFleetController {
  constructor({ contract, specialists, plan, planVerification, filePath, now = () => new Date().toISOString(), state = null }) {
    assertBoundedFleetContract(contract);
    assertBoundedFleetPlan(plan);
    specialists.forEach(assertBoundedSpecialistRecord);
    requireCondition(planVerification?.passed === true && planVerification.contractHash === contract.contractHash && planVerification.planHash === plan.planHash, "Fleet execution requires an independently verified exact plan");
    requireCondition(filePath, "Fleet controller requires an owner-controlled state path");
    this.contract = contract;
    this.specialists = new Map(specialists.map((item) => [item.id, item]));
    this.plan = plan;
    this.planVerification = planVerification;
    this.filePath = path.resolve(filePath);
    this.now = now;
    this.state = state ?? this.#initialState();
    if (!state && fs.existsSync(this.filePath)) this.state = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    this.#assertState(this.state);
  }

  authorizeAssignments({ approvedBy, planHash, assignmentHashes, maximumActualCostUsd }) {
    requireCondition(this.state.status === "awaiting-execution-approval", "Fleet assignments are not awaiting approval");
    requireCondition(approvedBy && planHash === this.plan.planHash, "Fleet execution needs an accountable owner and exact plan hash");
    const exact = this.plan.selected.assignments.map((item) => item.assignmentHash).sort();
    requireCondition(Array.isArray(assignmentHashes) && JSON.stringify([...assignmentHashes].sort()) === JSON.stringify(exact), "Fleet execution approval must cover the exact selected assignment set");
    const ceiling = Number(maximumActualCostUsd);
    requireCondition(Number.isFinite(ceiling) && ceiling >= this.plan.selected.metrics.totalCostUsd && ceiling <= this.contract.limits.maximumTotalCostUsd, "Fleet execution cost approval is outside the bounded plan");
    this.state.authorization = { approvedBy: String(approvedBy), approvedAt: this.now(), planHash, assignmentHashes: exact, maximumActualCostUsd: ceiling };
    this.state.status = "authorized-not-started";
    this.#event("fleet.assignments-authorized", { approvedBy: String(approvedBy), maximumActualCostUsd: ceiling });
    this.save();
    return this.status();
  }

  record(observation) {
    assertFleetAssignmentObservation(observation);
    requireCondition(observation.contractHash === this.contract.contractHash && observation.planHash === this.plan.planHash, "Fleet observation belongs to another plan");
    const assignment = this.plan.selected.assignments.find((item) => item.assignmentId === observation.assignmentId);
    requireCondition(assignment?.assignmentHash === observation.assignmentHash, "Fleet observation belongs to another assignment");
    const specialist = this.specialists.get(observation.specialistId);
    requireCondition(specialist?.specialistHash === observation.specialistHash && assignment.specialistId === specialist.id, "Fleet observation specialist identity changed");
    requireCondition(observation.verifierId === assignment.verifierId, "Fleet observation verifier changed after planning");
    const existing = this.state.observations.find((item) => item.assignmentId === observation.assignmentId);
    if (existing) {
      requireCondition(existing.observationHash === observation.observationHash, "Conflicting duplicate fleet observation");
      return this.status();
    }
    requireCondition(["authorized-not-started", "running"].includes(this.state.status), "Fleet controller is not authorized to accept assignment outcomes");
    this.state.status = "running";
    this.state.observations.push(structuredClone(observation));
    this.#event("fleet.assignment-observed", { assignmentId: observation.assignmentId, verificationPassed: observation.verificationPassed, completedQuantity: observation.completedQuantity });
    if (!observation.verificationPassed || observation.unsafeAttempts > 0 || observation.incorrectSideEffects > 0 || observation.completedQuantity !== assignment.quantity) {
      this.state.halt = { assignmentId: observation.assignmentId, reason: observation.incorrectSideEffects > 0 ? "incorrect-side-effect" : observation.unsafeAttempts > 0 ? "unsafe-attempt" : observation.verificationPassed ? "incomplete-assignment" : "verification-failed", haltedAt: this.now() };
      this.state.status = "halted";
      this.#event("fleet.halted", this.state.halt);
    } else {
      const actual = this.state.observations.reduce((sum, item) => sum + item.actualCostUsd, 0);
      if (actual > this.state.authorization.maximumActualCostUsd) {
        this.state.halt = { assignmentId: observation.assignmentId, reason: "actual-cost-ceiling-exceeded", haltedAt: this.now() };
        this.state.status = "halted";
        this.#event("fleet.halted", this.state.halt);
      } else if (this.state.observations.length === this.plan.selected.assignments.length) {
        this.state.status = this.plan.selected.roleGaps.length ? "routable-work-completed-role-gap-blocked" : "broad-goal-completed";
        this.#event("fleet.routable-work-completed", { parentCompleted: this.state.status === "broad-goal-completed", roleGapCount: this.plan.selected.roleGaps.length });
      }
    }
    this.save();
    return this.status();
  }

  prepareRoleGap({ requestHash, approvedBy }) {
    requireCondition(this.state.status === "routable-work-completed-role-gap-blocked", "Role gap can be prepared only after all routable work completes safely");
    const gap = this.plan.selected.roleGaps.find((item) => item.requestHash === requestHash);
    requireCondition(gap && approvedBy, "Role-gap preparation requires an exact request and accountable owner");
    requireCondition(!this.state.roleGapPreparations.some((item) => item.requestHash === requestHash), "Role gap is already prepared");
    const preparation = {
      schemaVersion: "das.fleet-role-gap-preparation.v1",
      status: "approved-to-prepare-level1-contract",
      requestHash,
      approvedBy: String(approvedBy),
      approvedAt: this.now(),
      requirement: structuredClone(gap.requirement),
      workloads: structuredClone(gap.workloads),
      authority: { modelSpendAuthorized: false, roleCreationAuthorized: false, activationAuthorized: false },
      nextStep: "Prepare a separate Level 1 intake, cases, independent verifier and explicit model-campaign approval.",
    };
    preparation.preparationHash = digest(preparation);
    this.state.roleGapPreparations.push(preparation);
    this.#event("fleet.role-gap-prepared", { requestHash, approvedBy: String(approvedBy) });
    this.save();
    return structuredClone(preparation);
  }

  status() {
    const actualCostUsd = this.state.observations.reduce((sum, item) => sum + item.actualCostUsd, 0);
    return {
      schemaVersion: "das.bounded-fleet-status.v1",
      state: this.state.status,
      contractHash: this.contract.contractHash,
      planHash: this.plan.planHash,
      assignments: { total: this.plan.selected.assignments.length, verifiedComplete: this.state.observations.filter((item) => item.verificationPassed && item.unsafeAttempts === 0 && item.incorrectSideEffects === 0).length },
      roleGaps: this.plan.selected.roleGaps.length,
      parentGoalCompleted: this.state.status === "broad-goal-completed",
      actualCostUsd,
      halt: structuredClone(this.state.halt),
      roleGapPreparations: structuredClone(this.state.roleGapPreparations),
      evidenceBoundary: "Durable bounded fleet execution-control state. Parent completion requires every assignment and no unresolved role gap.",
    };
  }

  snapshot() {
    const payload = structuredClone(this.state);
    delete payload.integrityHash;
    return { ...payload, integrityHash: digest(payload) };
  }

  save() {
    const state = this.snapshot();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
    this.state = state;
    return structuredClone(state);
  }

  static load(filePath, options) {
    return new BoundedFleetController({ ...options, filePath, state: JSON.parse(fs.readFileSync(filePath, "utf8")) });
  }

  #initialState() {
    const payload = { schemaVersion: "das.bounded-fleet-controller.v1", contractHash: this.contract.contractHash, planHash: this.plan.planHash, specialistHashes: [...this.specialists.values()].map((item) => item.specialistHash), status: "awaiting-execution-approval", authorization: null, observations: [], roleGapPreparations: [], halt: null, events: [] };
    return { ...payload, integrityHash: digest(payload) };
  }

  #assertState(state) {
    requireCondition(state?.schemaVersion === "das.bounded-fleet-controller.v1", "Unsupported fleet controller state");
    requireCondition(state.integrityHash && digest(withoutHash(state, "integrityHash")) === state.integrityHash, "Fleet controller state integrity mismatch");
    requireCondition(state.contractHash === this.contract.contractHash && state.planHash === this.plan.planHash, "Fleet controller state belongs to another plan");
    requireCondition(JSON.stringify(state.specialistHashes) === JSON.stringify([...this.specialists.values()].map((item) => item.specialistHash)), "Fleet specialist portfolio changed after planning");
  }

  #event(type, details) {
    this.state.events.push({ at: this.now(), type, ...structuredClone(details) });
  }
}
