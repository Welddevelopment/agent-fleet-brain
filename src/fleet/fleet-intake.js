import { digest } from "../core/canonical.js";
import { createBoundedFleetContract } from "./bounded-level2-contract.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function positive(value, label) { const number = Number(value); requireCondition(Number.isFinite(number) && number > 0, `${label} must be positive`); return number; }
function nonnegative(value, label) { const number = Number(value); requireCondition(Number.isFinite(number) && number >= 0, `${label} must be nonnegative`); return number; }
function positiveInteger(value, label) { const number = positive(value, label); requireCondition(Number.isInteger(number), `${label} must be an integer`); return number; }

export function createTrustedFleetAdapterDescriptor(input) {
  requireCondition(input?.id && input?.version && input?.tenantId && input?.systemId && input?.source, "Fleet adapter descriptor needs exact identity, tenant, system and source");
  const operations = Object.fromEntries(Object.entries(input.operations ?? {}).map(([operationId, operation]) => {
    requireCondition(operationId && operation?.outcome && operation?.risk && operation?.requirement, `Fleet adapter operation ${operationId} is incomplete`);
    requireCondition(operation.requirement.systems?.length === 1 && operation.requirement.systems[0] === input.systemId, `Fleet adapter operation ${operationId} must stay inside its exact system`);
    return [operationId, { outcome: String(operation.outcome), risk: String(operation.risk), requirement: structuredClone(operation.requirement) }];
  }));
  requireCondition(Object.keys(operations).length > 0, "Fleet adapter descriptor needs at least one bounded operation");
  const descriptor = { schemaVersion: "das.trusted-fleet-adapter.v1", id: String(input.id), version: String(input.version), tenantId: String(input.tenantId), systemId: String(input.systemId), source: String(input.source), trustStatus: "verified-local", operations, evidenceBoundary: "Trusted customer-local workload adapter descriptor. It declares bounded inventory operations and grants no execution authority." };
  descriptor.descriptorHash = digest(descriptor);
  return Object.freeze(descriptor);
}

export function createTrustedFleetWorkloadSnapshot({ descriptor, capturedAt, items }) {
  requireCondition(descriptor?.schemaVersion === "das.trusted-fleet-adapter.v1" && descriptor.descriptorHash === digest(Object.fromEntries(Object.entries(descriptor).filter(([key]) => key !== "descriptorHash"))), "Fleet workload snapshot requires an integrity-checked adapter descriptor");
  const seen = new Set();
  const normalized = (items ?? []).map((item) => {
    requireCondition(item?.id && !seen.has(item.id), "Fleet adapter snapshot workload ids must be unique"); seen.add(item.id);
    requireCondition(descriptor.operations[item.operationId], `Fleet adapter snapshot requested unsupported operation: ${item.operationId}`);
    return { id: String(item.id), operationId: String(item.operationId), volume: positiveInteger(item.volume, `Fleet workload ${item.id} volume`), dueWithinMs: positive(item.dueWithinMs, `Fleet workload ${item.id} deadline`), maximumUnitCostUsd: nonnegative(item.maximumUnitCostUsd, `Fleet workload ${item.id} unit cost`), minimumOutcomeScore: positive(item.minimumOutcomeScore, `Fleet workload ${item.id} quality floor`) };
  });
  requireCondition(normalized.length > 0 && normalized.every((item) => item.minimumOutcomeScore <= 1), "Fleet adapter snapshot needs bounded workload and valid quality floors");
  const snapshot = { schemaVersion: "das.trusted-fleet-workload-snapshot.v1", adapterId: descriptor.id, adapterVersion: descriptor.version, adapterDescriptorHash: descriptor.descriptorHash, tenantId: descriptor.tenantId, systemId: descriptor.systemId, capturedAt: String(capturedAt), items: normalized, authority: { executionAuthorized: false, modelSpendAuthorized: false, roleCreationAuthorized: false } };
  snapshot.snapshotHash = digest(snapshot);
  return Object.freeze(snapshot);
}

