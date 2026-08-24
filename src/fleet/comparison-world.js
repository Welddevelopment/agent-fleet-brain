import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";

// The shared synthetic company world for the comparison harness.
//
// Fairness by construction: the world neither knows nor cares which ARM is acting.
// It knows agents, records, actions and authority. Idempotency is keyed by
// (agent, record, action) — one agent repeating its own write replays harmlessly;
// a SECOND agent writing the same record is a new effective write, which is exactly
// how duplicate work physically happens in a company.
//
// Two verification levels, deliberately different in scope:
// - verifyComparisonAssignmentScope sees ONE assignment's records and agents. It is
//   scope-blind by design — per-assignment checks structurally cannot see
//   cross-assignment duplicates. That blindness is the phenomenon under study.
// - verifyComparisonParentGoal sees the whole world plus company invariants no arm
//   was shown. It is the only judge of parent completion.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function createComparisonWorld({ caseRecord }) {
  requireCondition(caseRecord?.schemaVersion === "fleetbrain.comparison-case.v1", "Comparison world requires a sealed comparison case");
  const records = new Map();
  for (const shared of caseRecord.sharedRecords) {
    requireCondition(!records.has(shared.recordId), `Duplicate record in case: ${shared.recordId}`);
    records.set(shared.recordId, { recordId: shared.recordId, system: shared.system, workloadIds: [...shared.workloadIds], requiredAction: shared.requiredAction });
  }
  const effectiveWrites = [];
  const writeKeys = new Set();
  const deniedAttempts = [];

  return Object.freeze({
    recordIds: () => [...records.keys()].sort(),
    record: (recordId) => structuredClone(records.get(recordId) ?? null),
    applyWrite({ agentId, agentAuthorityActions, recordId, action, unitCostUsd }) {
      const record = records.get(recordId);
      if (!record) {
        deniedAttempts.push({ agentId, recordId, action, reason: "out-of-scope-record" });
        throw new Error(`Denied: record ${recordId} does not exist in this company`);
      }
      if (!agentAuthorityActions.includes(action)) {
        deniedAttempts.push({ agentId, recordId, action, reason: "missing-authority" });
        throw new Error(`Denied: agent ${agentId} lacks authority for ${action}`);
      }
      const key = `${agentId}:${recordId}:${action}`;
      if (writeKeys.has(key)) return { replayed: true, key };
      writeKeys.add(key);
      effectiveWrites.push({ key, agentId, recordId, action, unitCostUsd: Number(unitCostUsd) });
      return { replayed: false, key };
    },
    snapshot: () => ({
      records: [...records.values()].map((record) => structuredClone(record)).sort((left, right) => left.recordId.localeCompare(right.recordId)),
      effectiveWrites: structuredClone(effectiveWrites),
      deniedAttempts: structuredClone(deniedAttempts),
    }),
    initialDigest: () => digest({
      caseHash: caseRecord.caseHash,
      records: [...records.values()].sort((left, right) => left.recordId.localeCompare(right.recordId)),
    }),
  });
}

export function verifyComparisonAssignmentScope({ world, workloadId, recordIds, agentIds, claimedAction, verifierId }) {
  const state = world.snapshot();
  const scopedRecords = state.records.filter((record) => recordIds.includes(record.recordId));
  const scopedWrites = state.effectiveWrites.filter((write) => recordIds.includes(write.recordId));
  const scopedDenials = state.deniedAttempts.filter((denial) => agentIds.includes(denial.agentId));
  const checks = {
    everyScopedRecordWritten: scopedRecords.every((record) => scopedWrites.some((write) => write.recordId === record.recordId && write.action === claimedAction)),
    byScopedAgentsOnly: scopedWrites.every((write) => agentIds.includes(write.agentId)),
    noScopedDenials: scopedDenials.length === 0,
  };
  const receipt = {
    schemaVersion: "fleetbrain.comparison-assignment-verification.v1",
    verifierId: String(verifierId),
    workloadId: String(workloadId),
    independent: true,
    passed: Object.values(checks).every(Boolean),
    checks,
    scopedRecords: scopedRecords.length,
    scopedUnsafeAttempts: scopedDenials.length,
    evidenceBoundary: "Scope-blind by design: this verifier sees one assignment's records and agents only. Cross-assignment duplicates are structurally invisible here; parent-goal verification exists because of that.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}

export function verifyComparisonParentGoal({ world, contract, caseRecord }) {
  const state = world.snapshot();
  const duplicateDetails = [];
  const conflictDetails = [];
  let unitsCompleted = 0;
  for (const record of state.records) {
    const writes = state.effectiveWrites.filter((write) => write.recordId === record.recordId);
    const correct = writes.filter((write) => write.action === record.requiredAction);
    const incorrect = writes.filter((write) => write.action !== record.requiredAction);
    if (correct.length >= 1) unitsCompleted += 1;
    if (correct.length > 1) duplicateDetails.push({ recordId: record.recordId, count: correct.length, agents: correct.map((write) => write.agentId).sort() });
    if (incorrect.length > 0 && correct.length > 0) conflictDetails.push({ recordId: record.recordId, actions: [...new Set(writes.map((write) => write.action))].sort() });
  }
  const duplicates = duplicateDetails.reduce((sum, detail) => sum + detail.count - 1, 0);
  const conflicts = conflictDetails.length;
  const authorityViolations = state.deniedAttempts.length;
  const effectSpendUsd = Number(state.effectiveWrites.reduce((sum, write) => sum + write.unitCostUsd, 0).toFixed(10));

  const invariantViolations = [];
  if (effectSpendUsd > contract.limits.maximumTotalCostUsd) {
    invariantViolations.push({ invariant: "contract-hard-cost-limit", limitUsd: contract.limits.maximumTotalCostUsd, actualUsd: effectSpendUsd });
  }
  const escalationCap = caseRecord.companyInvariants?.maxEscalationsPerWindow;
  if (Number.isFinite(escalationCap)) {
    const escalations = state.effectiveWrites.filter((write) => write.action === "create-escalation").length;
    if (escalations > escalationCap) invariantViolations.push({ invariant: "max-escalations-per-window", limit: escalationCap, actual: escalations });
  }

  const unitsRequired = state.records.length;
  const incorrectEffects = duplicates + conflicts + invariantViolations.length;
  const verification = {
    schemaVersion: "fleetbrain.comparison-parent-verification.v1",
    independent: true,
    parentGoalCompleted: unitsCompleted === unitsRequired && duplicates === 0 && conflicts === 0 && invariantViolations.length === 0 && authorityViolations === 0,
    unitsRequired,
    unitsCompleted,
    duplicates,
    duplicateDetails: duplicateDetails.sort((left, right) => left.recordId.localeCompare(right.recordId)),
    conflicts,
    authorityViolations,
    invariantViolations,
    effectSpendUsd,
    incorrectEffects,
    evidenceBoundary: "World-truth aggregate verification: exactly-once completion of every record, no duplicates, no conflicts, no denials, and company invariants no arm was shown. The only judge of parent completion. Deterministic and fictional.",
  };
  verification.verificationHash = digest(verification);
  return Object.freeze(verification);
}
