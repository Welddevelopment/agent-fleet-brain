import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { runProspectiveFleetCampaignPreflight } from "../src/fleet/prospective-fleet-campaign-fixture.js";
import { runProspectiveFleetModelCampaign } from "../src/fleet/prospective-fleet-campaign-runner.js";
import { PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL, assertProspectiveFleetCampaignAuthorization } from "../src/fleet/prospective-fleet-campaign.js";
import { PROSPECTIVE_FLEET_V3_APPROVAL, PROSPECTIVE_FLEET_V3_CAMPAIGN, PROSPECTIVE_FLEET_V3_CAMPAIGN_ID, PROSPECTIVE_FLEET_V3_PRICING_USD, PROSPECTIVE_FLEET_V3_TURN_CEILINGS } from "../src/fleet/prospective-fleet-v3.js";
import { PROSPECTIVE_FLEET_V3_ITEM_COUNTS } from "../src/fleet/prospective-fleet-v3-cases.js";
import { CURRENT_MODEL_PRICING_USD } from "../src/providers/model-pricing.js";

const V2_FROZEN_PLAN_HASH = "997cd92e344c3f336c399fd1c7a46d9878f12b6e2a7ffbc56ef49f4bed06d5f9";

test("V2's frozen plan hash survives the campaign parameterization", async () => {
  // V2's committed plan artifact and completion receipt are both bound to this
  // hash. If parameterizing the fixture for V3 changed it, V2's preserved
  // evidence would stop verifying against its own runner.
  const result = await runProspectiveFleetCampaignPreflight();
  assert.equal(result.plan.planHash, V2_FROZEN_PLAN_HASH);
  assert.equal(result.plan.campaignId, "prospective-bounded-level2-model-campaign-v2");
});

test("V3 preflight seals three role tasks carrying 22 sub-items", async () => {
  const result = await runProspectiveFleetCampaignPreflight(PROSPECTIVE_FLEET_V3_CAMPAIGN.preflight);
  assert.equal(result.plan.campaignId, PROSPECTIVE_FLEET_V3_CAMPAIGN_ID);
  assert.notEqual(result.plan.planHash, V2_FROZEN_PLAN_HASH);
  assert.equal(result.plan.assignments.length, 3);
  assert.deepEqual(Object.fromEntries(result.plan.assignments.map((item) => [item.roleId, item.maximumModelTurns])), PROSPECTIVE_FLEET_V3_TURN_CEILINGS);

  // The item count is the thing PROP-0006 actually asked to grow: 9 -> 22.
  const subItems = Object.values(PROSPECTIVE_FLEET_V3_ITEM_COUNTS).reduce((sum, value) => sum + value, 0);
  assert.equal(subItems, 22);
  assert.ok(subItems >= 20 && subItems <= 30, "sub-item count must stay inside the preregistered 20-30 band");

  assert.ok(Object.values(result.checks).every(Boolean));
  assert.equal(result.vault.releaseCount(), 0);
  assert.ok(Object.values(result.plan.authority).every((value) => value === false));
});

