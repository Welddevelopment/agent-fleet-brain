import assert from "node:assert/strict";
import test from "node:test";
import { runFleetIntakeFixture } from "../src/fleet/fleet-intake-fixture.js";
import { compileFleetPlanningIntake, createTrustedFleetWorkloadSnapshot } from "../src/fleet/fleet-intake.js";

test("fresh tenant-local adapter snapshots compile into an exact verified fleet plan", () => {
  const result = runFleetIntakeFixture();
  assert.equal(result.intake.receipt.snapshotReceipts.length, 3);
  assert.equal(result.plan.selected.metrics.assignedVolume, 3);
  assert.equal(result.verification.passed, true);
  assert.ok(Object.values(result.intake.receipt.authority).every((item) => item === false));
});

test("fleet intake rejects stale or cross-tenant workload snapshots", () => {
  const result = runFleetIntakeFixture();
  const args = { companyId: "x", tenantId: "fictional-company:local", goal: "Complete the exact bounded workload and preserve every configured authority boundary.", planningWindow: "x", priorities: { quality: 1, cost: 1, speed: 1 }, limits: { maximumTotalCostUsd: 1, maximumNewRoleProposals: 0 }, adapters: result.adapters, snapshots: result.snapshots };
  assert.throws(() => compileFleetPlanningIntake({ ...args, now: "2026-08-05T19:00:00.000Z" }), /stale/);
  const changed = structuredClone(result.snapshots[0]); delete changed.snapshotHash; changed.tenantId = "another-tenant";
  const descriptor = result.adapters[0];
  assert.throws(() => createTrustedFleetWorkloadSnapshot({ descriptor: { ...descriptor, tenantId: "another-tenant" }, capturedAt: changed.capturedAt, items: changed.items }), /integrity/);
});

test("fleet snapshot cannot invent an operation absent from its verified adapter", () => {
  const result = runFleetIntakeFixture();
  assert.throws(() => createTrustedFleetWorkloadSnapshot({ descriptor: result.adapters[0], capturedAt: "2026-08-05T18:00:00.000Z", items: [{ id: "invented", operationId: "delete-everything", volume: 1, dueWithinMs: 1, maximumUnitCostUsd: 1, minimumOutcomeScore: 1 }] }), /unsupported operation/);
});

test("fleet snapshot permits a zero-cost bound but rejects fractional work volume", () => {
  const result = runFleetIntakeFixture();
  const descriptor = result.adapters[0];
  const operationId = Object.keys(descriptor.operations)[0];
  const snapshot = createTrustedFleetWorkloadSnapshot({ descriptor, capturedAt: "2026-08-05T18:00:00.000Z", items: [{ id: "zero-cost", operationId, volume: 1, dueWithinMs: 1, maximumUnitCostUsd: 0, minimumOutcomeScore: 1 }] });
  assert.equal(snapshot.items[0].maximumUnitCostUsd, 0);
  assert.throws(() => createTrustedFleetWorkloadSnapshot({ descriptor, capturedAt: "2026-08-05T18:00:00.000Z", items: [{ id: "fractional", operationId, volume: .5, dueWithinMs: 1, maximumUnitCostUsd: 0, minimumOutcomeScore: 1 }] }), /must be an integer/);
});
