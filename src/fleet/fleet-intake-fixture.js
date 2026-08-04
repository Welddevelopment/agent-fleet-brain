import { createBoundedFleetPlan } from "./bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "./bounded-level2-verifier.js";
import { compileFleetPlanningIntake, createTrustedFleetAdapterDescriptor, createTrustedFleetWorkloadSnapshot } from "./fleet-intake.js";
import { runLevel1FleetAdmissionFixture } from "./level1-fleet-admission-fixture.js";

export function runFleetIntakeFixture({ maximumUnitCostByRole = {}, maximumTotalCostUsd = null } = {}) {
  const admission = runLevel1FleetAdmissionFixture();
  const tenantId = "fictional-company:local";
  const operationIds = { "realistic-procurement-specialist": "cover-approved-shortage", "realistic-support-operations-specialist": "resolve-assigned-ticket", "realistic-revenue-operations-specialist": "route-assigned-lead" };
  const outcomes = { "realistic-procurement-specialist": "Cover the approved shortage with the smallest safe draft action", "realistic-support-operations-specialist": "Resolve or precisely hand off the assigned support ticket", "realistic-revenue-operations-specialist": "Route the assigned lead while preserving consent and identity boundaries" };
  const adapters = admission.admissions.map(({ specialist }) => createTrustedFleetAdapterDescriptor({ id: `${specialist.roleId}:workload-adapter`, version: "1", tenantId, systemId: specialist.capability.systems[0], source: "customer-local-trusted-inventory", operations: { [operationIds[specialist.roleId]]: { outcome: outcomes[specialist.roleId], risk: "high", requirement: specialist.capability } } }));
  const snapshots = adapters.map((adapter) => {
    const specialist = admission.admissions.find((item) => item.specialist.capability.systems[0] === adapter.systemId).specialist;
    return createTrustedFleetWorkloadSnapshot({ descriptor: adapter, capturedAt: "2026-08-05T18:00:00.000Z", items: [{ id: `${adapter.systemId}:current-batch`, operationId: Object.keys(adapter.operations)[0], volume: 1, dueWithinMs: specialist.performance.medianLatencyMs, maximumUnitCostUsd: maximumUnitCostByRole[specialist.roleId] ?? specialist.performance.meanUnitCostUsd, minimumOutcomeScore: 1 }] });
  });
  const intake = compileFleetPlanningIntake({ companyId: "fictional-adapter-driven-company", tenantId, goal: "Clear the current approved procurement, support and CRM workload without crossing any configured authority boundary.", planningWindow: "adapter-driven-check", priorities: { quality: 1, cost: .2, speed: .1 }, limits: { maximumTotalCostUsd: maximumTotalCostUsd ?? admission.admissions.reduce((sum, item) => sum + item.specialist.performance.meanUnitCostUsd, 0), maximumNewRoleProposals: 0 }, adapters, snapshots, now: "2026-08-05T18:01:00.000Z" });
  const specialists = admission.admissions.map((item) => item.specialist);
  const plan = createBoundedFleetPlan({ contract: intake.contract, specialists });
  const verification = verifyBoundedFleetPlan({ contract: intake.contract, specialists, plan });
  if (!verification.passed || plan.selected?.metrics.assignedVolume !== 3) throw new Error("Trusted workload intake did not produce the expected bounded plan");
  return Object.freeze({ admission, adapters, snapshots, intake, plan, verification, evidenceBoundary: "Three fresh fictional customer-local adapter snapshots compiled into a 3/3 verified fleet plan. This is bounded input plumbing, not autonomous strategic decomposition or customer evidence." });
}
