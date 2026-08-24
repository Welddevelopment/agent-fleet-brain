import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedFleetPlan } from "../src/fleet/bounded-level2-planner.js";
import { verifyBoundedFleetPlan } from "../src/fleet/bounded-level2-verifier.js";
import { compileObjectiveIntake } from "../src/fleet/goal-compiler.js";
import { assertExecutionSchedule, createExecutionSchedule } from "../src/fleet/scheduler.js";
import {
  onboardingAdapters,
  onboardingIntakeArguments,
  onboardingObjective,
  onboardingSnapshots,
  onboardingSpecialists,
} from "./helpers/onboarding-fixture.js";

function scheduledFixture() {
  const adapters = onboardingAdapters();
  const compiled = compileObjectiveIntake({
    objective: onboardingObjective(),
    adapters: Object.values(adapters),
    snapshots: onboardingSnapshots(adapters),
    ...onboardingIntakeArguments(),
  });
  const specialists = onboardingSpecialists();
  const plan = createBoundedFleetPlan({ contract: compiled.intake.contract, specialists });
  const planVerification = verifyBoundedFleetPlan({ contract: compiled.intake.contract, specialists, plan });
  return { compiled, specialists, plan, planVerification };
}

test("the schedule orders waves by declared dependencies and parallelises across systems", () => {
  const { compiled, specialists, plan, planVerification } = scheduledFixture();
  const schedule = createExecutionSchedule({ contract: compiled.intake.contract, plan, planVerification, specialists, graph: compiled.graph });
  assert.equal(assertExecutionSchedule(schedule), true);
  assert.equal(schedule.metrics.waves, 2);
  const waveOf = (workloadId) => schedule.waves.findIndex((wave) => wave.assignments.some((item) => item.workloadId === workloadId));
  assert.equal(waveOf("signup-batch"), 0);
  assert.equal(waveOf("invoice-batch"), 1);
  assert.equal(waveOf("welcome-call-batch"), 1);
  // invoiced (billing-local) and welcomed (crm-local) run in parallel in wave 1:
  // wave latency is the busiest lane, not the sum.
  const waveOne = schedule.waves[1];
  assert.equal(waveOne.waveLatencyMs, Math.max(...waveOne.assignments.map((item) => item.expectedLatencyMs)));
  assert.ok(schedule.metrics.scheduledLatencyMs < schedule.metrics.serialLatencyMs);
  assert.ok(schedule.metrics.parallelSpeedup > 1);
});

test("the schedule is a pure function of its inputs — two runs are hash-identical", () => {
  const first = (() => { const { compiled, specialists, plan, planVerification } = scheduledFixture(); return createExecutionSchedule({ contract: compiled.intake.contract, plan, planVerification, specialists, graph: compiled.graph }); })();
  const second = (() => { const { compiled, specialists, plan, planVerification } = scheduledFixture(); return createExecutionSchedule({ contract: compiled.intake.contract, plan, planVerification, specialists, graph: compiled.graph }); })();
  assert.equal(first.scheduleHash, second.scheduleHash);
});

test("an unverified plan is never scheduled", () => {
  const { compiled, specialists, plan, planVerification } = scheduledFixture();
  assert.throws(
    () => createExecutionSchedule({ contract: compiled.intake.contract, plan, planVerification: { ...planVerification, passed: false }, specialists, graph: compiled.graph }),
    /Never schedule an unverified plan/,
  );
  assert.throws(
    () => createExecutionSchedule({ contract: compiled.intake.contract, plan, planVerification: undefined, specialists, graph: compiled.graph }),
    /Never schedule an unverified plan/,
  );
});

test("one specialist cannot run two assignments in the same wave — its lane serialises", () => {
  // Without a graph everything lands in wave 0, so a specialist holding two
  // workloads in the fixture contract must show a serialization record and the
  // wave latency must reflect its summed lane, not the parallel maximum.
  const { compiled, specialists, plan, planVerification } = scheduledFixture();
  const schedule = createExecutionSchedule({ contract: compiled.intake.contract, plan, planVerification, specialists });
  assert.equal(schedule.metrics.waves, 1);
  const wave = schedule.waves[0];
  // billing-local hosts two assignments in wave 0 -> the system lane serialises them.
  const billingLane = wave.laneLatencies.find((lane) => lane.resource === "system:billing-local");
  const billingAssignments = wave.assignments.filter((item) => item.systemId === "billing-local");
  assert.equal(billingAssignments.length, 2);
  assert.equal(billingLane.laneLatencyMs, billingAssignments.reduce((sum, item) => sum + item.expectedLatencyMs, 0));
  assert.ok(schedule.conflictControls.serializations.some((item) => item.resource === "system:billing-local" && item.reason === "single-writer-per-system"));
  assert.equal(wave.waveLatencyMs, Math.max(...wave.laneLatencies.map((lane) => lane.laneLatencyMs)));
});

test("capacity is independently re-verified against forged specialist records", () => {
  const { compiled, specialists, plan, planVerification } = scheduledFixture();
  // Forge a plan quantity above capacity by tampering with the assignment set.
  const tamperedPlan = structuredClone(plan);
  tamperedPlan.selected.assignments[0].quantity = 999;
  assert.throws(
    () => createExecutionSchedule({ contract: compiled.intake.contract, plan: tamperedPlan, planVerification, specialists, graph: compiled.graph }),
    /integrity mismatch|over capacity/,
  );
});

test("a tampered schedule fails its own integrity check", () => {
  const { compiled, specialists, plan, planVerification } = scheduledFixture();
  const schedule = createExecutionSchedule({ contract: compiled.intake.contract, plan, planVerification, specialists, graph: compiled.graph });
  const tampered = structuredClone(schedule);
  tampered.metrics.scheduledLatencyMs = 1;
  assert.throws(() => assertExecutionSchedule(tampered), /integrity mismatch/);
});
