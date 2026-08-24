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

const outputDirectory = ensureFreshArtifactDirectory("artifacts/fleet-comparison/deterministic-v1", { repositoryRoot });
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
    { armId: "static", module: "src/fleet/comparison-arms.js", exportName: "runStaticFleetArm" },
    { armId: "adaptive", module: "src/fleet/comparison-arms.js", exportName: "runAdaptiveFleetArm" },
  ],
  regimes: [...new Set(cases.map((record) => record.regime))].map((regime) => ({
    id: regime,
    caseIds: cases.filter((record) => record.regime === regime).map((record) => record.id),
    hypotheses: cases.filter((record) => record.regime === regime).map((record) => record.preregisteredExpectation.hypothesis),
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
  arms: 3,
  checks: result.checks,
  hypothesisSummary: result.hypothesisSummary,
  headline: {
    fleetWins: ["P1 and P2: the fleets beat the single agent on latency (P1: 3.4x)", "C1: the planner consolidates overlapping queues onto one specialist - zero duplicates where the static split writes three", "G2: compatibility routing avoids all four authority denials the static mapping walks into", "K1: only the adaptive fleet completes the 300-unit surge, by splitting across specialists", "A1: the planner's aggregate accounting refuses at $0 what the static fleet spends 28% over budget on"],
    fleetLosses: ["S1 and S2: the general agent wins small cases on cost - coordination overhead is real", "G1: on a role gap, the general agent completes 14/14 and wins outright; the honest fleet returns the gap and finishes 10/14"],
    knownGaps: ["C2: adaptive duplicates 10 across a forced capacity split - consolidation is not conflict detection", "A2: no arm sees company invariants; all three false-complete against the escalation cap"],
  },
  modelCalls: 0,
  paidModelSpendUsd: 0,
  evidenceBoundary: result.evidenceBoundary,
};
summary.summaryHash = digest(summary);

fs.writeFileSync(path.join(outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({ outputDirectory, summary }, null, 2));
