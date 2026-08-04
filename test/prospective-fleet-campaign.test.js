import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { runProspectiveFleetCampaignPreflight } from "../src/fleet/prospective-fleet-campaign-fixture.js";
import { PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL, assertProspectiveFleetCampaignAuthorization } from "../src/fleet/prospective-fleet-campaign.js";
import { CURRENT_MODEL_PRICING_USD } from "../src/providers/model-pricing.js";

test("fresh sealed tasks bind to exact selected specialists without pre-authorizing spend", async () => {
  const result = await runProspectiveFleetCampaignPreflight();
  assert.equal(result.plan.assignments.length, 3);
  assert.equal(result.plan.maximumTaskEvaluations, 3);
  assert.equal(result.plan.maximumModelTurns, 72);
  assert.equal(result.vault.releaseCount(), 0);
  assert.ok(Object.values(result.checks).every(Boolean));
  assert.ok(Object.values(result.plan.authority).every((value) => value === false));
});

test("prospective fleet authorization needs every independent current gate and exact plan hash", async () => {
  const result = await runProspectiveFleetCampaignPreflight();
  const date = "2026-08-05";
  const complete = { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED", DAS_PROSPECTIVE_FLEET_APPROVAL: PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL, DAS_PROSPECTIVE_FLEET_PLAN_HASH: result.plan.planHash, DAS_PROSPECTIVE_FLEET_LIMIT_USD: String(result.plan.hardSpendLimitUsd), DAS_PROSPECTIVE_FLEET_PRICING_VERIFIED_ON: date, DAS_PROSPECTIVE_FLEET_PRICING_TABLE_HASH: digest(CURRENT_MODEL_PRICING_USD), OPENAI_API_KEY: "test-key" };
  for (const key of Object.keys(complete)) { const environment = { ...complete }; delete environment[key]; assert.throws(() => assertProspectiveFleetCampaignAuthorization({ plan: result.plan, environment, pricingVerifiedDate: date })); }
  assert.throws(() => assertProspectiveFleetCampaignAuthorization({ plan: result.plan, environment: { ...complete, DAS_PROSPECTIVE_FLEET_PLAN_HASH: "0".repeat(64) }, pricingVerifiedDate: date }), /exact plan/);
  const authorization = assertProspectiveFleetCampaignAuthorization({ plan: result.plan, environment: complete, pricingVerifiedDate: date });
  assert.equal(authorization.paidCallsAuthorized, true);
  assert.equal(result.vault.release({ plan: result.plan, authorization }).length, 3);
});

test("prospective fleet case vault cannot release from a zero-authority plan alone", async () => {
  const result = await runProspectiveFleetCampaignPreflight();
  assert.throws(() => result.vault.release({ plan: result.plan, authorization: null }), /authorization/);
  assert.equal(result.vault.releaseCount(), 0);
});
