# Agent Fleet Brain

**An operating layer for an adaptive AI workforce.**

Give a company a goal, a budget, and the boundaries it must respect. Fleet Brain's
long-term job is to determine what work needs doing, choose or construct the right
specialists, coordinate their actions, and independently establish that the whole
goal was achieved.

This repository builds that control layer. It contains executable goal compilation,
specialist allocation, dependency-aware scheduling, company-wide constraints,
durable execution, independent outcome checks, and a controlled missing-role
construction path through [Dynamic Agent Specialisation](https://github.com/Welddevelopment/dynamic-agent-specialisation).

The current runnable story turns a fictional customer-onboarding objective into
**three assignments, twelve independently verified work units, and one completed
parent goal**. A second scene detects a missing finance specialist, uses DAS to
construct and evaluate one, and replans only the blocked work.

## See it work

Requires Node.js 24+ and DAS checked out beside this repository. The folder names
below match the local package dependency:

```bash
git clone https://github.com/Welddevelopment/dynamic-agent-specialisation.git "Dynamic Agent Specialisation"
git clone https://github.com/Welddevelopment/agent-fleet-brain.git "Agent Fleet Brain"
cd "Agent Fleet Brain"
npm install
npm run demo
npm run fleet:console
```

Open **http://127.0.0.1:4392** and select **Demo run** in the navigation.

The demo executes into a fresh `artifacts/demo/run-N` directory, without overwriting
an earlier take. No model key is needed and it makes no paid calls. The console
reads the saved, integrity-checked receipts. The earlier 115-item continuation
chain and historical model-backed campaigns remain separately inspectable.

## From goal to verified work

```text
Company objective + constitution
                 │
      Trusted workload snapshots
                 │
      Compile an exact work graph
                 │
      Evaluate specialist allocations
                 │
      Check policy, budget and overlap
                 │
      Schedule dependencies and resources
                 │
      Bind execution to the approved plan
                 │
      Execute + verify each assignment
                 │
      Independently verify the parent goal
                 │
         Complete, continue or hand off
```

**Goal compilation.** Declared outcomes are bound to approved operations and fresh
workload snapshots. The compiler checks exact coverage, dependencies, cycles and
constitutional restrictions. Untrusted proposals cannot silently widen scope.

**Workforce allocation.** The planner compares bounded strategies against
specialist fitness, capacity, cost, latency and authority. Missing roles become
explicit gap requests instead of assignments to unsuitable agents.

**Scheduling.** Dependency waves respect shared-system and specialist resource
limits. Timing estimates are planning arithmetic, distinct from measured model
latency.

**Company-wide controls.** Constitutional action caps are checked before execution
and again against combined effects. An overlap guard refuses declared overlapping
queues that would be split unsafely across specialists.

**Durable execution and independent verification.** Authorization binds to exact
plan and assignment hashes. The controller records external outcome evidence,
preserves completed work across continuation, and requires aggregate verification
before declaring the parent complete.

**Gap-driven specialist construction.** A separate explicitly approved stage calls
DAS's compiler, evaluates a candidate portfolio, readmits the selected specialist
through the same gate, and replans residual work. The current demo demonstrates
construction and replanning here, separately from its executed onboarding scene.

**Evidence-driven adaptation.** A hash-chained performance history supports
keep/watch/retire proposals under declared thresholds. Proposals remain separate
from permission to change a running fleet.

## What the comparisons revealed

The central question is **when coordination earns its extra machinery**.

The corrected four-arm evaluation compares a single general agent, five sharded
general agents, a static fleet, and the adaptive controller. Its 53 mechanical
clauses include fleet losses; they are not 53 benchmark wins. Simple sharding is
faster in several regimes. The controller's benefits concentrate on overlapping
work, authority routing and aggregate limits.

A later six-case held-out exam was authored by a separate agent shown only the
interface. On the policy-cap case, the adaptive controller refused before acting
while the general and sharded baselines falsely claimed completion. The static
fleet also stopped, after authority denials. The same exam exposed an
estimate-level deduplication gap and a rounding-related halt; those original
results remain sealed.

These are deterministic comparisons with fictional cost/latency units and
instruction-level blindness. Read the mechanisms and complete results in
[FB-0002](reports/FB-0002-adversarial-review-and-v2.md) and
[FB-0003](reports/FB-0003-heldout-exam-and-prevention-mechanisms.md).

## The larger architecture

Three distinct layers address different parts of autonomous work:

- **DAS constructs and evaluates the specialist.** Fleet Brain imports it through
  a real, one-way package dependency for controlled role construction.
- **Capability Factory acquires the missing action capability.** Fleet Brain has
  a typed request/response boundary and a stub resolver. The live CF join is a
  future engineering milestone.
- **Fleet Brain designs and coordinates the workforce.** It owns company goals,
  allocation, shared constraints, sequencing and the aggregate outcome.

The eventual composition is one company objective → the right specialists → the
capabilities they need → verified work. Each layer maintains its own evidence;
a composed claim requires a composed test.

## Current stage and next frontier

Fleet Brain is an executable bounded control-layer prototype. The next difficult
work is broader trustworthy goal interpretation, planning with deduplicated work,
safe adaptive repartitioning, budgeted model-backed workforce design, and the real
CF capability-resolution join. An autonomous company-wide workforce is the
long-term direction.

Current evidence is local and fictional. The deterministic demo, preserved
model-backed campaigns, and future vision are separate evidence categories. No
customer deployment, production reliability or commercial adoption is implied.

## Repository map

| Path | Responsibility |
|---|---|
| `src/fleet/goal-compiler.js` | Objective coverage and dependency compilation |
| `src/fleet/constitution.js` | Company-level policy and authority binding |
| `src/fleet/bounded-level2-planner.js` | Candidate workforce allocation |
| `src/fleet/scheduler.js` | Dependency and resource scheduling |
| `src/fleet/bounded-level2-controller.js` | Durable execution and completion |
| `src/fleet/overlap-guard.js` | Pre-execution overlap refusal |
| `src/fleet/aggregate-verifier.js` | Combined-effect invariants |
| `src/fleet/role-gap-construction.js` | Controlled DAS construction and readmission |
| `src/fleet/fleet-memory.js` | Evidence-bound adaptation proposals |
| `src/fleet-console/` | Inspectable demo and evidence surface |
| `src/experiments/` | Rehearsals and frozen campaign runners |
| `test/` | Deterministic controls and regression tests |
| `artifacts/`, `reports/` | Preserved evidence and its interpretation |

```bash
npm run demo            # Execute a fresh local story
npm run fleet:console   # Inspect existing evidence
npm test                # Deterministic repository tests
```

Some historical admission tests re-derive source evidence from private DAS run
artifacts not included in a fresh clone. See [PROVENANCE.md](PROVENANCE.md) for the
exact reproduction boundary. Historical `das.*` schemas preserve the bytes sealed
before Fleet Brain became a separate repository; they must not be renamed inside
the evidence.
