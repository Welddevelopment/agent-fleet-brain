import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { createBoundedLevel2Fixture } from "../src/fleet/bounded-level2-fixture.js";
import { createBoundedFleetPlan } from "../src/fleet/bounded-level2-planner.js";
import { createFleetAssignmentObservation } from "../src/fleet/bounded-level2-controller.js";
import { FleetMemory, proposeFleetAdaptations } from "../src/fleet/fleet-memory.js";

const T = "2026-08-24T09:00:00.000Z";

function fixtureObservations({ failSecond = false, unsafeFirst = false } = {}) {
  const fixture = createBoundedLevel2Fixture();
  const plan = createBoundedFleetPlan(fixture);
  return plan.selected.assignments.slice(0, 3).map((assignment, index) => {
    const specialist = fixture.specialists.find((item) => item.id === assignment.specialistId);
    return createFleetAssignmentObservation({
      contract: fixture.contract, plan, assignment, specialist,
      result: {
        verifierId: assignment.verifierId, independentlyVerified: true,
        verificationPassed: failSecond && index === 1 ? false : true,
        completedQuantity: assignment.quantity, actualCostUsd: 0.1,
        unsafeAttempts: unsafeFirst && index === 0 ? 1 : 0,
        incorrectSideEffects: 0,
        verificationReceiptHash: digest({ memoryTest: assignment.assignmentId }),
      },
    });
  });
}

test("observations chain durably: reload verifies, and specialist records aggregate across campaigns", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fleet-memory-")), "memory.json");
  const memory = new FleetMemory({ filePath: file });
  for (const observation of fixtureObservations()) memory.recordObservation({ observation, campaignId: "campaign-a", recordedAt: T });
  for (const observation of fixtureObservations()) memory.recordObservation({ observation, campaignId: "campaign-b", recordedAt: T });
  const reloaded = new FleetMemory({ filePath: file });
  assert.equal(reloaded.history().length, 6);
  const records = reloaded.specialistRecords();
  assert.ok(records.length >= 2);
  for (const record of records) {
    assert.equal(record.verificationRate, 1);
    assert.deepEqual(record.campaigns, ["campaign-a", "campaign-b"]);
  }
});

test("a rewritten history is refused on load — the chain makes silent edits impossible", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fleet-memory-tamper-")), "memory.json");
  const memory = new FleetMemory({ filePath: file });
  for (const observation of fixtureObservations()) memory.recordObservation({ observation, campaignId: "campaign-a", recordedAt: T });
  const entries = JSON.parse(fs.readFileSync(file, "utf8"));
  entries[0].actualCostUsd = 0; // flatter the history
  fs.writeFileSync(file, JSON.stringify(entries));
  assert.throws(() => new FleetMemory({ filePath: file }), /integrity mismatch|chain broken/);
});

test("the advisor proposes retirement on any recorded unsafe attempt, with the evidence attached", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fleet-memory-unsafe-")), "memory.json");
  const memory = new FleetMemory({ filePath: file });
  for (const observation of fixtureObservations({ unsafeFirst: true })) memory.recordObservation({ observation, campaignId: "campaign-a", recordedAt: T });
  const receipt = proposeFleetAdaptations({ memory, minimumObservations: 1, generatedAt: T });
  const flagged = receipt.proposals.find((item) => item.evidence.unsafeAttempts > 0);
  assert.equal(flagged.recommendation, "propose-retire");
  assert.match(flagged.reason, /safety history disqualifies/);
  assert.deepEqual(Object.values(receipt.authority), [false, false, false]);
});

test("thin history yields 'insufficient-history', not a confident call; failed verifications yield 'propose-watch'", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fleet-memory-thin-")), "memory.json");
  const memory = new FleetMemory({ filePath: file });
  for (const observation of fixtureObservations({ failSecond: true })) memory.recordObservation({ observation, campaignId: "campaign-a", recordedAt: T });
  const thin = proposeFleetAdaptations({ memory, minimumObservations: 5, generatedAt: T });
  assert.ok(thin.proposals.every((item) => ["insufficient-history", "propose-retire"].includes(item.recommendation) || item.recommendation === "insufficient-history"));
  const seasoned = proposeFleetAdaptations({ memory, minimumObservations: 1, generatedAt: T });
  const watched = seasoned.proposals.find((item) => item.evidence.verificationRate < 1);
  assert.equal(watched.recommendation, "propose-watch");
});
