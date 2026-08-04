import { doNothingStrategy, referenceProcurementStrategy } from "../evaluation/realistic-procurement-strategies.js";
import { runRealisticProcurementCampaign } from "../evaluation/realistic-procurement-campaign.js";
import { doNothingRevopsStrategy, evaluateRevopsStrategy, referenceRevopsStrategy } from "../evaluation/realistic-revops-strategies.js";
import { doNothingSupportStrategy, evaluateSupportStrategy, referenceSupportStrategy } from "../evaluation/realistic-support-strategies.js";
import { commercialProcurementCases } from "../product/commercial-procurement-cases.js";
import { commercialRevopsCases } from "../worlds/realistic-revops-cases.js";
import { commercialSupportCases } from "../worlds/realistic-support-cases.js";
import { runFleetIntakeFixture } from "./fleet-intake-fixture.js";
import { createProspectiveFleetCampaignPlan, createProspectiveFleetCaseVault } from "./prospective-fleet-campaign.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export async function runProspectiveFleetCampaignPreflight() {
  const initial = runFleetIntakeFixture();
  const selections = initial.admission.registry.selections;
  const maximumUnitCostByRole = Object.fromEntries(selections.map((selection) => [selection.roleId, selection.selected.candidate.limits.maxCostPerTaskUsd]));
  const hardLimit = Object.values(maximumUnitCostByRole).reduce((sum, value) => sum + value, 0);
  const intake = runFleetIntakeFixture({ maximumUnitCostByRole, maximumTotalCostUsd: hardLimit });
  const tasks = [
    { roleId: "realistic-procurement-specialist", testCase: commercialProcurementCases.unseen[0] },
    { roleId: "realistic-support-operations-specialist", testCase: commercialSupportCases.unseen[0] },
    { roleId: "realistic-revenue-operations-specialist", testCase: commercialRevopsCases.unseen[0] },
  ];
  const vault = createProspectiveFleetCaseVault(tasks);
  const plan = createProspectiveFleetCampaignPlan({ intake, selections, sealedTasks: vault });
  const procurement = await runRealisticProcurementCampaign({ suites: { development: [], validation: [], adversarial: [] }, unseenCases: [tasks[0].testCase], strategies: [referenceProcurementStrategy, doNothingStrategy] });
  const support = await Promise.all([referenceSupportStrategy, doNothingSupportStrategy].map((strategy) => evaluateSupportStrategy(strategy, tasks[1].testCase)));
  const revops = await Promise.all([referenceRevopsStrategy, doNothingRevopsStrategy].map((strategy) => evaluateRevopsStrategy(strategy, tasks[2].testCase)));
  const checks = {
    procurementReferencePassed: procurement.results.find((item) => item.strategyId === referenceProcurementStrategy.id)?.passed === true,
    procurementControlFailed: procurement.results.find((item) => item.strategyId === doNothingStrategy.id)?.passed === false,
    supportReferencePassed: support[0].verification.passed === true,
    supportControlFailed: support[1].verification.passed === false,
    revopsReferencePassed: revops[0].verification.passed === true,
    revopsControlFailed: revops[1].verification.passed === false,
    vaultStillSealed: vault.releaseCount() === 0,
    noTaskPayloadInPlan: !tasks.some((item) => JSON.stringify(plan).includes(item.testCase.id)),
    noAuthorityGranted: Object.values(plan.authority).every((value) => value === false),
  };
  requireCondition(Object.values(checks).every(Boolean), `Prospective fleet preflight failed: ${Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name).join(",")}`);
  return Object.freeze({ intake, selections, vault, plan, checks: Object.freeze(checks), evidenceBoundary: "Three fresh sealed fictional role tasks are runnable and discriminating under deterministic references, and are bound to exact selected Level 1 specialists in a zero-authority prospective fleet plan. No model task ran and no prospective Level 2 result exists." });
}