test("V3 refuses V2's approval token, and V2 refuses V3's", async () => {
  // The 2026-08-22 near-miss: a runner hardcoded to V2's id would have re-run an
  // already-completed campaign. Separate tokens make that impossible.
  const v3 = await runProspectiveFleetCampaignPreflight(PROSPECTIVE_FLEET_V3_CAMPAIGN.preflight);
  const date = "2026-08-22";
  const base = { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED", DAS_PROSPECTIVE_FLEET_PLAN_HASH: v3.plan.planHash, DAS_PROSPECTIVE_FLEET_LIMIT_USD: String(v3.plan.hardSpendLimitUsd), DAS_PROSPECTIVE_FLEET_PRICING_VERIFIED_ON: date, DAS_PROSPECTIVE_FLEET_PRICING_TABLE_HASH: v3.plan.pricingTableHash, OPENAI_API_KEY: "test-key" };

  assert.throws(
    () => assertProspectiveFleetCampaignAuthorization({ plan: v3.plan, environment: { ...base, DAS_PROSPECTIVE_FLEET_APPROVAL: PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL }, pricingVerifiedDate: date, campaignApproval: PROSPECTIVE_FLEET_V3_APPROVAL }),
    /not explicitly approved/,
  );

  const authorization = assertProspectiveFleetCampaignAuthorization({ plan: v3.plan, environment: { ...base, DAS_PROSPECTIVE_FLEET_APPROVAL: PROSPECTIVE_FLEET_V3_APPROVAL }, pricingVerifiedDate: date, campaignApproval: PROSPECTIVE_FLEET_V3_APPROVAL });
  assert.equal(authorization.paidCallsAuthorized, true);
  assert.equal(authorization.campaignId, PROSPECTIVE_FLEET_V3_CAMPAIGN_ID);
  assert.equal(v3.vault.release({ plan: v3.plan, authorization }).length, 3);

  // And the other direction: V3's token must not start V2.
  const v2 = await runProspectiveFleetCampaignPreflight();
  const v2Base = { ...base, DAS_PROSPECTIVE_FLEET_PLAN_HASH: v2.plan.planHash, DAS_PROSPECTIVE_FLEET_LIMIT_USD: String(v2.plan.hardSpendLimitUsd), DAS_PROSPECTIVE_FLEET_PRICING_TABLE_HASH: v2.plan.pricingTableHash };
  assert.throws(
    () => assertProspectiveFleetCampaignAuthorization({ plan: v2.plan, environment: { ...v2Base, DAS_PROSPECTIVE_FLEET_APPROVAL: PROSPECTIVE_FLEET_V3_APPROVAL }, pricingVerifiedDate: date }),
    /not explicitly approved/,
  );
});

test("V3 cannot be authorized for APR-0003's $5 ceiling, only the derived $1.30", async () => {
  // APR-0003 records a $5 ceiling. The fleet's real cap is derived from the three
  // specialists' per-task ceilings and is not a number anyone gets to choose.
  const v3 = await runProspectiveFleetCampaignPreflight(PROSPECTIVE_FLEET_V3_CAMPAIGN.preflight);
  assert.equal(v3.plan.hardSpendLimitUsd, 1.3);
  const date = "2026-08-22";
  const base = { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED", DAS_PROSPECTIVE_FLEET_APPROVAL: PROSPECTIVE_FLEET_V3_APPROVAL, DAS_PROSPECTIVE_FLEET_PLAN_HASH: v3.plan.planHash, DAS_PROSPECTIVE_FLEET_PRICING_VERIFIED_ON: date, DAS_PROSPECTIVE_FLEET_PRICING_TABLE_HASH: v3.plan.pricingTableHash, OPENAI_API_KEY: "test-key" };

  for (const rejected of ["5", "1.31", "1.29", "0"]) {
    assert.throws(
      () => assertProspectiveFleetCampaignAuthorization({ plan: v3.plan, environment: { ...base, DAS_PROSPECTIVE_FLEET_LIMIT_USD: rejected }, pricingVerifiedDate: date, campaignApproval: PROSPECTIVE_FLEET_V3_APPROVAL }),
      /explicit limit/,
      `limit ${rejected} should be refused`,
    );
  }

  const ok = assertProspectiveFleetCampaignAuthorization({ plan: v3.plan, environment: { ...base, DAS_PROSPECTIVE_FLEET_LIMIT_USD: "1.3" }, pricingVerifiedDate: date, campaignApproval: PROSPECTIVE_FLEET_V3_APPROVAL });
  assert.equal(ok.limitUsd, 1.3);
});

test("V3 prices gpt-5.6-luna at the verified post-reduction rate, not the stale shared table", async () => {
  // The shared table still holds pre-reduction luna pricing, stale by exactly 5x.
  // It is deliberately not edited: V2's frozen plan hash includes its digest and
  // V2 is sealed evidence. V3 therefore carries its own table, as B3 does.
  assert.deepEqual(PROSPECTIVE_FLEET_V3_PRICING_USD["gpt-5.6-luna"], { inputPerMillionUsd: 0.2, cachedInputPerMillionUsd: 0.02, outputPerMillionUsd: 1.2 });
  assert.equal(CURRENT_MODEL_PRICING_USD["gpt-5.6-luna"].inputPerMillionUsd, 1);
  assert.equal(CURRENT_MODEL_PRICING_USD["gpt-5.6-luna"].outputPerMillionUsd, 6);

  const v3 = await runProspectiveFleetCampaignPreflight(PROSPECTIVE_FLEET_V3_CAMPAIGN.preflight);
  assert.equal(v3.plan.pricingTableHash, digest(PROSPECTIVE_FLEET_V3_PRICING_USD));
  assert.notEqual(v3.plan.pricingTableHash, digest(CURRENT_MODEL_PRICING_USD));

  // Every model V3 actually uses must be priced by V3's own table, or costs
  // would be computed from a table that does not cover them.
  for (const model of v3.plan.exactModels) assert.ok(PROSPECTIVE_FLEET_V3_PRICING_USD[model], `V3 pricing table is missing ${model}`);

  // V2 keeps the shared table, which is what its sealed receipt was priced with.
  const v2 = await runProspectiveFleetCampaignPreflight();
  assert.equal(v2.plan.pricingTableHash, digest(CURRENT_MODEL_PRICING_USD));
});

test("the runner refuses a campaign whose preflight built a different campaign", async () => {
  // Guards the exact shape of the near-miss: V3 paths requested, V2 cases built.
  const mismatched = { ...PROSPECTIVE_FLEET_V3_CAMPAIGN, preflight: {} };
  await assert.rejects(
    () => runProspectiveFleetModelCampaign({ campaign: mismatched, environment: {} }),
    /not the requested prospective-bounded-level2-model-campaign-v3/,
  );
});
