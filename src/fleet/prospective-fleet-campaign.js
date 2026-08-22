import path from "node:path";
import { digest } from "../core/canonical.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../core/durable-model-campaign.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway } from "../core/model-gateway.js";
import { CURRENT_MODEL_PRICING_USD } from "../providers/model-pricing.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { assertBoundedFleetContract } from "./bounded-level2-contract.js";
import { assertBoundedFleetPlan } from "./bounded-level2-planner.js";

export const PROSPECTIVE_FLEET_CAMPAIGN_ID = "prospective-bounded-level2-model-campaign-v2";
export const PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL = "JOEL_APPROVED_PROSPECTIVE_FLEET_V2";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

export function createProspectiveFleetCaseVault(tasks) {
  requireCondition(Array.isArray(tasks) && tasks.length >= 3, "Prospective fleet vault needs at least three role-distinct tasks");
  const sealed = structuredClone(tasks);
  requireCondition(new Set(sealed.map((item) => item.roleId)).size === sealed.length && sealed.every((item) => item.roleId && item.testCase?.id), "Prospective fleet tasks need unique exact roles and bounded cases");
  const vaultDigest = digest(sealed);
  let releases = 0;
  return Object.freeze({
    digest: vaultDigest,
    count: sealed.length,
    release({ plan, authorization }) {
      assertProspectiveFleetCampaignPlan(plan);
      requireCondition(plan.sealedTasks.digest === vaultDigest && plan.sealedTasks.count === sealed.length, "Prospective fleet vault does not match the frozen plan");
      requireCondition(authorization?.campaignId === plan.campaignId && authorization?.planHash === plan.planHash && authorization?.paidCallsAuthorized === true, "Prospective fleet vault requires exact paid campaign authorization");
      releases += 1;
      return structuredClone(sealed);
    },
    releaseCount() { return releases; },
  });
}

export function createProspectiveFleetCampaignPlan({ intake, selections, sealedTasks, turnCeilingsByRole, campaignId = PROSPECTIVE_FLEET_CAMPAIGN_ID, campaignApproval = PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL }) {
  assertBoundedFleetContract(intake?.intake?.contract);
  assertBoundedFleetPlan(intake?.plan);
  requireCondition(intake.verification?.passed === true && intake.plan.selected?.roleGaps.length === 0, "Prospective fleet campaign requires a complete independently verified plan");
  requireCondition(sealedTasks?.digest && sealedTasks.count === intake.plan.selected.assignments.length, "Prospective fleet campaign needs one sealed task per exact assignment");
  const byRole = new Map((selections ?? []).map((selection) => [selection.roleId, selection]));
  const admittedById = new Map(intake.admission.admissions.map((item) => [item.specialist.id, item]));
  const assignments = intake.plan.selected.assignments.map((assignment) => {
    const admitted = admittedById.get(assignment.specialistId);
    const selection = admitted ? byRole.get(admitted.specialist.roleId) : null;
    const candidate = selection?.selected?.candidate;
    requireCondition(candidate && candidate.id === assignment.specialistId && candidate.fingerprint && candidate.verifier.binding === assignment.verifierId, `Prospective assignment is not bound to its exact selected Level 1 specialist: ${assignment.assignmentId}`);
    const maximumModelTurns = Number(turnCeilingsByRole?.[candidate.roleId]);
    requireCondition(Number.isInteger(maximumModelTurns) && maximumModelTurns > 0 && maximumModelTurns <= 128, `Prospective assignment needs an explicit bounded role turn ceiling: ${candidate.roleId}`);
    return { assignmentId: assignment.assignmentId, assignmentHash: assignment.assignmentHash, workloadId: assignment.workloadId, roleId: candidate.roleId, specialistId: candidate.id, candidateFingerprint: candidate.fingerprint, selectionRecordHash: selection.recordHash, verifierId: assignment.verifierId, model: candidate.model.family, maximumTaskCostUsd: candidate.limits.maxCostPerTaskUsd, maximumTaskLatencyMs: candidate.limits.maxLatencyMs, maximumModelTurns };
  });
  const record = {
    schemaVersion: "das.prospective-fleet-model-campaign-plan.v2",
    campaignId,
    intakeReceiptHash: intake.intake.receipt.receiptHash,
    contractHash: intake.intake.contract.contractHash,
    fleetPlanHash: intake.plan.planHash,
    planVerificationHash: digest(intake.verification),
    assignments,
    sealedTasks: { count: sealedTasks.count, digest: sealedTasks.digest, payloadsIncluded: false },
    exactModels: [...new Set(assignments.map((item) => item.model))].sort(),
    maximumTaskEvaluations: assignments.length,
    maximumModelTurns: assignments.reduce((sum, item) => sum + item.maximumModelTurns, 0),
    hardSpendLimitUsd: intake.intake.contract.limits.maximumTotalCostUsd,
    pricingTableHash: digest(CURRENT_MODEL_PRICING_USD),
    gates: {
      paidCallsDefault: "disabled",
      requiredGlobalApproval: "DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED",
      requiredCampaignApproval: `DAS_PROSPECTIVE_FLEET_APPROVAL=${campaignApproval}`,
      requiredPlanHash: "DAS_PROSPECTIVE_FLEET_PLAN_HASH=<exact plan hash>",
      requiredExplicitLimit: "DAS_PROSPECTIVE_FLEET_LIMIT_USD=<positive number no greater than frozen fleet limit>",
      requiredPricingDate: "DAS_PROSPECTIVE_FLEET_PRICING_VERIFIED_ON=<current UTC date>",
      requiredPricingHash: `DAS_PROSPECTIVE_FLEET_PRICING_TABLE_HASH=${digest(CURRENT_MODEL_PRICING_USD)}`,
    },
    authority: { modelSpendAuthorized: false, executionAuthorized: false, activationAuthorized: false, roleCreationAuthorized: false },
    evidenceBoundary: "Zero-cost prospective Level 2 model-campaign plan. It binds fresh sealed role tasks to exact selected Level 1 specialists and the verified fleet plan, but authorizes no call or execution and proves no result.",
  };
  record.planHash = digest(record);
  return Object.freeze(record);
}

