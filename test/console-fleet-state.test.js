import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadFleetConsoleState } from "../src/console/fleet-state.js";

test("fleet console exposes a sanitized verified parent-goal continuation", () => {
  const state = loadFleetConsoleState();
  assert.equal(state.integrity, "valid");
  assert.equal(state.initial.assigned, 105);
  assert.equal(state.initial.parentCompleted, false);
  assert.equal(state.roleGap.selectedCandidate, "finance-close:balanced");
  assert.equal(state.continuation.carriedWithoutRerun, 105);
  assert.equal(state.continuation.residualExecuted, 10);
  assert.equal(state.continuation.totalVerified, 115);
  assert.equal(state.continuation.parentCompleted, true);
  assert.equal(state.plan.assignments.length, 5);
  assert.equal(state.plan.assignments.filter((item) => item.phase === "residual").length, 1);
  assert.equal(JSON.stringify(state).includes("summaryHash"), false);
  assert.equal(JSON.stringify(state).includes("assignmentHash"), false);
  assert.match(state.boundary, /deterministic/i);
});

test("fleet console fails closed when a source summary is mutated", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "das-fleet-console-"));
  const source = JSON.parse(fs.readFileSync("artifacts/fleet/bounded-level2-role-gap-return-v1/summary.json", "utf8"));
  source.residualItemsExecuted = 11;
  const mutated = path.join(temporary, "mutated.json");
  fs.writeFileSync(mutated, JSON.stringify(source));
  const state = loadFleetConsoleState({ returnSummaryPath: mutated });
  assert.equal(state.integrity, "invalid");
  assert.match(state.error, /integrity/i);
});
