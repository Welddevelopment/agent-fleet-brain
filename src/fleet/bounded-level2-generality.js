import { createBoundedFleetContract } from "./bounded-level2-contract.js";
import { createBoundedLevel2Fixture } from "./bounded-level2-fixture.js";
import { createBoundedFleetPlan } from "./bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "./bounded-level2-verifier.js";
import { proveFinanceRoleGap } from "./finance-role-gap.js";

function contractFrom(base, { companyId, goal, planningWindow, workload, priorities, limits }) {
  return createBoundedFleetContract({
    companyId,
    goal,
    planningWindow,
    workload: workload ?? structuredClone(base.workload),
    priorities: priorities ?? structuredClone(base.priorities),
    limits,
  });
}

function changeWorkload(base, changes) {
  return base.workload.map((item) => ({ ...structuredClone(item), ...(changes[item.id] ?? {}) }));
}

function evaluateProfile({ id, contract, specialists, expected }) {
  const plan = createBoundedFleetPlan({ contract, specialists });
  const verification = verifyBoundedFleetPlan({ contract, specialists, plan });
  const result = {
    id,
    status: plan.status,
    verificationPassed: verification.passed,
    verificationOutcome: verification.outcome ?? "routable-plan-verified",
    assignedVolume: plan.selected?.metrics.assignedVolume ?? 0,
    totalVolume: plan.selected?.metrics.totalVolume ?? contract.workload.reduce((sum, item) => sum + item.volume, 0),
    roleGaps: plan.selected?.roleGaps.length ?? 0,
    blockerCodes: (plan.blockers ?? []).map((item) => item.code),
    executionAuthorityGranted: Object.values(plan.authority).some(Boolean),
  };
  const mismatches = Object.entries(expected).filter(([key, value]) => JSON.stringify(result[key]) !== JSON.stringify(value));
  if (mismatches.length) throw new Error(`Fleet generality profile ${id} missed expectations: ${mismatches.map(([key]) => key).join(", ")}`);
  return Object.freeze({ contract, plan, verification, result: Object.freeze(result) });
}

export function runBoundedFleetGeneralityMatrix() {
  const fixture = createBoundedLevel2Fixture();
  const basePlan = createBoundedFleetPlan({ contract: fixture.contract, specialists: fixture.specialists });
  const financeProof = proveFinanceRoleGap({ roleGap: basePlan.selected.roleGaps[0] });
  const expandedSpecialists = [...fixture.specialists, financeProof.specialist];
  const standard = contractFrom(fixture.contract, {
    companyId: "fictional-standard-operations",
    goal: "Complete the standard bounded operating day across support, procurement, CRM and finance.",
    planningWindow: "standard-day",
    limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 0 },
  });
  const surge = contractFrom(fixture.contract, {
    companyId: "fictional-support-surge",
    goal: "Clear a support-heavy operating surge while still completing the smaller procurement, CRM and finance batches.",
    planningWindow: "support-surge",
    workload: changeWorkload(fixture.contract, {
      "support-morning-queue": { volume: 80 },
      "approved-stock-shortages": { volume: 10 },
      "inbound-lead-batch": { volume: 5 },
      "unmatched-payments": { volume: 5 },
    }),
    priorities: { quality: .8, cost: .8, speed: .2 },
    limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 0 },
  });
  const compressed = contractFrom(fixture.contract, {
    companyId: "fictional-compressed-deadline",
    goal: "Complete only work that remains safe under a compressed support deadline and expose every unmet role or capacity boundary.",
    planningWindow: "compressed-deadline",
    workload: changeWorkload(fixture.contract, { "support-morning-queue": { dueWithinMs: 800 } }),
    limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 2 },
  });
  const roleLimited = contractFrom(fixture.contract, {
    companyId: "fictional-role-limited",
    goal: "Refuse a plan that would need more new role proposals than the owner permits.",
    planningWindow: "role-limited",
    workload: changeWorkload(fixture.contract, { "support-morning-queue": { dueWithinMs: 800 } }),
    limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
  });
  const budgetLocked = contractFrom(fixture.contract, {
    companyId: "fictional-budget-locked",
    goal: "Refuse execution when every available fleet plan exceeds the explicit zero-spend ceiling.",
    planningWindow: "budget-locked",
    limits: { maximumTotalCostUsd: 0, maximumNewRoleProposals: 1 },
  });

  const profiles = [
    evaluateProfile({ id: "expanded-standard", contract: standard, specialists: expandedSpecialists, expected: { status: "fully-routable-awaiting-execution-approval", verificationPassed: true, assignedVolume: 115, totalVolume: 115, roleGaps: 0, blockerCodes: [], executionAuthorityGranted: false } }),
    evaluateProfile({ id: "support-surge", contract: surge, specialists: expandedSpecialists, expected: { status: "fully-routable-awaiting-execution-approval", verificationPassed: true, assignedVolume: 100, totalVolume: 100, roleGaps: 0, blockerCodes: [], executionAuthorityGranted: false } }),
    evaluateProfile({ id: "compressed-deadline", contract: compressed, specialists: fixture.specialists, expected: { status: "partially-routable-awaiting-role-approval", verificationPassed: true, assignedVolume: 75, totalVolume: 115, roleGaps: 2, blockerCodes: [], executionAuthorityGranted: false } }),
    evaluateProfile({ id: "role-proposal-limit", contract: roleLimited, specialists: fixture.specialists, expected: { status: "blocked-by-bounded-limits", verificationPassed: true, assignedVolume: 0, totalVolume: 115, roleGaps: 0, blockerCodes: ["new-role-proposal-limit"], executionAuthorityGranted: false } }),
    evaluateProfile({ id: "hard-budget-limit", contract: budgetLocked, specialists: fixture.specialists, expected: { status: "blocked-by-bounded-limits", verificationPassed: true, assignedVolume: 0, totalVolume: 115, roleGaps: 0, blockerCodes: ["hard-cost-limit"], executionAuthorityGranted: false } }),
  ];
  return Object.freeze({
    schemaVersion: "das.bounded-level2-generality-matrix.v1",
    status: "completed",
    profiles,
    financeSpecialist: financeProof.specialist,
    checks: {
      samePlannerAcrossProfiles: true,
      noExecutionAuthorityGranted: profiles.every((profile) => !profile.result.executionAuthorityGranted),
      allPlansIndependentlyVerified: profiles.every((profile) => profile.verification.passed),
      fullAndPartialAndBlockedBranchesCovered: ["fully-routable-awaiting-execution-approval", "partially-routable-awaiting-role-approval", "blocked-by-bounded-limits"].every((status) => profiles.some((profile) => profile.plan.status === status)),
      hardBudgetAndRoleLimitsCovered: ["hard-cost-limit", "new-role-proposal-limit"].every((code) => profiles.some((profile) => profile.result.blockerCodes.includes(code))),
    },
    evidenceBoundary: "Five zero-cost fictional planning profiles exercise the same bounded planner and independent verifier. This is structural generality evidence, not model-agent performance, customer strategy or production scheduling.",
  });
}
