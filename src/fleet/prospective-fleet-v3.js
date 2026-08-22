import { PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL, PROSPECTIVE_FLEET_CAMPAIGN_ID } from "./prospective-fleet-campaign.js";
import { prospectiveFleetV3Cases } from "./prospective-fleet-v3-cases.js";

/**
 * V3 — a larger model-backed fleet campaign (PROP-0006, approved by Joel under
 * APR-0003 on 2026-08-20).
 *
 * SCOPE NOTE, read before quoting this. PROP-0006 asked for "4 roles, 20-30
 * items". V3 ships THREE roles, not four. The fleet plan can only bind exact
 * specialists admitted from the sealed Level 1 registry, and that registry
 * holds exactly three: procurement, support and revops. A fourth role needs a
 * new Level 1 selection, which is separate work and a separate approval. Joel
 * chose the three-role scope on 2026-08-22 once that was established.
 *
 * The item count IS delivered: 22 sub-items against V2's 9.
 *
 * CEILING NOTE. APR-0003 records a $5 ceiling. V3 cannot reach it. The fleet's
 * hard spend limit is derived, not chosen - it is the sum of the three
 * specialists' per-task ceilings, $1.30 - and the authorization check refuses
 * any explicit limit above it. Treat $1.30 as the real cap and $5 as headroom
 * that will never be used.
 */
export const PROSPECTIVE_FLEET_V3_CAMPAIGN_ID = "prospective-bounded-level2-model-campaign-v3";

/**
 * V3 gets its own approval token. Reusing V2's would let an operator approve
 * one campaign and start the other - which is precisely the mistake that a
 * paid V3 attempt hit on 2026-08-22, when the runner was still hardcoded to
 * V2's id and would have re-run an already-completed campaign.
 */
export const PROSPECTIVE_FLEET_V3_APPROVAL = "JOEL_APPROVED_PROSPECTIVE_FLEET_V3";

export const PROSPECTIVE_FLEET_V3_ARTIFACT_ROOT = "artifacts/fleet/prospective-model-campaign-v3";

/**
 * Raised from V2's defaults (20/48/56) because V3's cases carry more sub-items
 * per case. V2 spent 9/17/26 tool calls on 2/3/4 sub-items; V3 carries 5/8/9.
 * These are ceilings, not targets - cost stays bounded independently by each
 * role's maxCostPerTaskUsd, which is the guard that actually stops spending.
 * The plan schema caps any ceiling at 128.
 */
export const PROSPECTIVE_FLEET_V3_TURN_CEILINGS = Object.freeze({
  "realistic-procurement-specialist": 48,
  "realistic-support-operations-specialist": 80,
  "realistic-revenue-operations-specialist": 96,
});

export const PROSPECTIVE_FLEET_V3_CAMPAIGN = Object.freeze({
  campaignId: PROSPECTIVE_FLEET_V3_CAMPAIGN_ID,
  campaignApproval: PROSPECTIVE_FLEET_V3_APPROVAL,
  artifactRoot: PROSPECTIVE_FLEET_V3_ARTIFACT_ROOT,
  approvedBy: "joel-exact-prospective-fleet-v3",
  tenantPrefix: "prospective-fleet-v3",
  preflight: Object.freeze({
    cases: prospectiveFleetV3Cases,
    campaignId: PROSPECTIVE_FLEET_V3_CAMPAIGN_ID,
    campaignApproval: PROSPECTIVE_FLEET_V3_APPROVAL,
    turnCeilingsByRole: PROSPECTIVE_FLEET_V3_TURN_CEILINGS,
  }),
});

/** The existing V2 campaign, expressed in the same shape so the runner has one code path. */
export const PROSPECTIVE_FLEET_V2_CAMPAIGN = Object.freeze({
  campaignId: PROSPECTIVE_FLEET_CAMPAIGN_ID,
  campaignApproval: PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL,
  artifactRoot: "artifacts/fleet/prospective-model-campaign-v2",
  approvedBy: "joel-exact-prospective-fleet-v2",
  tenantPrefix: "prospective-fleet-v2",
  preflight: Object.freeze({}),
});
