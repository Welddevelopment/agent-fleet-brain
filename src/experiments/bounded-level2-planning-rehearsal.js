import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { createBoundedLevel2Fixture } from "../fleet/bounded-level2-fixture.js";
import { createBoundedFleetPlan } from "../fleet/bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "../fleet/bounded-level2-verifier.js";

const outputDirectory = path.resolve("artifacts/fleet/bounded-level2-planning-v1");
const { contract, specialists } = createBoundedLevel2Fixture();
const plan = createBoundedFleetPlan({ contract, specialists });
const verification = verifyBoundedFleetPlan({ contract, specialists, plan });
if (!verification.passed) throw new Error("Bounded Level 2 plan failed independent verification");
const summary = {
  schemaVersion: "das.bounded-level2-planning-rehearsal.v1",
  status: "completed",
  broadGoal: contract.goal,
  workloadClasses: contract.workload.length,
  provedSpecialists: specialists.length,
  planStatus: plan.status,
  selectedStrategy: plan.selected.strategy,
  assignedVolume: plan.selected.metrics.assignedVolume,
  totalVolume: plan.selected.metrics.totalVolume,
  splitWorkloads: contract.workload.filter((item) => plan.selected.assignments.filter((assignment) => assignment.workloadId === item.id).length > 1).map((item) => item.id),
  roleGapWorkloads: plan.selected.roleGaps.flatMap((gap) => gap.workloads.map((item) => item.id)),
  totalEstimatedCostUsd: plan.selected.metrics.totalCostUsd,
  hardCostLimitUsd: contract.limits.maximumTotalCostUsd,
  verificationPassed: verification.passed,
  automaticAuthoritiesGranted: Object.values(plan.authority).filter(Boolean).length,
  modelCalls: 0,
  paidModelSpendUsd: 0,
  contractHash: contract.contractHash,
  planHash: plan.planHash,
  verificationHash: verification.verificationHash,
  evidenceBoundary: "Deterministic bounded planning over a fictional trusted workload inventory and fictional proved specialist records. No specialist executed, no role was created and no customer evidence is claimed.",
};
summary.summaryHash = digest(summary);
fs.mkdirSync(outputDirectory, { recursive: true });
for (const [name, value] of Object.entries({ "contract.json": contract, "specialists.json": specialists, "plan.json": plan, "verification.json": verification, "summary.json": summary })) fs.writeFileSync(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDirectory, summary }, null, 2));