export function compileFleetPlanningIntake({ companyId, tenantId, goal, planningWindow, priorities, limits, adapters, snapshots, now = new Date().toISOString(), maximumSnapshotAgeMs = 300_000 }) {
  requireCondition(companyId && tenantId && String(goal ?? "").trim().length >= 20, "Fleet intake needs a company, tenant and meaningful ordinary goal");
  requireCondition(Array.isArray(adapters) && adapters.length > 0 && Array.isArray(snapshots) && snapshots.length === adapters.length, "Fleet intake needs one fresh snapshot per trusted adapter");
  const adaptersById = new Map(adapters.map((adapter) => {
    requireCondition(adapter?.descriptorHash && adapter.descriptorHash === digest(Object.fromEntries(Object.entries(adapter).filter(([key]) => key !== "descriptorHash"))), "Fleet adapter descriptor integrity mismatch");
    requireCondition(adapter.tenantId === tenantId && !adapters.some((other) => other !== adapter && other.id === adapter.id), "Fleet adapters must be unique and tenant-local");
    return [adapter.id, adapter];
  }));
  const current = Date.parse(now);
  requireCondition(Number.isFinite(current) && maximumSnapshotAgeMs > 0, "Fleet intake clock or freshness limit is invalid");
  const workload = [];
  const snapshotReceipts = [];
  for (const snapshot of snapshots) {
    const copy = structuredClone(snapshot); const expected = copy.snapshotHash; delete copy.snapshotHash;
    requireCondition(expected && digest(copy) === expected, "Fleet workload snapshot integrity mismatch");
    const adapter = adaptersById.get(snapshot.adapterId);
    requireCondition(adapter && snapshot.adapterVersion === adapter.version && snapshot.adapterDescriptorHash === adapter.descriptorHash && snapshot.tenantId === tenantId && snapshot.systemId === adapter.systemId, "Fleet workload snapshot does not match its trusted tenant-local adapter");
    const captured = Date.parse(snapshot.capturedAt);
    requireCondition(Number.isFinite(captured) && captured <= current && current - captured <= maximumSnapshotAgeMs, `Fleet workload snapshot is stale or future-dated: ${snapshot.adapterId}`);
    requireCondition(Object.values(snapshot.authority).every((value) => value === false), "Fleet workload snapshot cannot grant authority");
    for (const item of snapshot.items) {
      const operation = adapter.operations[item.operationId];
      requireCondition(operation, `Fleet workload operation changed after adapter verification: ${item.operationId}`);
      workload.push({ id: item.id, outcome: operation.outcome, source: `${adapter.source}:${adapter.id}@${adapter.version}`, volume: item.volume, dueWithinMs: item.dueWithinMs, maximumUnitCostUsd: item.maximumUnitCostUsd, minimumOutcomeScore: item.minimumOutcomeScore, risk: operation.risk, requirement: structuredClone(operation.requirement) });
    }
    snapshotReceipts.push({ adapterId: adapter.id, descriptorHash: adapter.descriptorHash, snapshotHash: snapshot.snapshotHash, capturedAt: snapshot.capturedAt, items: snapshot.items.length });
  }
  requireCondition(snapshotReceipts.length === adapters.length && adapters.every((adapter) => snapshotReceipts.some((receipt) => receipt.adapterId === adapter.id)), "Fleet intake is missing a trusted adapter snapshot");
  const contract = createBoundedFleetContract({ companyId, goal: String(goal).trim(), planningWindow, workload, priorities, limits });
  const receipt = { schemaVersion: "das.fleet-planning-intake.v1", status: "contract-compiled-awaiting-plan", companyId: String(companyId), tenantId: String(tenantId), contractHash: contract.contractHash, snapshotReceipts, authority: { executionAuthorized: false, modelSpendAuthorized: false, roleCreationAuthorized: false, activationAuthorized: false }, evidenceBoundary: "Fresh trusted customer-local workload snapshots compiled into a bounded fleet contract. The ordinary goal is human-supplied; workload classification is adapter-declared, not autonomous strategic decomposition." };
  receipt.receiptHash = digest(receipt);
  return Object.freeze({ contract, receipt: Object.freeze(receipt) });
}
