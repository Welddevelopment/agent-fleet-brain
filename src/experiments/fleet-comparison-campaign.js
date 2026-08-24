import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { ensureFreshArtifactDirectory } from "../fleet/artifact-hygiene.js";
import {
  COMPARISON_CONSTANTS,
  createComparisonCases,
  createComparisonRoster,
  createComparisonStaticMapping,
} from "../fleet/comparison-cases.js";
import { createComparisonPreregistration, sealComparisonCases } from "../fleet/comparison-freeze.js";
import { runComparisonCampaign } from "../fleet/comparison-campaign.js";

// The sealed comparison campaign, on disk.
//
// Freeze discipline: the preregistration is written to disk BEFORE any arm runs.
// If a preregistration already exists it must hash-match the one derived now —
// a mismatch means the catalogue changed after sealing, and the run refuses.
// Everything lands under artifacts/fleet-comparison/ (a fresh tree; the hygiene
// guard makes writing inside sealed evidence impossible).

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(repositoryRoot);

const outputDirectory = ensureFreshArtifactDirectory("artifacts/fleet-comparison/deterministic-v2", { repositoryRoot });
const stateDirectory = path.join(outputDirectory, "controller-state");
fs.mkdirSync(stateDirectory, { recursive: true });

const cases = createComparisonCases();
const vault = sealComparisonCases(cases);
const roster = createComparisonRoster();
const staticMapping = createComparisonStaticMapping();
const preregistration = createComparisonPreregistration({
  caseVault: vault,
  roster,
  constants: COMPARISON_CONSTANTS,
  staticMapping,
  armDeclarations: [
    { armId: "general", module: "src/fleet/comparison-arms.js", exportName: "runGeneralAgentArm" },
    { armId: "sharded", module: "src/fleet/comparison-arms.js", exportName: "runShardedGeneralAgentsArm" },
    { armId: "static", module: "src/fleet/comparison-arms.js", exportName: "runStaticFleetArm" },
    { armId: "adaptive", module: "src/fleet/comparison-arms.js", exportName: "runAdaptiveFleetArm" },
  ],
  regimes: [...new Set(cases.map((record) => record.regime))].map((regime) => ({
    id: regime,
    caseIds: cases.filter((record) => record.regime === regime).map((record) => record.id),
    hypotheses: cases.filter((record) => record.regime === regime).map((record) => record.preregisteredExpectation.hypothesis),
    clauseCount: cases.filter((record) => record.regime === regime).reduce((sum, record) => sum + record.preregisteredExpectation.clauses.length, 0),
  })),
});

const preregistrationPath = path.join(outputDirectory, "preregistration.json");
if (fs.existsSync(preregistrationPath)) {
  const existing = JSON.parse(fs.readFileSync(preregistrationPath, "utf8"));
  if (existing.preregistrationHash !== preregistration.preregistrationHash) {
    throw new Error(`A different preregistration is already sealed at ${preregistrationPath} (sealed ${existing.preregistrationHash}, derived ${preregistration.preregistrationHash}). The catalogue changed after sealing — refusing to run.`);
  }
} else {
  fs.writeFileSync(preregistrationPath, `${JSON.stringify(preregistration, null, 2)}\n`, { mode: 0o600 });
}

const result = await runComparisonCampaign({ vault, preregistration, roster, constants: COMPARISON_CONSTANTS, staticMapping, stateDirectory });

const summary = {
  schemaVersion: "fleetbrain.comparison-campaign-summary.v1",
  campaignId: result.campaignId,
  preregistrationHash: result.preregistrationHash,
  resultHash: result.resultHash,
  cases: result.caseResults.length,
  arms: 4,
  checks: result.checks,
  hypothesisSummary: result.hypothesisSummary,
  headline: {
    theHonestSummary: "Against a naive 5-way shard of general agents, the adaptive fleet's measured edge narrows to conflict behaviour under overlap and authority routing. Parallelism and capacity are headcount, not coordination. All figures are fictional model units.",
    adaptiveWins: ["C1: consolidation-by-capacity yields 0 duplicates and a true completion where BOTH the static split and the naive shard double-write 3 records (and the shard claims success falsely)", "G2: a maintained authority table - 0 denials vs the static map's 4 (the general arms also score 0, by holding all authority)", "A1: refuses at $0 like every arm given aggregate accounting; only the static fleet, which has none, breaches and false-completes"],
    adaptiveLosses: ["S1 and S2: the single general agent wins small cases on cost", "P1 and P2: the naive shard is FASTEST of all arms - fleet system-lanes are a worse partition than round-robin", "G1: both general arms complete 14/14 where the honest fleet returns the gap at 10/14", "K1: the shard completes the 300-unit surge too, faster and with no planner - capacity splitting is headcount"],
    knownGaps: ["C2: adaptive duplicates 10 across a forced capacity split - consolidation is not conflict detection (detection is late, via scope ownership, and cannot prevent)", "A2: no arm sees company invariants; all FOUR false-complete against the escalation cap"],
  },
  modelCalls: 0,
  paidModelSpendUsd: 0,
  evidenceBoundary: result.evidenceBoundary,
};
summary.summaryHash = digest(summary);

fs.writeFileSync(path.join(outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({ outputDirectory, summary }, null, 2));
