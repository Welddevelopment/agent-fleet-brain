import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { ExecutionAttestor } from "dynamic-agent-specialisation/src/evaluation/execution-attestation.js";
import { ensureFreshArtifactDirectory } from "../fleet/artifact-hygiene.js";
import { createBoundedFleetContract } from "../fleet/bounded-level2-contract.js";
import { COMPARISON_CONSTANTS, createComparisonRoster, createComparisonStaticMapping } from "../fleet/comparison-cases.js";
import { scoreComparisonArmRun } from "../fleet/comparison-scoring.js";
import { createComparisonWorld, verifyComparisonParentGoal } from "../fleet/comparison-world.js";
import { compileHeldOutCase, sealHeldOutSpecs } from "../fleet/heldout-cases.js";

// The held-out exam: six blind-authored cases, four arms, NO hypotheses.
//
// Discipline differs from the sealed v2 campaign on exactly one axis, on purpose:
// there is nothing to grade, because nobody on this side predicted anything. The
// author's specs are sealed verbatim (any later edit is detectable), the same
// attested arms run, the same world-truth verifier judges, and the results are
// whatever they are.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(repositoryRoot);

const specsPath = process.argv[2] ?? "artifacts/heldout/blind-specs.json";
const specs = JSON.parse(fs.readFileSync(path.resolve(repositoryRoot, specsPath), "utf8"));
const exam = sealHeldOutSpecs(specs);

const outputDirectory = ensureFreshArtifactDirectory("artifacts/heldout/exam-v1", { repositoryRoot });
const stateDirectory = path.join(outputDirectory, "controller-state");
fs.mkdirSync(stateDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "exam-seal.json"), `${JSON.stringify(exam, null, 2)}\n`, { mode: 0o600 });

const roster = createComparisonRoster();
const staticMapping = createComparisonStaticMapping();
const attestor = new ExecutionAttestor([
  { armId: "general", module: "src/fleet/comparison-arms.js", exportName: "runGeneralAgentArm" },
  { armId: "sharded", module: "src/fleet/comparison-arms.js", exportName: "runShardedGeneralAgentsArm" },
  { armId: "static", module: "src/fleet/comparison-arms.js", exportName: "runStaticFleetArm" },
  { armId: "adaptive", module: "src/fleet/comparison-arms.js", exportName: "runAdaptiveFleetArm" },
]);
await attestor.resolve({ repositoryRoot });
const arms = { general: attestor.entryPoint("general"), sharded: attestor.entryPoint("sharded"), static: attestor.entryPoint("static"), adaptive: attestor.entryPoint("adaptive") };

const caseResults = [];
for (const spec of specs) {
  const caseRecord = compileHeldOutCase(spec);
  const contract = createBoundedFleetContract(caseRecord.contractInput);
  const armOutcomes = [];
  for (const armId of ["general", "sharded", "static", "adaptive"]) {
    const world = createComparisonWorld({ caseRecord });
    const armArguments = { caseRecord, contract, roster, world, constants: COMPARISON_CONSTANTS };
    if (armId === "static") armArguments.staticMapping = staticMapping;
    if (armId === "adaptive") armArguments.stateDirectory = stateDirectory;
    const armRun = arms[armId](armArguments);
    const parentVerification = verifyComparisonParentGoal({ world, contract, caseRecord });
    armOutcomes.push(scoreComparisonArmRun({ caseRecord, armRun, parentVerification }));
  }
  caseResults.push({ caseId: caseRecord.id, title: caseRecord.title, caseHash: caseRecord.caseHash, designIntent: spec.designIntent, arms: armOutcomes });
}
attestor.assertAllReached();

const result = {
  schemaVersion: "fleetbrain.heldout-exam-result.v1",
  examHash: exam.examHash,
  specDigest: exam.specDigest,
  caseResults,
  modelCalls: 0,
  paidModelSpendUsd: 0,
  evidenceBoundary: "Blind-authored held-out cases run through the attested four-arm harness with no outcome hypotheses on this side. Deterministic, fictional, zero spend. Instruction-level blindness, not organizational independence.",
};
result.resultHash = digest(result);
fs.writeFileSync(path.join(outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });

// Terminal digest: per case, per arm, the metrics that matter.
for (const entry of caseResults) {
  console.log(`\n${entry.caseId} — ${entry.title}`);
  console.log(`   intent: ${entry.designIntent}`);
  for (const arm of entry.arms) {
    const m = arm.metrics;
    console.log(`   ${arm.armId.padEnd(8)} complete=${m.parentGoalCompleted} false=${m.falseCompletion} dup=${m.duplicatesConflicts} auth=${m.authorityViolations} cost=$${m.costUsd.toFixed(2)} latency=${m.latencyProxyMs}ms interventions=${m.interventions} (${arm.claimReason})`);
  }
}
console.log(`\nSealed: ${result.resultHash.slice(0, 12)}…  ->  ${path.relative(repositoryRoot, outputDirectory)}/`);
