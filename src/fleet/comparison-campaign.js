import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { ExecutionAttestor } from "dynamic-agent-specialisation/src/evaluation/execution-attestation.js";
import { createBoundedFleetContract } from "./bounded-level2-contract.js";
import { assertComparisonPreregistration } from "./comparison-freeze.js";
import { gradeCaseClauses } from "./comparison-grading.js";
import { scoreComparisonArmRun } from "./comparison-scoring.js";
import { createComparisonWorld, verifyComparisonParentGoal } from "./comparison-world.js";

// The comparison campaign runner, v2.
//
// Order of operations is the whole point: the preregistration is asserted intact
// (which now also verifies the GRADER's file hash — FB-C-012), the arm entry
// points are resolved against the REAL modules, the vault releases the sealed
// cases only against that preregistration, and only then does anything execute.
// Hypotheses are machine-checkable clauses sealed inside each case and graded by
// the hash-bound grader — an ungraded sealed clause is structurally impossible.
// A mismatched clause is recorded with matched:false and the campaign continues.
//
// Honesty note carried in the result itself: the cases and clauses are
// self-authored in the same session as the arms. This is preregistration as
// consistency discipline, not a blind prediction by an independent party.

const FLEET_BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARM_ORDER = ["general", "sharded", "static", "adaptive"];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runComparisonCampaign({ vault, preregistration, roster, constants, staticMapping, stateDirectory, clock = () => "2026-08-24T06:00:00.000Z" }) {
  assertComparisonPreregistration(preregistration);
  requireCondition(preregistration.rosterHash === roster.rosterHash, "Roster changed after preregistration");
  requireCondition(preregistration.constantsHash === digest(constants), "Constants changed after preregistration");
  requireCondition(preregistration.staticMappingHash === staticMapping.mappingHash, "Static mapping changed after preregistration");
  requireCondition(stateDirectory, "The adaptive arm needs a state directory for durable controller files");

  const attestor = new ExecutionAttestor(preregistration.armDeclarations);
  await attestor.resolve({ repositoryRoot: FLEET_BRAIN_ROOT });
  const armEntryPoints = Object.fromEntries(ARM_ORDER.map((armId) => [armId, attestor.entryPoint(armId)]));

  const cases = vault.release({ preregistration });
  const startedAt = clock();
  const caseResults = [];
  const clauseVerdicts = [];
  let digestsEqualEverywhere = true;

  for (const caseRecord of cases) {
    const contract = createBoundedFleetContract(caseRecord.contractInput);
    const armOutcomes = [];
    const initialDigests = [];
    for (const armId of ARM_ORDER) {
      const world = createComparisonWorld({ caseRecord });
      initialDigests.push(world.initialDigest());
      const armArguments = { caseRecord, contract, roster, world, constants };
      if (armId === "static") armArguments.staticMapping = staticMapping;
      if (armId === "adaptive") armArguments.stateDirectory = stateDirectory;
      const armRun = armEntryPoints[armId](armArguments);
      const parentVerification = verifyComparisonParentGoal({ world, contract, caseRecord });
      armOutcomes.push(scoreComparisonArmRun({ caseRecord, armRun, parentVerification }));
    }
    const parity = new Set(initialDigests).size === 1;
    if (!parity) digestsEqualEverywhere = false;
    clauseVerdicts.push(...gradeCaseClauses({ caseRecord, armResults: armOutcomes }));
    caseResults.push({
      caseId: caseRecord.id,
      regime: caseRecord.regime,
      title: caseRecord.title,
      caseHash: caseRecord.caseHash,
      initialWorldDigestsEqual: parity,
      preregisteredExpectation: structuredClone(caseRecord.preregisteredExpectation),
      arms: armOutcomes,
    });
  }
  let attestationAllReached = false;
  attestor.assertAllReached();
  attestationAllReached = true;

  const sealedClauseCount = cases.reduce((sum, caseRecord) => sum + (caseRecord.preregisteredExpectation?.clauses?.length ?? 0), 0);
  const finishedAt = clock();
  const result = {
    schemaVersion: "fleetbrain.comparison-campaign-result.v2",
    campaignId: preregistration.campaignId,
    preregistrationHash: preregistration.preregistrationHash,
    caseVaultDigest: preregistration.caseVault.digest,
    graderModuleSha256: preregistration.graderModuleSha256,
    startedAt,
    finishedAt,
    caseResults,
    clauseVerdicts,
    hypothesisSummary: {
      totalClauses: clauseVerdicts.length,
      matched: clauseVerdicts.filter((verdict) => verdict.matched).length,
      mismatched: clauseVerdicts.filter((verdict) => !verdict.matched).length,
    },
    checks: {
      initialWorldDigestsEqualAcrossArms: digestsEqualEverywhere,
      everyCaseRanAllFourArms: caseResults.every((entry) => entry.arms.length === ARM_ORDER.length),
      attestationAllReached,
      allPreregisteredMetricsReported: caseResults.every((entry) => entry.arms.every((arm) => preregistration.metricsCatalog.every((item) => arm.metrics[item.name] !== undefined))),
      everySealedClauseGraded: clauseVerdicts.length === sealedClauseCount && sealedClauseCount > 0,
    },
    modelCalls: 0,
    paidModelSpendUsd: 0,
    honesty: {
      selfAuthored: "Cases, clauses and arms were authored in the same session. Sealing binds them against later edits; it does not make the hypotheses blind predictions by an independent party.",
      fictionalUnits: "Every dollar and millisecond in this result is a fictional model unit from the sealed constants table, not spend or measured runtime.",
    },
    evidenceBoundary: "Deterministic scripted arms over fictional worlds under per-agent competence parity, with the headcount asymmetry declared and a sharded baseline included to separate headcount from coordination. This measures coordination-policy differences only. No model ran; it is not evidence about model-backed agents, external frameworks, or customer outcomes.",
  };
  result.resultHash = digest(result);
  return Object.freeze(result);
}
