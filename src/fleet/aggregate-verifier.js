import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { assertFleetAssignmentObservation } from "./bounded-level2-controller.js";

// Aggregate combined-effects verification.
//
// Lesson 4 in the canonical doc: every assignment can look individually green while
// their combined external effects fail the parent objective — two specialists each
// correctly crediting the same account once, a budget envelope breached only in sum.
// Per-assignment verifiers cannot see across assignments by design; this module can,
// and only this module can, because it consumes ALL effect declarations at once.
//
// Effects are declared per assignment in sealed fleetbrain.* records bound to the
// exact das.* observation by assignment hash — the sealed observation schema itself
// is never modified.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export function createSharedInvariant(input) {
  const kind = String(input?.kind ?? "").trim();
  requireCondition(["at-most-once-per-target", "aggregate-budget-envelope", "max-action-count"].includes(kind), `Unsupported shared invariant kind: ${kind || "missing"}`);
  const record = {
    schemaVersion: "fleetbrain.shared-invariant.v1",
    id: String(input.id ?? "").trim(),
    kind,
    description: String(input.description ?? "").trim(),
    ...(kind === "at-most-once-per-target" ? { effectKind: String(input.effectKind ?? "").trim() } : {}),
    ...(kind === "aggregate-budget-envelope" ? { maximumTotalUsd: Number(input.maximumTotalUsd) } : {}),
    ...(kind === "max-action-count" ? { action: String(input.action ?? "").trim(), limit: Math.floor(Number(input.limit)) } : {}),
  };
  requireCondition(record.id, "A shared invariant needs an id");
  if (kind === "at-most-once-per-target") requireCondition(record.effectKind, "at-most-once-per-target needs the effect kind it constrains");
  if (kind === "aggregate-budget-envelope") requireCondition(Number.isFinite(record.maximumTotalUsd) && record.maximumTotalUsd >= 0, "aggregate-budget-envelope needs a finite ceiling");
  if (kind === "max-action-count") requireCondition(record.action && Number.isInteger(record.limit) && record.limit >= 0, "max-action-count needs the capped action and an integer limit");
  record.invariantHash = digest(record);
  return Object.freeze(record);
}

export function createAssignmentEffectDeclaration({ observation, effects }) {
  assertFleetAssignmentObservation(observation);
  requireCondition(Array.isArray(effects), "Effect declaration needs a list of external effects");
  const normalized = effects.map((effect, index) => {
    const kind = String(effect?.kind ?? "").trim();
    const target = String(effect?.target ?? "").trim();
    requireCondition(kind && target, `External effect ${index + 1} needs a kind and a target`);
    return { kind, target, amountUsd: Number(effect.amountUsd ?? 0) };
  });
  const declaration = {
    schemaVersion: "fleetbrain.assignment-effect-declaration.v1",
    assignmentId: observation.assignmentId,
    assignmentHash: observation.assignmentHash,
    observationHash: observation.observationHash,
    effects: normalized,
    evidenceBoundary: "External effects one verified assignment declares it made, bound to the exact sealed observation. Input to aggregate verification; grants nothing.",
  };
  declaration.declarationHash = digest(declaration);
  return Object.freeze(declaration);
}

export function verifyAggregateOutcome({ invariants, observations, effectDeclarations }) {
  requireCondition(Array.isArray(invariants) && invariants.length > 0, "Aggregate verification needs declared shared invariants");
  requireCondition(Array.isArray(observations) && observations.length > 0, "Aggregate verification needs the full observation set");
  observations.forEach(assertFleetAssignmentObservation);
  for (const invariant of invariants) {
    requireCondition(invariant?.schemaVersion === "fleetbrain.shared-invariant.v1" && invariant.invariantHash && digest(withoutHash(invariant, "invariantHash")) === invariant.invariantHash, "Shared invariant integrity mismatch");
  }
  const byAssignment = new Map();
  for (const declaration of effectDeclarations ?? []) {
    requireCondition(declaration?.schemaVersion === "fleetbrain.assignment-effect-declaration.v1" && declaration.declarationHash && digest(withoutHash(declaration, "declarationHash")) === declaration.declarationHash, "Effect declaration integrity mismatch");
    const observation = observations.find((item) => item.assignmentHash === declaration.assignmentHash);
    requireCondition(observation && observation.observationHash === declaration.observationHash, `Effect declaration is not bound to a recorded observation: ${declaration.assignmentId}`);
    requireCondition(!byAssignment.has(declaration.assignmentHash), `Duplicate effect declaration for assignment ${declaration.assignmentId}`);
    byAssignment.set(declaration.assignmentHash, declaration);
  }
  const allEffects = [...byAssignment.values()].flatMap((declaration) => declaration.effects.map((effect) => ({ ...effect, assignmentId: declaration.assignmentId })));

  const results = invariants.map((invariant) => {
    if (invariant.kind === "at-most-once-per-target") {
      const counts = new Map();
      for (const effect of allEffects.filter((item) => item.kind === invariant.effectKind)) {
        if (!counts.has(effect.target)) counts.set(effect.target, []);
        counts.get(effect.target).push(effect.assignmentId);
      }
      const violations = [...counts.entries()].filter(([, assignments]) => assignments.length > 1).map(([target, assignments]) => ({ target, assignments: assignments.sort() }));
      return { invariantId: invariant.id, kind: invariant.kind, passed: violations.length === 0, violations };
    }
    if (invariant.kind === "max-action-count") {
      const actionEffects = allEffects.filter((item) => item.kind === invariant.action);
      const passed = actionEffects.length <= invariant.limit;
      return { invariantId: invariant.id, kind: invariant.kind, passed, actionCount: actionEffects.length, limit: invariant.limit, violations: passed ? [] : [{ action: invariant.action, count: actionEffects.length, limit: invariant.limit, assignments: [...new Set(actionEffects.map((item) => item.assignmentId))].sort() }] };
    }
    // aggregate-budget-envelope
    const totalUsd = allEffects.reduce((sum, effect) => sum + effect.amountUsd, 0);
    const passed = totalUsd <= invariant.maximumTotalUsd;
    return { invariantId: invariant.id, kind: invariant.kind, passed, totalUsd, maximumTotalUsd: invariant.maximumTotalUsd, violations: passed ? [] : [{ exceededByUsd: totalUsd - invariant.maximumTotalUsd }] };
  });

  const individuallyGreen = observations.every((item) => item.verificationPassed && item.unsafeAttempts === 0 && item.incorrectSideEffects === 0);
  const receipt = {
    schemaVersion: "fleetbrain.aggregate-verification.v1",
    status: results.every((item) => item.passed) ? "aggregate-invariants-hold" : "combined-effects-violation",
    individuallyGreenObservations: individuallyGreen,
    observationHashes: observations.map((item) => item.observationHash).sort(),
    invariantHashes: invariants.map((item) => item.invariantHash).sort(),
    declarationHashes: [...byAssignment.values()].map((item) => item.declarationHash).sort(),
    results,
    evidenceBoundary: "Aggregate verification across every assignment's declared external effects. It can fail while every per-assignment verification passed — that combination is exactly what it exists to catch. Deterministic; grants nothing.",
  };
  receipt.aggregateHash = digest(receipt);
  return Object.freeze(receipt);
}

export function assertAggregateVerification(receipt) {
  requireCondition(receipt?.schemaVersion === "fleetbrain.aggregate-verification.v1", "Unsupported aggregate verification receipt");
  requireCondition(receipt.aggregateHash && digest(withoutHash(receipt, "aggregateHash")) === receipt.aggregateHash, "Aggregate verification integrity mismatch");
  return true;
}
