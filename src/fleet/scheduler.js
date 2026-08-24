import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { assertBoundedFleetContract, assertBoundedSpecialistRecord } from "./bounded-level2-contract.js";
import { assertBoundedFleetPlan } from "./bounded-level2-planner.js";
import { assertGoalWorkGraph } from "./goal-compiler.js";

// The fleet scheduler and conflict controller.
//
// From an INDEPENDENTLY VERIFIED plan (and optionally the goal work graph) it
// derives a deterministic execution schedule: dependency-ordered waves, one writer
// per external system at a time, one assignment per specialist at a time, duplicate
// refusal, and an independent re-check of per-specialist capacity. It re-verifies
// what the planner already enforced rather than trusting it — the same refusal-first
// duplication the verifier applies to the planner. The schedule grants no authority;
// execution approval still runs through the durable controller's exact-hash gate.
//
// Latency figures are planning estimates from proved specialist medians. The wave
// latency is a resource-lane makespan bound: for each contended resource (an external
// system, or one specialist's own time) the assignments sharing it must serialize, so
// the wave cannot finish faster than its busiest lane. No timestamps, no randomness —
// the schedule is a pure function of its inputs, ties broken by assignment hash.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function nodeForWorkload(graph, workloadId) {
  return graph.nodes.find((node) => node.workloadItemIds.includes(workloadId)) ?? null;
}

