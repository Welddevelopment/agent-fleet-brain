import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest } from "../src/core/canonical.js";
import { BoundedFleetController } from "../src/fleet/bounded-level2-controller.js";
import { runProspectiveFleetCampaignPreflight } from "../src/fleet/prospective-fleet-campaign-fixture.js";
import { assertProspectiveFleetProgress, createProspectiveFleetProgress, createProspectiveFleetResultObservation, restoreProspectiveFleetProgress } from "../src/fleet/prospective-fleet-campaign-runner.js";
import { PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL, assertProspectiveFleetCampaignAuthorization, createProspectiveFleetCampaignRuntime } from "../src/fleet/prospective-fleet-campaign.js";
import { CURRENT_MODEL_PRICING_USD } from "../src/providers/model-pricing.js";

test("fresh sealed tasks bind to exact selected specialists without pre-authorizing spend", async () => {
  const result = await runProspectiveFleetCampaignPreflight();
  assert.equal(result.plan.assignments.length, 3);
  assert.equal(result.plan.maximumTaskEvaluations, 3);
  assert.deepEqual(Object.fromEntries(result.plan.assignments.map((item) => [item.roleId, item.maximumModelTurns])), {
    "realistic-procurement-specialist": 20,
    "realistic-support-operations-specialist": 48,
    "realistic-revenue-operations-specialist": 56,
  });
  assert.equal(result.plan.maximumModelTurns, 124);
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

test("prospective fleet runtime is durable and network-idle until an authorized task executes", async () => {
  const result = await runProspectiveFleetCampaignPreflight();
  const date = "2026-08-05";
  const environment = { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED", DAS_PROSPECTIVE_FLEET_APPROVAL: PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL, DAS_PROSPECTIVE_FLEET_PLAN_HASH: result.plan.planHash, DAS_PROSPECTIVE_FLEET_LIMIT_USD: String(result.plan.hardSpendLimitUsd), DAS_PROSPECTIVE_FLEET_PRICING_VERIFIED_ON: date, DAS_PROSPECTIVE_FLEET_PRICING_TABLE_HASH: digest(CURRENT_MODEL_PRICING_USD), OPENAI_API_KEY: "test-key" };
  let networkCalls = 0;
  const runtime = createProspectiveFleetCampaignRuntime({ plan: result.plan, environment, pricingVerifiedDate: date, stateDirectory: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-prospective-fleet-runtime-")), "state"), fetchImpl: async () => { networkCalls += 1; throw new Error("test must remain network-idle"); } });
  assert.equal(runtime.budget.snapshot().hardLimitUsd, result.plan.hardSpendLimitUsd);
  assert.equal(runtime.cache.size(), 0);
  assert.equal(runtime.provider.enabled, true);
  assert.equal(networkCalls, 0);
});

test("prospective result conversion preserves exact identity, verifier, cost and safety", async () => {
  const result = await runProspectiveFleetCampaignPreflight();
  const specialist = result.intake.admission.admissions[0].specialist;
  const assignment = result.intake.plan.selected.assignments.find((item) => item.specialistId === specialist.id);
  const observation = createProspectiveFleetResultObservation({ intake: result.intake, assignment, specialist, result: { candidateId: specialist.id, candidateFingerprint: "bound-upstream", caseId: "sealed-after-authorization", status: "completed", passed: true, modelCostUsd: .01, unsafeAttempts: 0, verification: { passed: true, checks: { noDeniedAttempts: true, noOutOfScopeWrites: true, noDuplicateKeys: true, protectedUnchanged: true } } } });
  assert.equal(observation.specialistId, specialist.id);
  assert.equal(observation.verifierId, assignment.verifierId);
  assert.equal(observation.actualCostUsd, .01);
  assert.equal(observation.verificationPassed, true);
  assert.equal(observation.incorrectSideEffects, 0);
});

test("prospective result conversion refuses changed identity or missing cost", async () => {
  const result = await runProspectiveFleetCampaignPreflight();
  const specialist = result.intake.admission.admissions[0].specialist;
  const assignment = result.intake.plan.selected.assignments.find((item) => item.specialistId === specialist.id);
  const base = { candidateId: specialist.id, candidateFingerprint: "bound-upstream", caseId: "sealed-after-authorization", status: "completed", passed: true, modelCostUsd: .01, unsafeAttempts: 0, verification: { passed: true, checks: {} } };
  assert.throws(() => createProspectiveFleetResultObservation({ intake: result.intake, assignment, specialist, result: { ...base, candidateId: "changed" } }), /candidate/);
  assert.throws(() => createProspectiveFleetResultObservation({ intake: result.intake, assignment, specialist, result: { ...base, modelCostUsd: undefined } }), /model cost/);
});

test("prospective Fleet progress binds the saved model result to its exact durable observation", async () => {
  const preflight = await runProspectiveFleetCampaignPreflight();
  const tasks = preflight.vault.release({ plan: preflight.plan, authorization: { campaignId: preflight.plan.campaignId, planHash: preflight.plan.planHash, paidCallsAuthorized: true } });
  const task = tasks[0];
  const specialist = preflight.intake.admission.admissions.map((item) => item.specialist).find((item) => item.roleId === task.roleId);
  const assignment = preflight.intake.plan.selected.assignments.find((item) => item.specialistId === specialist.id);
  const planAssignment = preflight.plan.assignments.find((item) => item.assignmentId === assignment.assignmentId);
  const modelResult = { candidateId: specialist.id, candidateFingerprint: planAssignment.candidateFingerprint, caseId: task.testCase.id, status: "completed", passed: true, modelCostUsd: .01, unsafeAttempts: 0, verification: { passed: true, checks: { noDeniedAttempts: true, noOutOfScopeWrites: true, noDuplicateKeys: true, protectedUnchanged: true } } };
  const observation = createProspectiveFleetResultObservation({ intake: preflight.intake, assignment, specialist, result: modelResult });
  const entry = { roleId: task.roleId, assignmentId: assignment.assignmentId, candidateId: specialist.id, candidateFingerprint: planAssignment.candidateFingerprint, caseId: task.testCase.id, result: modelResult, observation };
  const progress = createProspectiveFleetProgress({ campaignId: preflight.plan.campaignId, planHash: preflight.plan.planHash, results: [entry], fleetStatus: { state: "running" }, budget: { spentUsd: .01 }, evidenceLedgerValid: true });
  const args = { progress, plan: preflight.plan, intake: preflight.intake, assignments: preflight.intake.plan.selected.assignments, specialists: preflight.intake.admission.admissions.map((item) => item.specialist), tasks };
  assert.equal(assertProspectiveFleetProgress(args), true);
  const changed = structuredClone(progress);
  changed.results[0].result.modelCostUsd = .02;
  changed.progressHash = digest(Object.fromEntries(Object.entries(changed).filter(([key]) => key !== "progressHash")));
  assert.throws(() => assertProspectiveFleetProgress({ ...args, progress: changed }), /differs from its observation/);
});

test("prospective Fleet restart records a saved verified result without repeating its action", async () => {
  const preflight = await runProspectiveFleetCampaignPreflight();
  const tasks = preflight.vault.release({ plan: preflight.plan, authorization: { campaignId: preflight.plan.campaignId, planHash: preflight.plan.planHash, paidCallsAuthorized: true } });
  const specialists = preflight.intake.admission.admissions.map((item) => item.specialist);
  const task = tasks[0];
  const specialist = specialists.find((item) => item.roleId === task.roleId);
  const assignment = preflight.intake.plan.selected.assignments.find((item) => item.specialistId === specialist.id);
  const planAssignment = preflight.plan.assignments.find((item) => item.assignmentId === assignment.assignmentId);
  const modelResult = { candidateId: specialist.id, candidateFingerprint: planAssignment.candidateFingerprint, caseId: task.testCase.id, status: "completed", passed: true, modelCostUsd: .01, unsafeAttempts: 0, verification: { passed: true, checks: { noDeniedAttempts: true, noOutOfScopeWrites: true, noDuplicateKeys: true, protectedUnchanged: true } } };
  const observation = createProspectiveFleetResultObservation({ intake: preflight.intake, assignment, specialist, result: modelResult });
  const entry = { roleId: task.roleId, assignmentId: assignment.assignmentId, candidateId: specialist.id, candidateFingerprint: planAssignment.candidateFingerprint, caseId: task.testCase.id, result: modelResult, observation };
  const progress = createProspectiveFleetProgress({ campaignId: preflight.plan.campaignId, planHash: preflight.plan.planHash, results: [entry], fleetStatus: { state: "authorized-not-started" }, budget: { spentUsd: .01 }, evidenceLedgerValid: true });
  const state = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-prospective-fleet-resume-")), "controller.json");
  const options = { contract: preflight.intake.intake.contract, specialists, plan: preflight.intake.plan, planVerification: preflight.intake.verification, filePath: state };
  const controller = new BoundedFleetController(options);
  controller.authorizeAssignments({ approvedBy: "test-owner", planHash: preflight.intake.plan.planHash, assignmentHashes: preflight.intake.plan.selected.assignments.map((item) => item.assignmentHash), maximumActualCostUsd: preflight.plan.hardSpendLimitUsd });
  const restoreArgs = { progress, plan: preflight.plan, intake: preflight.intake, assignments: preflight.intake.plan.selected.assignments, specialists, tasks };
  assert.equal(restoreProspectiveFleetProgress({ ...restoreArgs, controller }).length, 1);
  assert.equal(controller.status().assignments.verifiedComplete, 1);
  const reloaded = new BoundedFleetController(options);
  assert.equal(restoreProspectiveFleetProgress({ ...restoreArgs, controller: reloaded }).length, 1);
  assert.equal(reloaded.status().assignments.verifiedComplete, 1);
  assert.equal(reloaded.snapshot().observations.length, 1);
});
