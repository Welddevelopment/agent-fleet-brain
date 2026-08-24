# FB-0001 — The comparative evaluation harness exists, and its first sealed run is honest in both directions

> **CORRECTED AND PARTLY SUPERSEDED, 2026-08-24 (same night) — read FB-0002.**
> Two independent adversarial reviews found that v1's central fairness claim was
> false as stated: the arms differed in more than coordination policy (headcount,
> claim rules, a withheld aggregate check, asymmetric activation accounting), the
> decisive sharded-general baseline was missing and beats both fleets on latency
> and capacity, and the "preregistered" grading was not bound into the seal.
> **The v2 campaign (deterministic-v2, four arms, hash-bound mechanical grader)
> supersedes this run's latency, capacity, cost and "only adaptive" claims.**
> Factual corrections applied below are marked ⟨corrected⟩; the original sealed
> v1 artifacts are untouched and still verify. What survives of v1 unchanged:
> C1/C2/G1/G2/A1/A2's duplicate, authority, refusal and false-completion
> mechanics, all reconfirmed in v2.


**Date:** 2026-08-24 (overnight build, zero spend; hub approval APR-0011 ⟨corrected — renumbered from APR-0007; the record lives on the hub worktree branch pending merge, which is why a main-checkout reader will not find it yet⟩).
**Campaign:** `fleet-comparison-deterministic-v1`.
**Preregistration:** `43a39ec4ec4ffd18…` — sealed to disk before any arm ran.
**Result:** `d471657ce626a1a4…`. **13 of 13 preregistered hypotheses matched. ⟨corrected⟩ Three of the thirteen are
preregistered fleet losses (S1 cost, S2 cost, G1), one more is a preregistered known
adaptive gap (C2), and one is a three-way failure (A2).**

This report starts Fleet Brain's own report sequence (FB-####). The inherited
0076–0117 numbers stay as they are; 0116/0117 already collide with DAS's.

## Why this experiment and not another

The canonical roadmap names one required next scientific step: compare the bounded
controller against **a strong single general agent** and **a static predefined
fleet** on frozen cases — and explicitly rejects do-nothing baselines. V3 scaled
volume against a do-nothing baseline; `STATE.md` records that V3 may have been the
wrong experiment. This is the right one, built deterministically.

## Fairness, by construction rather than assertion

One shared work engine performs every unit of work in every arm. Cost and latency
are constants keyed by **system**, never by agent or arm. Every agent has identical
capacity (200/window). Arms differ ONLY in coordination policy. A structural test
checks that a sample unit list produces identical world end-state, spend and
latency under two different agent labels ⟨corrected: a check on one sample, not a
proof across the catalogue⟩. Initial world digests are checked equal across arms per case.

The arms:

- **general** — one agent holding every permitted tool, working serially, honoring
  the explicit cost ceiling. Not a strawman: it wins where it should.
- **static** — a frozen mapping with documented staleness, full-roster activation,
  no gap detection, no replanning. Its pathology is silence.
- **adaptive** — the shipped planner, verifier and controller unmodified, driven by
  harness-constructed observations (the record-to-specialist partition is a harness
  bridge; the shipped planner allocates quantities, not records) ⟨corrected⟩.
  Where it lacks a control, it loses, and the loss is recorded.

Entry points are execution-attested against the real modules — the campaign takes
the callable FROM the resolved declaration, so declaring one function and running
another is impossible (the Erratum-0111a lesson, applied).

## Results — eleven cases, eight regimes ⟨corrected⟩

*(All dollars and milliseconds below are fictional model units from the sealed
constants table — planning arithmetic, not spend or measured runtime.)* ⟨corrected⟩

| Case | Regime | The number that matters |
|---|---|---|
| S1/S2 | small-simple | **General agent wins on cost** ($0.18 vs adaptive $0.22, static $0.26). Coordination overhead is real and unamortisable at 3–6 items. |
| P1/P2 | parallel-latency | **Fleets beat the single agent 3.35× on P1, 1.86× on P2** (27,400 vs 91,900 model-ms on P1) ⟨corrected⟩ — superseded by v2: the naive 5-way shard beats BOTH fleets (18,700 on P1). |
| C1 | shared-record conflict | Planner consolidates overlapping queues onto one specialist: **adaptive 0 duplicates, static 3** (and a false completion). |
| C2 | conflict across a capacity split | **KNOWN GAP: adaptive duplicates 10 — identical to static.** Consolidation is not conflict detection. |
| G1 | role gap | **The general agent completes 14/14 and wins outright.** The adaptive fleet returns the gap, finishes 10/14, zero incorrect effects, honest incomplete claim. The static fleet claims success at 10/14 — false completion. |
| G2 | stale authority | Static walks into **4 authority denials**; adaptive's compatibility routing has 0; general 0. |
| K1 | capacity | **The adaptive fleet completes the 300-unit surge** (splits 200/100; the general agent stops at its 200 window; the static fleet's single mapped support agent stops at 200, its arm finishing 210/310) ⟨corrected⟩ — superseded by v2: the naive shard ALSO completes, faster, with no planner. |
| A1 | aggregate budget | Individually cheap, collectively $6.40 against a $5 limit. **Adaptive refuses at $0.00** with an explicit blocker; general halts at $5.02 honestly; **static spends $6.50 and claims success** — incorrect effect plus false completion. |
| A2 | company invariant | **KNOWN SHARED GAP: all three arms false-complete** against an escalation cap no arm was shown. Only parent-goal verification catches it. |

## What this does and does not establish

It establishes, deterministically: the coordination value of the bounded fleet is
regime-dependent and now **quantified under a deterministic cost/latency model** ⟨corrected⟩ — parallelism, capacity splitting, authority
routing, consolidation and aggregate budget accounting are wins; small-case
overhead and role gaps are losses; cross-assignment conflict detection and
company-invariant enforcement **do not exist in any arm**, which is exactly what
the roadmap's medium-term conflict controls are for.

It does **not** establish: anything about model-backed agents, external frameworks
(OpenAI Agents, LangGraph, CrewAI, Magentic-One — untested and untestable at zero
spend), customer value, or production behaviour. No model ran. Passing tests prove
plumbing. The evidence boundary is written into every sealed record.

## Reproduce

```
node src/experiments/fleet-comparison-campaign.js
```

Re-running against the sealed preregistration refuses if the catalogue changed.
The campaign is deterministic: the same inputs produce the same `resultHash`.
Artifacts: `artifacts/fleet-comparison/deterministic-v1/`.
