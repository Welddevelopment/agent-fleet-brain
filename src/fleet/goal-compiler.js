import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { assertCompanyConstitution } from "./constitution.js";
import { compileFleetPlanningIntake } from "./fleet-intake.js";

// The bounded goal compiler — the missing quarter of Fleet Brain's own ladder rung.
//
// The planner has always RECEIVED work already itemised; nothing decomposed. This
// module adds decomposition with an honest boundary: the mapping from a broad
// objective to outcome classes is DECLARED by the company (like adapters declare
// operations), and trusted code verifies it — complete coverage, acyclic
// dependencies, no invented operations, authority inside the constitution. The
// compiler binds a declared decomposition to live workload; it does not generate
// strategy from the goal string, and it refuses anything undeclared rather than
// improvising. That is bounded declared-template decomposition, not open-ended
// strategic decomposition — the canonical doc lists the latter as not existing,
// and this module does not change that.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function verifySealed(record, hashKey, label) {
  requireCondition(record?.[hashKey] && digest(withoutHash(record, hashKey)) === record[hashKey], `${label} integrity mismatch`);
}

export function createDeclaredObjective(input) {
  requireCondition(input?.companyId && input?.objectiveId, "A declared objective needs a company and objective id");
  const statement = String(input.statement ?? "").trim();
  requireCondition(statement.length >= 20, "A declared objective needs a meaningful statement");
  requireCondition(Array.isArray(input.outcomeClasses) && input.outcomeClasses.length > 0, "A declared objective needs at least one outcome class");
  const ids = new Set();
  const selectors = new Set();
  const outcomeClasses = input.outcomeClasses.map((raw) => {
    const id = String(raw?.id ?? "").trim();
    requireCondition(id && !ids.has(id), `Outcome class ids must be unique and present (${id || "missing"})`);
    ids.add(id);
    const adapterId = String(raw.selector?.adapterId ?? "").trim();
    const operationId = String(raw.selector?.operationId ?? "").trim();
    requireCondition(adapterId && operationId, `Outcome class ${id} needs an adapter and operation selector`);
    const selectorKey = `${adapterId}::${operationId}`;
    requireCondition(!selectors.has(selectorKey), `Outcome classes cannot double-claim operation ${selectorKey}`);
    selectors.add(selectorKey);
    return {
      id,
      description: String(raw.description ?? "").trim(),
      selector: { adapterId, operationId },
      required: raw.required !== false,
      dependsOn: [...new Set((raw.dependsOn ?? []).map((item) => String(item).trim()).filter(Boolean))].sort(),
    };
  });
  for (const outcomeClass of outcomeClasses) {
    for (const dependency of outcomeClass.dependsOn) {
      requireCondition(ids.has(dependency), `Outcome class ${outcomeClass.id} depends on undeclared class ${dependency}`);
      requireCondition(dependency !== outcomeClass.id, `Outcome class ${outcomeClass.id} cannot depend on itself`);
    }
  }
  const record = {
    schemaVersion: "fleetbrain.declared-objective.v1",
    companyId: String(input.companyId),
    objectiveId: String(input.objectiveId),
    kind: String(input.kind ?? "declared-operational-objective"),
    statement,
    outcomeClasses,
    declaredBy: String(input.declaredBy ?? "company-owner"),
    evidenceBoundary: "A company-declared mapping from one broad objective to bounded outcome classes over trusted adapter operations. Declaration is human; verification is trusted code. This is not autonomous strategic decomposition.",
  };
  record.objectiveHash = digest(record);
  return Object.freeze(record);
}

export function assertDeclaredObjective(objective) {
  requireCondition(objective?.schemaVersion === "fleetbrain.declared-objective.v1", "Unsupported declared objective");
  verifySealed(objective, "objectiveHash", "Declared objective");
  return true;
}

function topologicalOrder(nodes) {
  const order = [];
  const marks = new Map();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visit = (id, trail) => {
    const mark = marks.get(id);
    if (mark === "done") return;
    requireCondition(mark !== "visiting", `Objective dependencies contain a cycle: ${[...trail, id].join(" -> ")}`);
    marks.set(id, "visiting");
    for (const dependency of byId.get(id).dependsOn) visit(dependency, [...trail, id]);
    marks.set(id, "done");
    order.push(id);
  };
  for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id))) visit(node.id, []);
  return order;
}

