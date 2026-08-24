import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { ExecutionAttestor } from "dynamic-agent-specialisation/src/evaluation/execution-attestation.js";
import { createBoundedFleetContract } from "./bounded-level2-contract.js";
import { assertComparisonPreregistration } from "./comparison-freeze.js";
import { scoreComparisonArmRun } from "./comparison-scoring.js";
import { createComparisonWorld, verifyComparisonParentGoal } from "./comparison-world.js";

// The comparison campaign runner.
//
// Order of operations is the whole point: the preregistration is asserted intact,
// the arm entry points are resolved against the REAL modules (the Erratum-0111a
// lesson — declaring a function is not evidence it ran; attestation takes the
// callable FROM the declaration), the vault releases the sealed cases only against
// that preregistration, and only then does anything execute. Hypotheses are graded
// as data afterward: a mismatch is recorded with matched:false and the campaign
// keeps going. It never throws on an unwanted result.

const FLEET_BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runComparisonCampaign({ vault, preregistration, roster, constants, staticMapping, stateDirectory, clock = () => "2026-08-24T04:30:00.000Z" }) {
  assertComparisonPreregistration(preregistration);
  requireCondition(preregistration.rosterHash === roster.rosterHash, "Roster changed after preregistration");
  requireCondition(preregistration.constantsHash === digest(constants), "Constants changed after preregistration");
  requireCondition(preregistration.staticMappingHash === staticMapping.mappingHash, "Static mapping changed after preregistration");
  requireCondition(stateDirectory, "The adaptive arm needs a state directory for durable controller files");

  const attestor = new ExecutionAttestor(preregistration.armDeclarations);
  await attestor.resolve({ repositoryRoot: FLEET_BRAIN_ROOT });
  const armEntryPoints = {
    general: attestor.entryPoint("general"),
    static: attestor.entryPoint("static"),
    adaptive: attestor.entryPoint("adaptive"),
  };

  const cases = vault.release({ preregistration });
  const startedAt = clock();
  const caseResults = [];
  let digestsEqualEverywhere = true;

  for (const caseRecord of cases) {
    const contract = createBoundedFleetContract(caseRecord.contractInput);
    const armOutcomes = [];
    const initialDigests = [];
    for (const armId of ["general", "static", "adaptive"]) {
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
  attestor.assertAllReached();

  // Grade the preregistered hypotheses as data.
  const byCase = new Map(caseResults.map((entry) => [entry.caseId, entry]));
  const metric = (caseId, armId, name) => byCase.get(caseId).arms.find((arm) => arm.armId === armId).metrics[name];
  const hypothesisChecks = [
    { caseId: "S1", claim: "general wins costUsd", observed: () => metric("S1", "general", "costUsd") < Math.min(metric("S1", "adaptive", "costUsd"), metric("S1", "static", "costUsd")) },
    { caseId: "S1", claim: "static shows exactly 2 unnecessary agents", observed: () => metric("S1", "static", "unnecessaryAgents") === 2 },
    { caseId: "S1", claim: "all arms complete", observed: () => ["general", "static", "adaptive"].every((armId) => metric("S1", armId, "parentGoalCompleted") === true) },
    { caseId: "S2", claim: "general wins costUsd", observed: () => metric("S2", "general", "costUsd") < Math.min(metric("S2", "adaptive", "costUsd"), metric("S2", "static", "costUsd")) },
    { caseId: "P1", claim: "fleet arms beat general >=3x on latency", observed: () => metric("P1", "general", "latencyProxyMs") / metric("P1", "adaptive", "latencyProxyMs") >= 3 && metric("P1", "general", "latencyProxyMs") / metric("P1", "static", "latencyProxyMs") >= 3 },
    { caseId: "P2", claim: "fleets win latency", observed: () => metric("P2", "adaptive", "latencyProxyMs") < metric("P2", "general", "latencyProxyMs") && metric("P2", "static", "latencyProxyMs") < metric("P2", "general", "latencyProxyMs") },
    { caseId: "C1", claim: "static duplicates 3, adaptive 0, general 0", observed: () => metric("C1", "static", "duplicatesConflicts") === 3 && metric("C1", "adaptive", "duplicatesConflicts") === 0 && metric("C1", "general", "duplicatesConflicts") === 0 },
    { caseId: "C2", claim: "KNOWN GAP: adaptive duplicates 10, static 10, general 0", observed: () => metric("C2", "adaptive", "duplicatesConflicts") === 10 && metric("C2", "static", "duplicatesConflicts") === 10 && metric("C2", "general", "duplicatesConflicts") === 0 },
    { caseId: "G1", claim: "general completes and wins; adaptive honest incomplete; static false-completes", observed: () => metric("G1", "general", "parentGoalCompleted") === true && metric("G1", "adaptive", "parentGoalCompleted") === false && metric("G1", "adaptive", "falseCompletion") === false && metric("G1", "adaptive", "interventions") >= 1 && metric("G1", "static", "falseCompletion") === true },
    { caseId: "G2", claim: "static 4 authority violations; adaptive and general 0", observed: () => metric("G2", "static", "authorityViolations") === 4 && metric("G2", "adaptive", "authorityViolations") === 0 && metric("G2", "general", "authorityViolations") === 0 },
    { caseId: "K1", claim: "only adaptive completes the surge", observed: () => metric("K1", "adaptive", "parentGoalCompleted") === true && metric("K1", "static", "parentGoalCompleted") === false && metric("K1", "general", "parentGoalCompleted") === false },
    { caseId: "A1", claim: "adaptive refuses at $0; general halts at ceiling; static breaches and false-completes", observed: () => metric("A1", "adaptive", "costUsd") === 0 && metric("A1", "adaptive", "interventions") >= 1 && metric("A1", "general", "interventions") >= 1 && metric("A1", "general", "falseCompletion") === false && metric("A1", "static", "incorrectEffects") >= 1 && metric("A1", "static", "falseCompletion") === true },
    { caseId: "A2", claim: "KNOWN SHARED GAP: all three arms false-complete", observed: () => ["general", "static", "adaptive"].every((armId) => metric("A2", armId, "falseCompletion") === true) },
  ];
  const hypothesisVerdicts = hypothesisChecks.map((check) => {
    let matched = false;
    let error = "";
    try { matched = check.observed() === true; } catch (caught) { error = caught.message; }
    return { caseId: check.caseId, claim: check.claim, matched, ...(error ? { error } : {}) };
  });

  const finishedAt = clock();
  const result = {
    schemaVersion: "fleetbrain.comparison-campaign-result.v1",
    campaignId: preregistration.campaignId,
    preregistrationHash: preregistration.preregistrationHash,
    caseVaultDigest: preregistration.caseVault.digest,
    startedAt,
    finishedAt,
    caseResults,
    hypothesisVerdicts,
    hypothesisSummary: {
      total: hypothesisVerdicts.length,
      matched: hypothesisVerdicts.filter((verdict) => verdict.matched).length,
      mismatched: hypothesisVerdicts.filter((verdict) => !verdict.matched).length,
    },
    checks: {
      initialWorldDigestsEqualAcrossArms: digestsEqualEverywhere,
      everyCaseRanAllThreeArms: caseResults.every((entry) => entry.arms.length === 3),
      attestationAllReached: true,
      allPreregisteredMetricsReported: caseResults.every((entry) => entry.arms.every((arm) => preregistration.metricsCatalog.every((item) => arm.metrics[item.name] !== undefined))),
      noHypothesisSuppressed: hypothesisVerdicts.length === hypothesisChecks.length,
    },
    modelCalls: 0,
    paidModelSpendUsd: 0,
    evidenceBoundary: "Deterministic scripted arms over fictional worlds under competence parity. This measures coordination-policy differences only. No model ran; it is not evidence about model-backed agents, external frameworks, or customer outcomes.",
  };
  result.resultHash = digest(result);
  return Object.freeze(result);
}