export function assertProspectiveFleetCampaignPlan(plan) {
  requireCondition(plan?.schemaVersion === "das.prospective-fleet-model-campaign-plan.v2" && plan.planHash === digest(withoutHash(plan, "planHash")), "Prospective fleet campaign plan integrity mismatch");
  requireCondition(plan.gates.paidCallsDefault === "disabled" && Object.values(plan.authority).every((value) => value === false), "Prospective fleet plan cannot pre-authorize calls or execution");
  requireCondition(plan.sealedTasks.payloadsIncluded === false && plan.maximumTaskEvaluations === plan.assignments.length, "Prospective fleet plan leaks tasks or has an invalid task ceiling");
  requireCondition(plan.assignments.every((item) => Number.isInteger(item.maximumModelTurns) && item.maximumModelTurns > 0 && item.maximumModelTurns <= 128) && plan.maximumModelTurns === plan.assignments.reduce((sum, item) => sum + item.maximumModelTurns, 0), "Prospective fleet plan has invalid role-bound turn ceilings");
  return true;
}

export function assertProspectiveFleetCampaignAuthorization({ plan, environment = process.env, pricingVerifiedDate = new Date().toISOString().slice(0, 10), campaignApproval = PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL }) {
  assertProspectiveFleetCampaignPlan(plan);
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid model calls are not approved");
  requireCondition(environment.DAS_PROSPECTIVE_FLEET_APPROVAL === campaignApproval, "This exact prospective fleet campaign is not explicitly approved");
  requireCondition(environment.DAS_PROSPECTIVE_FLEET_PLAN_HASH === plan.planHash, "Prospective fleet approval is not bound to the exact plan");
  const limit = Number(environment.DAS_PROSPECTIVE_FLEET_LIMIT_USD);
  const plannedMinimum = plan.assignments.reduce((sum, assignment) => sum + Number(assignment.maximumTaskCostUsd), 0);
  requireCondition(Number.isFinite(limit) && limit >= plannedMinimum && limit <= plan.hardSpendLimitUsd, "Prospective fleet campaign needs an explicit limit covering every selected task and inside the frozen fleet ceiling");
  requireCondition(environment.DAS_PROSPECTIVE_FLEET_PRICING_VERIFIED_ON === pricingVerifiedDate, "Prospective fleet pricing was not freshly verified today");
  requireCondition(environment.DAS_PROSPECTIVE_FLEET_PRICING_TABLE_HASH === plan.pricingTableHash, "Prospective fleet pricing hash is not approved");
  requireCondition(environment.OPENAI_API_KEY, "OPENAI_API_KEY is missing");
  return Object.freeze({ campaignId: plan.campaignId, planHash: plan.planHash, limitUsd: limit, paidCallsAuthorized: true, pricingVerifiedDate, pricingTableHash: plan.pricingTableHash });
}

export function createProspectiveFleetCampaignRuntime({ plan, environment = process.env, stateDirectory = "artifacts/fleet/prospective-model-campaign-v2/model-run", fetchImpl = fetch, pricingVerifiedDate, campaignApproval = PROSPECTIVE_FLEET_CAMPAIGN_APPROVAL } = {}) {
  const authorization = assertProspectiveFleetCampaignAuthorization({ plan, environment, pricingVerifiedDate, campaignApproval });
  const root = path.resolve(stateDirectory);
  const budget = new DurableBudgetGuard({ filePath: path.join(root, "budget.json"), hardLimitUsd: authorization.limitUsd, campaignId: plan.campaignId });
  const cache = new PersistentModelResponseCache({ filePath: path.join(root, "response-cache.json") });
  const evidence = new EvidenceLedger(path.join(root, "evidence.jsonl"));
  const provider = new OpenAIResponsesProvider({ apiKey: environment.OPENAI_API_KEY, pricingByModel: CURRENT_MODEL_PRICING_USD, fetchImpl, allowPaidCalls: true, environment });
  const gateway = new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [environment.OPENAI_API_KEY] });
  return Object.freeze({ root, authorization, budget, cache, evidence, provider, gateway });
}
