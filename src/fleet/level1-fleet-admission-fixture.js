import { createBoundedFleetContract } from "./bounded-level2-contract.js";
import { createBoundedFleetPlan } from "./bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "./bounded-level2-verifier.js";
import { admitLevel1SelectionToFleet, loadLevel1FleetRegistry } from "./level1-fleet-admission.js";

const DESCRIPTORS = [
  { roleId: "realistic-procurement-specialist", workloadId: "approved-shortage", system: "procurement-local", tools: ["read-inventory", "draft-purchase-order"], contextSources: ["approved-demand", "purchasing-policy"], authorityActions: ["draft-order"], verifierId: "realistic-procurement-external-state-v1" },
  { roleId: "realistic-support-operations-specialist", workloadId: "assigned-ticket", system: "support-local", tools: ["read-ticket", "draft-response"], contextSources: ["assigned-ticket-queue", "support-policy"], authorityActions: ["draft-support-response"], verifierId: "realistic-support-external-state-v1" },
  { roleId: "realistic-revenue-operations-specialist", workloadId: "assigned-lead", system: "crm-local", tools: ["read-lead", "assign-lead-owner"], contextSources: ["assigned-lead-queue", "routing-policy"], authorityActions: ["assign-lead-owner"], verifierId: "realistic-revops-external-state-v1" },
];

export function runLevel1FleetAdmissionFixture({ registryPath = "artifacts/level1/registry-v1.json", repositoryRoot = "." } = {}) {
  const registry = loadLevel1FleetRegistry(registryPath);
  const selections = new Map(registry.list().map((selection) => [selection.roleId, selection]));
  const admissions = DESCRIPTORS.map((descriptor) => admitLevel1SelectionToFleet({
    registry,
    roleId: descriptor.roleId,
    repositoryRoot,
    capacityPerWindow: 1,
    capability: {
      systems: [descriptor.system],
      tools: descriptor.tools,
      contextSources: descriptor.contextSources,
      authorityActions: descriptor.authorityActions,
      verifierId: descriptor.verifierId,
      policyHash: selections.get(descriptor.roleId).compatibility.policyHash,
    },
  }));
  const contract = createBoundedFleetContract({
    companyId: "fictional-level1-registry-bridge",
    goal: "Route one bounded job to each exact specialist admitted from the integrity-checked Level 1 registry.",
    planningWindow: "registry-admission-check",
    workload: DESCRIPTORS.map((descriptor) => {
      const admitted = admissions.find((item) => item.specialist.roleId === descriptor.roleId).specialist;
      return { id: descriptor.workloadId, outcome: `Complete one ${descriptor.workloadId.replaceAll("-", " ")} safely`, source: `trusted-${descriptor.system}-adapter`, volume: 1, dueWithinMs: admitted.performance.medianLatencyMs, maximumUnitCostUsd: admitted.performance.meanUnitCostUsd, minimumOutcomeScore: 1, risk: "high", requirement: admitted.capability };
    }),
    priorities: { quality: 1, cost: .2, speed: .1 },
    limits: { maximumTotalCostUsd: admissions.reduce((sum, item) => sum + item.specialist.performance.meanUnitCostUsd, 0), maximumNewRoleProposals: 0 },
  });
  const specialists = admissions.map((item) => item.specialist);
  const plan = createBoundedFleetPlan({ contract, specialists });
  const verification = verifyBoundedFleetPlan({ contract, specialists, plan });
  if (!verification.passed || plan.selected?.metrics.assignedVolume !== 3) throw new Error("Level 1 registry specialists did not form an exact verified fleet plan");
  return Object.freeze({ registry: registry.snapshot(), admissions, contract, plan, verification, evidenceBoundary: "Three real integrity-checked local Level 1 selections were admitted into bounded fleet planning. The three-item route is planning evidence only; no task executed and conservative capacity is not throughput proof." });
}