export function compileGoalWorkGraph({ objective, adapters, snapshots, constitution = null }) {
  assertDeclaredObjective(objective);
  requireCondition(Array.isArray(adapters) && adapters.length > 0 && Array.isArray(snapshots) && snapshots.length > 0, "Goal compilation needs trusted adapters and fresh snapshots");
  const adaptersById = new Map();
  for (const adapter of adapters) {
    verifySealed(adapter, "descriptorHash", `Adapter ${adapter?.id ?? "unknown"}`);
    adaptersById.set(adapter.id, adapter);
  }
  for (const snapshot of snapshots) {
    verifySealed(snapshot, "snapshotHash", `Snapshot for ${snapshot?.adapterId ?? "unknown"}`);
    const adapter = adaptersById.get(snapshot.adapterId);
    requireCondition(adapter && snapshot.adapterDescriptorHash === adapter.descriptorHash, `Snapshot does not match its trusted adapter: ${snapshot.adapterId}`);
  }
  if (constitution) assertCompanyConstitution(constitution);

  // Resolve every outcome class against the declared operations — nothing invented.
  const classesBySelector = new Map();
  for (const outcomeClass of objective.outcomeClasses) {
    const adapter = adaptersById.get(outcomeClass.selector.adapterId);
    requireCondition(adapter, `Outcome class ${outcomeClass.id} references an untrusted adapter: ${outcomeClass.selector.adapterId}`);
    const operation = adapter.operations[outcomeClass.selector.operationId];
    requireCondition(operation, `Outcome class ${outcomeClass.id} references an operation no trusted adapter declares: ${outcomeClass.selector.operationId}`);
    if (constitution) {
      const prohibited = new Set(constitution.prohibitedActions);
      const offending = operation.requirement.authorityActions.filter((action) => prohibited.has(action));
      requireCondition(offending.length === 0, `Outcome class ${outcomeClass.id} requires prohibited actions: ${offending.join(", ")}`);
    }
    classesBySelector.set(`${outcomeClass.selector.adapterId}::${outcomeClass.selector.operationId}`, { outcomeClass, adapter, operation });
  }

  // Map every snapshot item to exactly one outcome class. Orphan work is refused —
  // an objective that does not account for current workload has incomplete coverage.
  const itemsByClass = new Map(objective.outcomeClasses.map((item) => [item.id, []]));
  for (const snapshot of snapshots) {
    for (const item of snapshot.items) {
      const entry = classesBySelector.get(`${snapshot.adapterId}::${item.operationId}`);
      requireCondition(entry, `Workload item ${item.id} (${snapshot.adapterId}::${item.operationId}) is not covered by any declared outcome class`);
      itemsByClass.get(entry.outcomeClass.id).push({ id: item.id, volume: item.volume, dueWithinMs: item.dueWithinMs, maximumUnitCostUsd: item.maximumUnitCostUsd, minimumOutcomeScore: item.minimumOutcomeScore, snapshotHash: snapshot.snapshotHash });
    }
  }

  const droppedOptionalClasses = [];
  const nodes = [];
  for (const outcomeClass of objective.outcomeClasses) {
    const entry = classesBySelector.get(`${outcomeClass.selector.adapterId}::${outcomeClass.selector.operationId}`);
    const items = itemsByClass.get(outcomeClass.id);
    if (items.length === 0) {
      requireCondition(!outcomeClass.required, `Required outcome class ${outcomeClass.id} has no current workload — the objective cannot complete`);
      droppedOptionalClasses.push(outcomeClass.id);
      continue;
    }
    nodes.push({
      id: outcomeClass.id,
      description: outcomeClass.description,
      adapterId: entry.adapter.id,
      operationId: outcomeClass.selector.operationId,
      systemId: entry.adapter.systemId,
      outcome: entry.operation.outcome,
      risk: entry.operation.risk,
      requirement: structuredClone(entry.operation.requirement),
      verifierId: entry.operation.requirement.verifierId,
      workloadItemIds: items.map((item) => item.id).sort(),
      totalVolume: items.reduce((sum, item) => sum + item.volume, 0),
      dependsOn: outcomeClass.dependsOn.filter((id) => !droppedOptionalClasses.includes(id)),
    });
  }
  requireCondition(nodes.length > 0, "The objective produced no work at all");
  const executionOrder = topologicalOrder(nodes);
  for (const node of nodes) {
    node.sharesSystemWith = nodes.filter((other) => other.id !== node.id && other.systemId === node.systemId).map((other) => other.id).sort();
  }

  const totalItems = snapshots.reduce((sum, snapshot) => sum + snapshot.items.length, 0);
  const graph = {
    schemaVersion: "fleetbrain.goal-work-graph.v1",
    companyId: objective.companyId,
    objectiveId: objective.objectiveId,
    objectiveHash: objective.objectiveHash,
    constitutionHash: constitution ? constitution.constitutionHash : "",
    adapterDescriptorHashes: [...adaptersById.values()].map((adapter) => adapter.descriptorHash).sort(),
    snapshotHashes: snapshots.map((snapshot) => snapshot.snapshotHash).sort(),
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    executionOrder,
    coverage: {
      snapshotItems: totalItems,
      mappedItems: nodes.reduce((sum, node) => sum + node.workloadItemIds.length, 0),
      orphanItems: 0,
      droppedOptionalClasses: droppedOptionalClasses.sort(),
    },
    authority: { executionAuthorized: false, modelSpendAuthorized: false, roleCreationAuthorized: false },
    evidenceBoundary: "A typed work graph compiled from a company-declared objective over trusted adapter workload. Coverage, acyclicity, operation grounding and constitutional authority were verified by trusted code. Declared decomposition, not open-ended strategic decomposition; grants no execution authority.",
  };
  requireCondition(graph.coverage.mappedItems === totalItems, "Goal compilation lost workload items");
  graph.graphHash = digest(graph);
  return Object.freeze(graph);
}

