# FB-0002 — Two adversarial reviews broke v1's fairness claim; v2 rebuilt it the same night

**Date:** 2026-08-24, hours after FB-0001. Zero spend throughout.
**v2 campaign:** `fleet-comparison-deterministic-v2` — preregistration
`f77c066d4ca2ebc2…`, result `42010ac25a205c67…`, **four arms, 53 machine-graded
clauses, 53 matched**, artifacts in `artifacts/fleet-comparison/deterministic-v2/`.

## What happened

FB-0001 shipped, and two independent review agents were pointed at it with
instructions to break it. They did.

**The fairness reviewer's verdict: "the claim is false as stated."** The claim was
"arms differ ONLY in coordination policy." Four non-coordination differences were
wired into the arms, and the decisive baseline was missing:

1. **Headcount (FB-C-001/002).** One agent vs five, each at capacity 200 — the
   fleets held 5× aggregate capacity, so the latency and capacity headlines were
   headcount, not policy. The reviewer built the missing baseline in six lines —
   five general clones, round-robin, zero coordination — and it **beat both fleets**
   on P1 (18,700 vs 27,400 model-ms), P2, and K1, including the case v1 sealed as
   "only the adaptive arm completes the surge."
2. **Three claim rules (FB-C-003).** The static arm was coded to ignore its own
   failing verifier receipt, which *manufactured* its C1 false completion.
3. **A withheld competence (FB-C-004).** The general agent was denied the one-line
   aggregate budget pre-sum the planner has — A1's "$0 refusal vs $5.02 halt"
   contrast was installed, not discovered.
4. **Asymmetric accounting (FB-C-005/006).** Activation was charged 1×/3×/5×
   against an identical roster; at overhead 0 the entire S1/S2 cost result vanishes.
5. **The seal did not bind the grader (FB-C-012/013).** The hypotheses were graded
   by hand-written checks outside the preregistration, four sealed expectation keys
   were never graded, and the test suite asserted zero mismatches — recreating the
   incentive preregistration exists to remove.

**The claim checker confirmed every number to the last digit** — and caught what the
numbers were wrapped in: "seven regimes" is eight; K1's static arm finished 210/310,
not 200; the losses were undercounted; "measured" overstated a deterministic model;
the 3.35× lacked its planning-arithmetic label where the demo's 1.45× carried one;
dollars were never labelled fictional; and the preregistration was **intra-session**
— cases and arms authored 94 seconds apart by the same author, so 13/13 is
consistency discipline, not blind prediction. It also confirmed the strongest parts:
every hash re-derives, the vault refuses mismatched preregistrations, the demo's
paid-evidence loader genuinely fails closed, and V2/V3's numbers match their sealed
artifacts to the last digit.

## What v2 changed, mechanically

- **A fourth arm:** `sharded` — five clones of the general agent, work dealt
  round-robin by record, zero coordination machinery. The strong simpler baseline.
- **One claim rule for every arm:** claim completion only if nothing halted or
  refused and every held scope receipt passed. `scopeReceiptsFailed` is now a metric.
- **The general arms got the aggregate budget pre-check** the planner has.
- **Activation charged per working agent, in every arm.**
- **`unnecessaryAgents` counts against the roster an arm holds**, not its
  self-reported activation list.
- **Hypotheses are machine-checkable clauses sealed inside each case**, graded by a
  generic evaluator whose **file hash is bound into the preregistration** — editing
  the grader after sealing breaks the seal, and an ungraded sealed clause is
  structurally impossible (`checks.everySealedClauseGraded`).
- **The test suite asserts every clause has a recorded verdict — not that verdicts
  match.** A mismatch is a result.
- Tautological and literal "checks" removed or derived; the result record carries
  an `honesty` block declaring self-authorship and fictional units.
- Finished evidence trees (`deterministic-v1`, `deterministic-v2`, `demo/run-1`)
  added to the hygiene guard's sealed roots, so the reproduce command now refuses
  instead of silently rewriting.

## The v2 result — and it is more interesting than v1's

All 53 sealed clauses matched, including the new losses the sharded baseline
inflicts on the fleet:

**Headcount, not coordination:** the naive shard is the **fastest arm in the
catalogue** (P1: 18,700 model-ms vs both fleets' 27,400 vs the single agent's
91,900) and **completes the 300-unit surge** the single agent cannot — faster than
the adaptive fleet and with no planner at all.

**Where coordination actually earns its keep, measured against the shard:**

- **C1 (overlapping queues):** the shard double-writes 3 overlap records — and
  because every clone-scoped receipt passes, it **claims completion falsely**. The
  static split also duplicates 3 (now with an honest incomplete claim under the
  unified rule). The adaptive planner's consolidation yields **0 duplicates and a
  true completion**. The single agent is clean only because one writer cannot
  duplicate by construction.
- **G2 (stale authority):** a maintained authority table: adaptive 0 denials vs the
  static map's 4. (The general arms hold all authority and score 0 trivially.)
- **A1 (aggregate budget):** every arm given aggregate accounting refuses at $0;
  only the static arm, which has none, spends 6.40 fictional units against the 5.00
  limit and claims success.
- **G1 stands as the fleet's honest loss:** both general arms complete 14/14; the
  fleet returns the gap at 10/14 with a receipt.
- **C2 and A2 stand as known gaps** — with C2's description corrected per the
  review: the adaptive arm detects the conflict *late* (the scope-ownership check
  fails and the controller halts after the duplicate writes exist); it cannot
  *prevent* it. The shard's C2 duplicate count is deliberately unregistered — it is
  an ordering artifact (volumes mod clone-count), reported as observed, which is
  itself evidence for the reviewer's point that such counts are properties of
  orderings, not policies.

**The honest one-sentence verdict, now in the sealed summary itself:** against a
naive 5-way shard, the adaptive fleet's measured edge narrows to conflict behaviour
under overlap and authority routing; parallelism and capacity are headcount.

## Open, recorded, not silently dropped

- Activation-overhead sensitivity sweep (FB-C-005) and C2 ordering sweep (FB-C-009).
- Record partitioning belongs in the planner, not the harness bridge (FB-C-011).
- Restart/resume of a campaign against existing controller state (FB-C-016).
- Replayed work costs nothing (FB-C-017) — single-agent duplicate zeros are
  structural, now noted in C1's clause prose.
- Cases remain self-authored; a held-out case author is the only cure for the
  intra-session caveat. The roadmap's "frozen **unseen** objectives" is still unmet.
- `incorrectSideEffects` in adaptive observations is a declared non-measurement;
  the controller's halt-on-incorrect-effect control remains unexercised here.
- The DAS-side sibling of this review — the compliance audit — passed 6/6 rules and
  separately flagged that the concurrent DAS panel session made paid OpenAI calls
  tonight (not this build's; for spend reconciliation).

## Reproduce

```
node src/experiments/fleet-comparison-campaign.js
```

now targets v2 and **refuses** to rewrite sealed campaign directories. Same
deterministic guarantee: same inputs, same `resultHash`.
