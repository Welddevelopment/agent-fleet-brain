import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { runProspectiveFleetCampaignPreflight } from "../fleet/prospective-fleet-campaign-fixture.js";
import { PROSPECTIVE_FLEET_V3_CAMPAIGN } from "../fleet/prospective-fleet-v3.js";
import { PROSPECTIVE_FLEET_V3_ITEM_COUNTS } from "../fleet/prospective-fleet-v3-cases.js";

// Zero spend. Proves the V3 cases are runnable and discriminating under the
// deterministic references, then freezes the plan the paid runner must match.
// No model call happens here and no Level 2 result exists after it.

const result = await runProspectiveFleetCampaignPreflight(PROSPECTIVE_FLEET_V3_CAMPAIGN.preflight);

if (result.plan.campaignId !== PROSPECTIVE_FLEET_V3_CAMPAIGN.campaignId) throw new Error(`V3 preflight built the wrong campaign: ${result.plan.campaignId}`);
if (result.plan.gates.requiredCampaignApproval !== `DAS_PROSPECTIVE_FLEET_APPROVAL=${PROSPECTIVE_FLEET_V3_CAMPAIGN.campaignApproval}`) throw new Error("V3 plan is not bound to the V3 approval token");

const itemCount = Object.values(PROSPECTIVE_FLEET_V3_ITEM_COUNTS).reduce((sum, value) => sum + value, 0);
// PROP-0006 asked for 20-30 sub-items. Assert it here so the number in the
// documents can never drift from the sealed cases.
if (itemCount < 20 || itemCount > 30) throw new Error(`V3 sub-item count ${itemCount} is outside the preregistered 20-30 band`);

const output = path.resolve(PROSPECTIVE_FLEET_V3_CAMPAIGN.artifactRoot);
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "plan.json"), `${JSON.stringify(result.plan, null, 2)}\n`);

const summary = {
  schemaVersion: "das.prospective-fleet-campaign-preflight.v3",
  status: "ready-awaiting-explicit-paid-approval",
  campaignId: result.plan.campaignId,
  planHash: result.plan.planHash,
  selectedSpecialists: result.plan.assignments.length,
  sealedTasks: result.plan.sealedTasks.count,
  subItemsByRole: PROSPECTIVE_FLEET_V3_ITEM_COUNTS,
  subItemCount: itemCount,
  maximumTaskEvaluations: result.plan.maximumTaskEvaluations,
  roleTurnCeilings: Object.fromEntries(result.plan.assignments.map((item) => [item.roleId, item.maximumModelTurns])),
  maximumModelTurns: result.plan.maximumModelTurns,
  hardSpendLimitUsd: result.plan.hardSpendLimitUsd,
  checks: result.checks,
  modelCalls: 0,
  paidModelSpendUsd: 0,
  scopeNote: "Three roles, not the four PROP-0006 suggested: the sealed Level 1 registry admits exactly three specialists and a fourth needs its own selection. Joel chose this scope on 2026-08-22. The 20-30 sub-item target IS met.",
  ceilingNote: `APR-0003 records a $5 ceiling. The fleet's derived hard limit is $${result.plan.hardSpendLimitUsd}, being the sum of the three specialists' per-task ceilings, and the authorization check refuses anything above it. $${result.plan.hardSpendLimitUsd} is the real cap.`,
  evidenceBoundary: result.evidenceBoundary,
};
summary.summaryHash = digest(summary);
fs.writeFileSync(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