export function assertGoalWorkGraph(graph) {
  requireCondition(graph?.schemaVersion === "fleetbrain.goal-work-graph.v1", "Unsupported goal work graph");
  verifySealed(graph, "graphHash", "Goal work graph");
  requireCondition(Object.values(graph.authority).every((value) => value === false), "A goal work graph cannot grant authority");
  return true;
}

export function bindWorkGraphToContract({ graph, contract }) {
  assertGoalWorkGraph(graph);
  requireCondition(contract?.schemaVersion === "das.bounded-fleet-contract.v1", "Graph binding requires a bounded fleet contract");
  const graphItems = new Map(graph.nodes.flatMap((node) => node.workloadItemIds.map((id) => [id, node.id])));
  const contractItems = new Set(contract.workload.map((item) => item.id));
  const missingFromContract = [...graphItems.keys()].filter((id) => !contractItems.has(id)).sort();
  const missingFromGraph = [...contractItems].filter((id) => !graphItems.has(id)).sort();
  requireCondition(missingFromContract.length === 0 && missingFromGraph.length === 0, `Graph and contract cover different work (graph-only: ${missingFromContract.join(",") || "none"}; contract-only: ${missingFromGraph.join(",") || "none"})`);
  const receipt = {
    schemaVersion: "fleetbrain.goal-compilation-receipt.v1",
    status: "objective-decomposed-and-bound",
    companyId: graph.companyId,
    objectiveId: graph.objectiveId,
    objectiveHash: graph.objectiveHash,
    graphHash: graph.graphHash,
    contractHash: contract.contractHash,
    constitutionHash: graph.constitutionHash,
    coverage: "exact",
    nodeCount: graph.nodes.length,
    workloadItems: graph.coverage.mappedItems,
    evidenceBoundary: "Binds one verified work graph to one bounded fleet contract covering exactly the same workload. The existing planning pipeline runs unchanged below this receipt.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}

// The one-call decomposition path: declared objective + trusted adapters/snapshots
// (+ optional constitution) -> work graph + bounded contract + binding receipt.
export function compileObjectiveIntake({ objective, adapters, snapshots, constitution = null, tenantId, planningWindow, priorities, limits, now, maximumSnapshotAgeMs }) {
  assertDeclaredObjective(objective);
  const graph = compileGoalWorkGraph({ objective, adapters, snapshots, constitution });
  const intake = compileFleetPlanningIntake({
    companyId: objective.companyId,
    tenantId,
    goal: objective.statement,
    planningWindow,
    priorities,
    limits,
    adapters,
    snapshots,
    ...(now ? { now } : {}),
    ...(maximumSnapshotAgeMs ? { maximumSnapshotAgeMs } : {}),
  });
  const receipt = bindWorkGraphToContract({ graph, contract: intake.contract });
  return Object.freeze({ objective, graph, intake, receipt });
}
