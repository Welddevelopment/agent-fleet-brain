import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBoundedFleetContract } from "../src/fleet/bounded-level2-contract.js";
import {
  COMPARISON_CONSTANTS,
  assertCompetenceParity,
  createComparisonCases,
  createComparisonRoster,
  createComparisonStaticMapping,
} from "../src/fleet/comparison-cases.js";
import { createComparisonPreregistration, sealComparisonCases } from "../src/fleet/comparison-freeze.js";
import { runComparisonCampaign } from "../src/fleet/comparison-campaign.js";
import { executeAssignedUnits } from "../src/fleet/comparison-work-engine.js";
import { createComparisonWorld, verifyComparisonAssignmentScope, verifyComparisonParentGoal } from "../src/fleet/comparison-world.js";

const ARM_DECLARATIONS = [
  { armId: "general", module: "src/fleet/comparison-arms.js", exportName: "runGeneralAgentArm" },
  { armId: "sharded", module: "src/fleet/comparison-arms.js", exportName: "runShardedGeneralAgentsArm" },
  { armId: "static", module: "src/fleet/comparison-arms.js", exportName: "runStaticFleetArm" },
  { armId: "adaptive", module: "src/fleet/comparison-arms.js", exportName: "runAdaptiveFleetArm" },
];

function firstCase() {
  return createComparisonCases().find((record) => record.id === "C1");
}

test("the world is idempotent per agent and counts a second agent's write as a real duplicate", () => {
  const world = createComparisonWorld({ caseRecord: firstCase() });
  const authority = ["draft-response"];
  const first = world.applyWrite({ agentId: "agent-a", agentAuthorityActions: authority, recordId: "c1-a-004", action: "draft-response", unitCostUsd: 0.05 });
  const replay = world.applyWrite({ agentId: "agent-a", agentAuthorityActions: authority, recordId: "c1-a-004", action: "draft-response", unitCostUsd: 0.05 });
  const second = world.applyWrite({ agentId: "agent-b", agentAuthorityActions: authority, recordId: "c1-a-004", action: "draft-response", unitCostUsd: 0.05 });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(second.replayed, false);
  assert.equal(world.snapshot().effectiveWrites.length, 2);
});

test("a denial is recorded and thrown, and surfaces as an authority violation in parent verification", () => {
  const caseRecord = firstCase();
  const world = createComparisonWorld({ caseRecord });
  assert.throws(
    () => world.applyWrite({ agentId: "agent-a", agentAuthorityActions: ["read-only"], recordId: "c1-a-001", action: "draft-response", unitCostUsd: 0.05 }),
    /lacks authority/,
  );
  const contract = createBoundedFleetContract(caseRecord.contractInput);
  const parent = verifyComparisonParentGoal({ world, contract, caseRecord });
  assert.equal(parent.authorityViolations, 1);
  assert.equal(parent.parentGoalCompleted, false);
});

test("scope verification stays green on scoped-clean work while parent verification catches the cross-assignment duplicate", () => {
  const caseRecord = firstCase();
  const world = createComparisonWorld({ caseRecord });
  const authority = ["draft-response"];
  // Assignment one: agent-a correctly writes a4. Assignment two: agent-b correctly
  // writes a4 again under the overlapping queue. Each scope is individually clean.
  world.applyWrite({ agentId: "agent-a", agentAuthorityActions: authority, recordId: "c1-a-004", action: "draft-response", unitCostUsd: 0.05 });
  world.applyWrite({ agentId: "agent-b", agentAuthorityActions: authority, recordId: "c1-a-004", action: "draft-response", unitCostUsd: 0.05 });
  const scopeA = verifyComparisonAssignmentScope({ world, workloadId: "support-tickets", recordIds: ["c1-a-004"], agentIds: ["agent-a", "agent-b"], claimedAction: "draft-response", verifierId: "support-local-scope-verifier-v1" });
  assert.equal(scopeA.passed, true);
  const contract = createBoundedFleetContract(caseRecord.contractInput);
  const parent = verifyComparisonParentGoal({ world, contract, caseRecord });
  assert.equal(parent.duplicates, 1);
  assert.equal(parent.parentGoalCompleted, false);
});

test("competence parity is structural: identical units produce identical spend, latency and completion under any agent label", () => {
  const caseRecord = firstCase();
  const units = [
    { workloadId: "support-tickets", recordId: "c1-a-001", action: "draft-response", unitCostUsd: 0.05, unitLatencyMs: 800 },
    { workloadId: "support-tickets", recordId: "c1-a-002", action: "draft-response", unitCostUsd: 0.05, unitLatencyMs: 800 },
  ];
  const runWith = (agentId) => {
    const world = createComparisonWorld({ caseRecord });
    const outcome = executeAssignedUnits({ world, agentId, agentAuthorityActions: ["draft-response"], units, capacityRemaining: 200 });
    const state = world.snapshot();
    return { spendUsd: outcome.spendUsd, workLatencyMs: outcome.workLatencyMs, executed: outcome.executedCount, writtenRecords: state.effectiveWrites.map((write) => `${write.recordId}:${write.action}`).sort() };
  };
  assert.deepEqual(runWith("some-specialist"), runWith("the-general-agent"));
});

