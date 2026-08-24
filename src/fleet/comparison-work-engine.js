// The single competence path of the comparison harness.
//
// EVERY unit of work in EVERY arm goes through executeAssignedUnits. Cost and
// latency are constants keyed by SYSTEM, never by agent or arm; capability to do
// the work is identical. Arms can therefore differ only in coordination: which
// agents activate, who gets which units, serial or parallel lanes, and what gets
// claimed afterward. Competence parity is not a promise — it is this file.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function executeAssignedUnits({ world, agentId, agentAuthorityActions, units, capacityRemaining }) {
  requireCondition(world && agentId && Array.isArray(agentAuthorityActions) && Array.isArray(units), "Engine execution needs a world, an agent and a unit list");
  let remaining = Number(capacityRemaining);
  requireCondition(Number.isFinite(remaining) && remaining >= 0, "Engine execution needs the agent's remaining capacity");
  const unitResults = [];
  let executedCount = 0;
  let replayedCount = 0;
  let deniedCount = 0;
  let notAttemptedCount = 0;
  let spendUsd = 0;
  let workLatencyMs = 0;
  for (const unit of units) {
    if (remaining <= 0) {
      unitResults.push({ recordId: unit.recordId, status: "not-attempted-capacity" });
      notAttemptedCount += 1;
      continue;
    }
    try {
      const outcome = world.applyWrite({ agentId, agentAuthorityActions, recordId: unit.recordId, action: unit.action, unitCostUsd: unit.unitCostUsd });
      remaining -= 1;
      workLatencyMs += unit.unitLatencyMs;
      if (outcome.replayed) {
        unitResults.push({ recordId: unit.recordId, status: "replayed" });
        replayedCount += 1;
      } else {
        unitResults.push({ recordId: unit.recordId, status: "executed" });
        executedCount += 1;
        spendUsd += unit.unitCostUsd;
      }
    } catch (error) {
      unitResults.push({ recordId: unit.recordId, status: "denied", reason: error.message });
      deniedCount += 1;
    }
  }
  return Object.freeze({
    agentId,
    unitResults,
    executedCount,
    replayedCount,
    deniedCount,
    notAttemptedCount,
    capacityRemaining: remaining,
    spendUsd: Number(spendUsd.toFixed(10)),
    workLatencyMs,
  });
}

export function unitsForWorkload(caseRecord, workloadId, constants) {
  const recordIds = caseRecord.workloadUnits[workloadId];
  requireCondition(Array.isArray(recordIds), `Case has no unit list for workload ${workloadId}`);
  const item = caseRecord.contractInput.workload.find((entry) => entry.id === workloadId);
  requireCondition(item, `Case contract has no workload ${workloadId}`);
  const system = item.requirement.systems[0];
  const table = constants.unitConstantsBySystem[system];
  requireCondition(table, `No unit constants for system ${system}`);
  const action = item.requirement.authorityActions[0];
  return recordIds.map((recordId) => ({ workloadId, recordId, action, unitCostUsd: table.unitCostUsd, unitLatencyMs: table.unitLatencyMs }));
}
