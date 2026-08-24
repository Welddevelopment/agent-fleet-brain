import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { loadPaidEvidence, runFleetBrainDemo } from "../src/fleet/demo-story.js";

test("the demo story runs end to end into a fresh directory and seals every stage", async () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-demo-"));
  const story = await runFleetBrainDemo({ outputDirectory });
  assert.equal(story.schemaVersion, "fleetbrain.demo-story.v1");
  const expectedStages = ["constitution", "goal-compilation", "plan", "schedule", "execute-and-verify", "role-gap-construction", "refusals", "comparison-verdict", "paid-evidence"];
  assert.deepEqual(story.stages.map((stage) => stage.stage), expectedStages);
  for (const stage of story.stages) {
    const copy = structuredClone(stage);
    const expected = copy.stageHash;
    delete copy.stageHash;
    assert.equal(digest(copy), expected, `stage ${stage.stage} hash mismatch`);
  }
  const executed = story.stages.find((stage) => stage.stage === "execute-and-verify");
  assert.equal(executed.parentGoalCompleted, true);
  assert.equal(executed.duplicates, 0);
  assert.equal(executed.authorityViolations, 0);
  assert.equal(story.deterministic.modelCalls, 0);
  assert.equal(story.deterministic.paidModelSpendUsd, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDirectory, "manifest.json"), "utf8"));
  assert.equal(manifest.storyHash, story.storyHash);
});

test("the demo refuses a non-empty output directory — reruns can never overwrite evidence", async () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-demo-dirty-"));
  fs.writeFileSync(path.join(outputDirectory, "existing.json"), "{}");
  await assert.rejects(() => runFleetBrainDemo({ outputDirectory }), /not empty/);
});

test("the demo requires an accountable operator", async () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-demo-owner-"));
  await assert.rejects(() => runFleetBrainDemo({ outputDirectory, approvedBy: "" }), /accountable operator/);
});

test("paid evidence loads read-only with V3's loss framed as a loss, and integrity is checked not assumed", () => {
  const evidence = loadPaidEvidence();
  assert.equal(evidence.separateFromDeterministicChain, true);
  assert.equal(evidence.v2.status, "verified");
  assert.equal(evidence.v2.parentGoalCompleted, true);
  assert.equal(evidence.v2.settledCalls, 56);
  assert.equal(evidence.v3.status, "verified");
  assert.equal(evidence.v3.campaignStatus, "failed");
  assert.equal(evidence.v3.settledCalls, 49);
  assert.match(evidence.v3.framing, /valid loss/);
});