test("the engine refuses units beyond capacity without touching the world", () => {
  const caseRecord = firstCase();
  const world = createComparisonWorld({ caseRecord });
  const units = [
    { workloadId: "support-tickets", recordId: "c1-a-001", action: "draft-response", unitCostUsd: 0.05, unitLatencyMs: 800 },
    { workloadId: "support-tickets", recordId: "c1-a-002", action: "draft-response", unitCostUsd: 0.05, unitLatencyMs: 800 },
  ];
  const outcome = executeAssignedUnits({ world, agentId: "a", agentAuthorityActions: ["draft-response"], units, capacityRemaining: 1 });
  assert.equal(outcome.executedCount, 1);
  assert.equal(outcome.notAttemptedCount, 1);
  assert.equal(world.snapshot().effectiveWrites.length, 1);
});

test("the vault refuses release without a matching intact preregistration", () => {
  const cases = createComparisonCases();
  const vault = sealComparisonCases(cases);
  const roster = createComparisonRoster();
  const staticMapping = createComparisonStaticMapping();
  assert.equal(assertCompetenceParity({ roster, constants: COMPARISON_CONSTANTS }), true);
  const preregistration = createComparisonPreregistration({
    caseVault: vault,
    roster,
    constants: COMPARISON_CONSTANTS,
    staticMapping,
    armDeclarations: ARM_DECLARATIONS,
    regimes: [...new Set(cases.map((record) => record.regime))].map((regime) => ({ id: regime, caseIds: cases.filter((record) => record.regime === regime).map((record) => record.id), clauseCount: cases.filter((record) => record.regime === regime).reduce((sum, record) => sum + record.preregisteredExpectation.clauses.length, 0) })),
  });
  assert.equal(vault.release({ preregistration }).length, 11);
  const tampered = structuredClone(preregistration);
  tampered.caseVault.digest = "not-the-digest";
  assert.throws(() => vault.release({ preregistration: tampered }), /integrity mismatch/);
  const foreign = createComparisonPreregistration({
    caseVault: { digest: "aaaa", count: 11 },
    roster,
    constants: COMPARISON_CONSTANTS,
    staticMapping,
    armDeclarations: ARM_DECLARATIONS,
    regimes: [],
  });
  assert.throws(() => vault.release({ preregistration: foreign }), /does not match this sealed case vault/);
});

async function runFullCampaign(stateDirectory) {
  const cases = createComparisonCases();
  const vault = sealComparisonCases(cases);
  const roster = createComparisonRoster();
  const staticMapping = createComparisonStaticMapping();
  const preregistration = createComparisonPreregistration({
    caseVault: vault,
    roster,
    constants: COMPARISON_CONSTANTS,
    staticMapping,
    armDeclarations: ARM_DECLARATIONS,
    regimes: [...new Set(cases.map((record) => record.regime))].map((regime) => ({ id: regime, caseIds: cases.filter((record) => record.regime === regime).map((record) => record.id), clauseCount: cases.filter((record) => record.regime === regime).reduce((sum, record) => sum + record.preregisteredExpectation.clauses.length, 0) })),
  });
  return runComparisonCampaign({ vault, preregistration, roster, constants: COMPARISON_CONSTANTS, staticMapping, stateDirectory });
}

test("the full campaign: 11 cases x 4 arms, every sealed clause graded by the hash-bound grader, attestation intact", async () => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-comparison-"));
  const result = await runFullCampaign(stateDirectory);
  assert.equal(result.caseResults.length, 11);
  for (const [name, value] of Object.entries(result.checks)) assert.equal(value, true, `campaign check failed: ${name}`);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.paidModelSpendUsd, 0);
  // Every sealed clause has a recorded verdict. The suite does NOT require the
  // verdicts to match: a mismatched clause is a result, and forcing green here
  // would recreate the incentive preregistration exists to remove (FB-C-013).
  const sealedClauses = createComparisonCases().reduce((sum, record) => sum + record.preregisteredExpectation.clauses.length, 0);
  assert.equal(result.clauseVerdicts.length, sealedClauses);
  for (const verdict of result.clauseVerdicts) {
    assert.equal(typeof verdict.matched, "boolean", `clause ${verdict.clauseId} has no recorded verdict`);
  }
  // The preregistered fleet losses and shared gaps are present as data, not suppressed.
  assert.ok(result.clauseVerdicts.some((verdict) => verdict.clauseId === "G1-g-wins"));
  assert.ok(result.clauseVerdicts.some((verdict) => verdict.clauseId === "C2-a-dup"));
  assert.ok(result.clauseVerdicts.some((verdict) => verdict.clauseId === "A2-a-false"));
  console.log(`clause verdicts: ${result.hypothesisSummary.matched}/${result.hypothesisSummary.totalClauses} matched, ${result.hypothesisSummary.mismatched} mismatched`);
});

test("the campaign is deterministic: two runs produce the same result hash", async () => {
  const first = await runFullCampaign(fs.mkdtempSync(path.join(os.tmpdir(), "fleet-comparison-a-")));
  const second = await runFullCampaign(fs.mkdtempSync(path.join(os.tmpdir(), "fleet-comparison-b-")));
  assert.equal(first.resultHash, second.resultHash);
});
