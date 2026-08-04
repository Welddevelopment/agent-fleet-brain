import assert from "node:assert/strict";
import test from "node:test";
import { runLevel1FleetAdmissionFixture } from "../src/fleet/level1-fleet-admission-fixture.js";
import { admitLevel1SelectionToFleet, loadLevel1FleetRegistry } from "../src/fleet/level1-fleet-admission.js";

test("integrity-checked Level 1 selections enter an exact bounded fleet plan", () => {
  const result = runLevel1FleetAdmissionFixture();
  assert.equal(result.admissions.length, 3);
  assert.equal(result.plan.status, "fully-routable-awaiting-execution-approval");
  assert.equal(result.plan.selected.metrics.assignedVolume, 3);
  assert.equal(result.verification.passed, true);
  assert.ok(result.admissions.every((item) => item.receipt.observedEvidence.repeatabilityCases >= 6));
  assert.ok(result.admissions.every((item) => item.specialist.performance.capacityBasis === "owner-configured-hard-cap-not-throughput-proof"));
  assert.ok(Object.values(result.plan.authority).every((item) => item === false));
});

test("fleet admission refuses a capability wider than its selected Level 1 specialist", () => {
  const registry = loadLevel1FleetRegistry();
  const selection = registry.latest("realistic-support-operations-specialist");
  assert.throws(() => admitLevel1SelectionToFleet({ registry, roleId: selection.roleId, capability: { systems: ["support-local"], tools: ["read-ticket", "delete-account"], contextSources: ["assigned-ticket-queue"], authorityActions: ["draft-support-response"], verifierId: selection.selected.candidate.verifier.binding, policyHash: selection.compatibility.policyHash }, capacityPerWindow: 1 }), /widens/);
});