export function createExecutionSchedule({ contract, plan, planVerification, specialists, graph = null }) {
  assertBoundedFleetContract(contract);
  assertBoundedFleetPlan(plan);
  requireCondition(plan.contractHash === contract.contractHash, "Schedule requires the plan for this exact contract");
  requireCondition(planVerification?.passed === true && planVerification.planHash === plan.planHash && planVerification.contractHash === contract.contractHash, "Never schedule an unverified plan");
  specialists.forEach(assertBoundedSpecialistRecord);
  requireCondition(plan.selected, "Cannot schedule a plan with no selected variant");
  if (graph) {
    assertGoalWorkGraph(graph);
    for (const assignment of plan.selected.assignments) {
      requireCondition(nodeForWorkload(graph, assignment.workloadId), `Assignment ${assignment.assignmentId} covers work the graph does not contain: ${assignment.workloadId}`);
    }
  }
  const assignments = plan.selected.assignments;

  // Duplicate refusal: repeated assignment hashes or the same workload handed twice
  // to the same specialist are refused, never silently deduplicated.
  const seenHashes = new Set();
  const seenPairs = new Set();
  for (const assignment of assignments) {
    requireCondition(!seenHashes.has(assignment.assignmentHash), `Duplicate assignment in plan: ${assignment.assignmentId}`);
    seenHashes.add(assignment.assignmentHash);
    const pair = `${assignment.workloadId}::${assignment.specialistId}`;
    requireCondition(!seenPairs.has(pair), `Workload ${assignment.workloadId} is assigned twice to specialist ${assignment.specialistId}`);
    seenPairs.add(pair);
  }

  // Independent capacity re-check.
  const byId = new Map(specialists.map((item) => [item.id, item]));
  const load = new Map();
  for (const assignment of assignments) {
    const specialist = byId.get(assignment.specialistId);
    requireCondition(specialist && specialist.specialistHash === assignment.specialistHash, `Assignment ${assignment.assignmentId} names an unknown or changed specialist`);
    load.set(specialist.id, (load.get(specialist.id) ?? 0) + assignment.quantity);
  }
  for (const [specialistId, quantity] of load) {
    const capacity = byId.get(specialistId).performance.capacityPerWindow;
    requireCondition(quantity <= capacity, `Specialist ${specialistId} is over capacity: ${quantity} > ${capacity}`);
  }

  // Dependency waves. With a graph, an assignment's wave is one past the deepest
  // wave among its node's dependencies; without one, everything shares wave 0.
  const nodeWave = new Map();
  if (graph) {
    for (const nodeId of graph.executionOrder) {
      const node = graph.nodes.find((item) => item.id === nodeId);
      const depth = node.dependsOn.length === 0 ? 0 : Math.max(...node.dependsOn.map((dependency) => nodeWave.get(dependency))) + 1;
      nodeWave.set(nodeId, depth);
    }
  }
  const systemOf = (assignment) => {
    if (graph) return nodeForWorkload(graph, assignment.workloadId).systemId;
    const item = contract.workload.find((entry) => entry.id === assignment.workloadId);
    return item.requirement.systems[0];
  };
  const waveOf = (assignment) => (graph ? nodeWave.get(nodeForWorkload(graph, assignment.workloadId).id) : 0);

  const waveCount = graph ? Math.max(...[...nodeWave.values()]) + 1 : 1;
  const waves = [];
  const serializations = [];
  for (let index = 0; index < waveCount; index += 1) {
    const inWave = assignments
      .filter((assignment) => waveOf(assignment) === index)
      .sort((left, right) => left.assignmentHash.localeCompare(right.assignmentHash));
    if (inWave.length === 0) continue;

    // Contended resources: an external system, and one specialist's own time.
    // Assignments sharing either must serialize; the wave cannot finish faster
    // than its busiest resource lane.
    const lanes = new Map();
    for (const assignment of inWave) {
      for (const resource of [`system:${systemOf(assignment)}`, `specialist:${assignment.specialistId}`]) {
        if (!lanes.has(resource)) lanes.set(resource, []);
        lanes.get(resource).push(assignment);
      }
    }
    for (const [resource, queue] of [...lanes.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      if (queue.length > 1) {
        serializations.push({
          waveIndex: waves.length,
          resource,
          serializedAssignmentIds: queue.map((item) => item.assignmentId),
          reason: resource.startsWith("system:") ? "single-writer-per-system" : "one-assignment-per-specialist-at-a-time",
        });
      }
    }
    const laneLatencies = [...lanes.entries()].map(([resource, queue]) => ({ resource, laneLatencyMs: queue.reduce((sum, item) => sum + item.expectedLatencyMs, 0) }));
    waves.push({
      waveIndex: waves.length,
      assignments: inWave.map((assignment) => ({
        assignmentId: assignment.assignmentId,
        assignmentHash: assignment.assignmentHash,
        workloadId: assignment.workloadId,
        specialistId: assignment.specialistId,
        systemId: systemOf(assignment),
        quantity: assignment.quantity,
        expectedLatencyMs: assignment.expectedLatencyMs,
      })),
      laneLatencies: laneLatencies.sort((left, right) => left.resource.localeCompare(right.resource)),
      waveLatencyMs: Math.max(...laneLatencies.map((lane) => lane.laneLatencyMs)),
    });
  }

  const scheduledLatencyMs = waves.reduce((sum, wave) => sum + wave.waveLatencyMs, 0);
  const serialLatencyMs = assignments.reduce((sum, item) => sum + item.expectedLatencyMs, 0);
  const schedule = {
    schemaVersion: "fleetbrain.execution-schedule.v1",
    contractHash: contract.contractHash,
    planHash: plan.planHash,
    planVerified: true,
    graphHash: graph ? graph.graphHash : "",
    specialistHashes: [...byId.values()].map((item) => ({ id: item.id, specialistHash: item.specialistHash })).sort((left, right) => left.id.localeCompare(right.id)),
    waves,
    conflictControls: {
      serializations,
      duplicateAssignmentsRefused: true,
      capacityIndependentlyReverified: true,
    },
    metrics: {
      assignments: assignments.length,
      waves: waves.length,
      parallelPeak: Math.max(...waves.map((wave) => wave.assignments.length)),
      scheduledLatencyMs,
      serialLatencyMs,
      parallelSpeedup: scheduledLatencyMs > 0 ? serialLatencyMs / scheduledLatencyMs : 1,
    },
    authority: { executionAuthorized: false, modelSpendAuthorized: false },
    evidenceBoundary: "A deterministic execution schedule derived from an independently verified plan: dependency-ordered waves, one writer per system, one assignment per specialist at a time, duplicates refused, capacity independently re-verified. Latency figures are planning estimates from proved specialist medians, not measured runtime. The schedule grants no authority.",
  };
  schedule.scheduleHash = digest(schedule);
  return Object.freeze(schedule);
}

export function assertExecutionSchedule(schedule) {
  requireCondition(schedule?.schemaVersion === "fleetbrain.execution-schedule.v1", "Unsupported execution schedule");
  requireCondition(schedule.scheduleHash && digest(withoutHash(schedule, "scheduleHash")) === schedule.scheduleHash, "Execution schedule integrity mismatch");
  requireCondition(Object.values(schedule.authority).every((value) => value === false), "An execution schedule cannot grant authority");
  requireCondition(schedule.planVerified === true, "An execution schedule must derive from a verified plan");
  return true;
}
