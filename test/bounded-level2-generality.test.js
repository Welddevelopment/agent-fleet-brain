import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedFleetGeneralityMatrix } from "../src/fleet/bounded-level2-generality.js";

test("the same bounded planner covers full, partial and correctly blocked fictional company profiles", () => {
  const matrix = runBoundedFleetGeneralityMatrix();
  assert.equal(matrix.profiles.length, 5);
  assert.ok(Object.values(matrix.checks).every(Boolean));
  assert.equal(matrix.profiles.find((item) => item.result.id === "support-surge").result.assignedVolume, 100);
  assert.equal(matrix.profiles.find((item) => item.result.id === "compressed-deadline").result.roleGaps, 2);
  assert.deepEqual(matrix.profiles.find((item) => item.result.id === "role-proposal-limit").result.blockerCodes, ["new-role-proposal-limit"]);
  assert.deepEqual(matrix.profiles.find((item) => item.result.id === "hard-budget-limit").result.blockerCodes, ["hard-cost-limit"]);
});
