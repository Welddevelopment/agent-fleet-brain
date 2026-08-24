# FB-0003 — The prevention mechanisms landed, and a blind examiner's six cases found things nobody scripted

**Date:** 2026-08-24, morning (APR-0012). Zero spend throughout.
**Held-out exam:** `artifacts/heldout/exam-v1/` — result `80090f831b40…`, specs sealed
verbatim (`exam-seal.json`), six cases, four attested arms, **no hypotheses on this
side by design**.

## Part one — the measured gaps got mechanisms

The v2 comparison (FB-0002) measured two failures no arm could prevent. Both now have
shipped, tested prevention:

- **Company invariants (the A2 gap).** The constitution carries `sharedInvariants` —
  company-wide action caps no single assignment can see. Enforced twice: the
  compatibility check refuses a plan whose declared volumes would breach a cap,
  naming action, limit and planned count; the aggregate verifier re-checks combined
  effects afterward. Declared policy, exactly like the budget.
- **Overlap conflicts (the C2 gap).** The company declares which queues may contain
  the same records (`fleetbrain.overlap-declaration.v1` — it knows its own mail
  rules; the planner cannot invent this). Before execution, the guard audits the
  plan: a declared overlap group split across specialists is **refused**, with the
  group and specialists named. Prevention by refusal, never silent re-partitioning.

Also landed under the same approval: the **untrusted-proposal validator** (the
trusted half of open-ended decomposition — arbitrary JSON either compiles through
the full goal-compiler gauntlet or is refused with the defect named, unknown fields
rejected outright), **fleet memory + adaptation advisor** (hash-chained performance
history; retire/watch/keep PROPOSALS with declared thresholds; nothing executes
them), and the **one-sided CF capability-request interface** (typed request with an
authority ceiling the resolver may never exceed, three response shapes, stub
resolver; zero CF imports — integration stays separately gated).

## Part two — the held-out exam

Six cases authored by a subagent shown ONLY the interface spec — never the arms,
hypotheses, reports or repository (zero tool calls). Specs sealed verbatim before
running; any later edit is detectable. **Caveat, stated plainly: instruction-level
blindness inside one project, not organizational independence.**

What the blind examiner's days found:

**H4 — the new invariant mechanism worked on a case its author designed to violate a
cap.** The adaptive arm was **the only honest arm**: it refused at $0 before
execution, citing the declared cap (65 unique escalations against 60). The general
agent and the naive shard both plowed through and **false-completed**; the shard
added 12 duplicate escalations on the overlapping fast-track list. The static arm
was honest by accident — its stale mapping walked into 46 authority denials first.

**H3 — a NEW gap nobody scripted: estimate-level dedup awareness does not exist.**
The examiner built a day where recognizing declared overlaps is the difference
between fitting the budget ($7.22 unique) and busting it ($8.92 raw). Every arm
with aggregate accounting refused at $0 — because the planner prices RAW volumes
and cannot see that consolidation would fit. The static arm plowed, wrote 21
duplicates, and busted the ceiling anyway. **The correct play — consolidate, then
execute under budget — is beyond every arm in the harness.** The overlap guard
prevents duplicate writes; it does not yet teach the planner's cost model about
replays. That is the next mechanism, and a blind case found it.

**H5 — a real brittleness caught: the controller halted over a rounding artifact.**
The arm authorized the exact float estimate ($6.80) as its ceiling; actual spend
summed to $6.800000000000001; the controller halted — fail-closed to the letter,
after completing every routable unit. **The exam result stands as sealed** (a
held-out exam that gets re-run until the fleet looks good is not a held-out exam).
Fixed forward: the arm now authorizes the contract limit, which is the real budget.

**H2 and H6 — the fleets' structural latency weakness, reconfirmed on unseen days.**
The adaptive arm completes the flood but its one-specialist-per-system lanes make it
as slow as the single agent on support-heavy days; the naive shard is 2.7–4.8×
faster wherever authority and overlap don't bite. H6's ledger class also surfaced an
honest role-gap return (adaptive stops at the gap; both general arms simply hold
ledger authority and win).

**H1 — everyone behaves on a quiet day**, and the coordination arms tie on cost with
the general agent within cents. No pathology; recorded because null results count.

## What this changes in the honest pitch

Unchanged: coordination pays through refusal, authority routing and conflict
behaviour, not speed. Strengthened: **on a blind case, the fleet was the only
system that refused a policy-violating day while both general baselines claimed
success falsely** — that sentence was authored by an examiner who never saw the
fleet. New on the record: two fresh gaps (estimate-level dedup pricing; ceiling
headroom) found by exam rather than by flattering design.

## Boundaries

Deterministic, fictional, zero model calls, fictional cost units. The blind author
is an agent in the same project under instruction-level blindness. Roster, mapping
and constants remain self-authored; only the six days were held out.
