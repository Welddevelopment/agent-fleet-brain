import { runProspectiveFleetModelCampaign } from "../fleet/prospective-fleet-campaign-runner.js";
import { PROSPECTIVE_FLEET_V3_CAMPAIGN } from "../fleet/prospective-fleet-v3.js";

/**
 * PAID. This spends real money. It refuses to start unless every gate is set:
 *
 *   DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED
 *   DAS_PROSPECTIVE_FLEET_APPROVAL=JOEL_APPROVED_PROSPECTIVE_FLEET_V3
 *   DAS_PROSPECTIVE_FLEET_PLAN_HASH=<the frozen V3 plan hash>
 *   DAS_PROSPECTIVE_FLEET_LIMIT_USD=<covers every task, at most the frozen $1.30>
 *   DAS_PROSPECTIVE_FLEET_PRICING_VERIFIED_ON=<today, UTC>
 *   DAS_PROSPECTIVE_FLEET_PRICING_TABLE_HASH=<the plan's pricing hash>
 *
 * Run src/experiments/prospective-fleet-v3-preflight.js first; it freezes the
 * plan this runner must match. A tie, a role-gap stop or a loss is a valid
 * result and is preserved either way.
 */
try {
  const result = await runProspectiveFleetModelCampaign({ campaign: PROSPECTIVE_FLEET_V3_CAMPAIGN });
  console.log(JSON.stringify({ status: result.status, campaignId: result.campaignId, taskCount: result.taskCount, fleetStatus: result.fleetStatus, budget: result.budget, evidenceLedgerValid: result.evidenceLedgerValid, evidenceBoundary: result.evidenceBoundary }, null, 2));
} catch (error) {
  console.error(JSON.stringify(error.prospectiveFleetFailure ?? { status: "failed", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
