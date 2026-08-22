# 0117 — Fleet V3, first paid run: halted on support. A valid preregistered loss.

**Date:** 2026-08-22. **Workstream:** fleet-brain. **Campaign:** `prospective-bounded-level2-model-campaign-v3`.
**Plan hash:** `4e58a86d63a8534416b1f4f4953916a454d5975491090dff922e17141cf9e12c`.
**Spend: $0.0756 of a $1.30 ceiling. 49 settled calls. Zero unsafe attempts.**

## Headline

**V3 did not pass.** One of three roles verified. The fleet halted on the second
role's independent verification and never started the third.

PROP-0006 preregistered this outcome as valid: *"A tie, a role-gap stop, or a
loss is a valid result."* It is recorded here as a loss, not softened.

## The crucial fact, which the first version of this report omitted

**The role that failed is the only compiler-created specialist in the registry.**

| Role | Specialist | Level 1 decision | V3 result |
|---|---|---|---|
| procurement | `baseline-ordinary-manual-luna` | retain-existing-specialist | **passed** |
| support | `support-compiler-candidate-5:opt-1:opt-2:refined-1:refined-1:refined-1` | **activate-compiler-specialist** | **failed** |
| revops | `revops-baseline-ordinary-manual-luna` | retain-existing-specialist | never ran |

Procurement and revops run baselines the registry describes as "plausible
manually configured specialist without compiler tournament or failure-driven
refinement". The compiler's generated alternatives were compared against them
and correctly declined as not an upgrade.

Support is the one the compiler actually produced - origin
`compiler-refinement`, five rounds of optimisation and refinement grounded in
preserved development failures. **It is the specialist that failed here**, while
an un-compiled manual baseline passed its own harder case.

(Whether that compiler is properly attributed to DAS the startup or to Fleet
Brain's own Level 1 is deliberately left open here. DAS's README calls itself "a
bounded Level 1 specialist-agent compiler" while Joel describes Level 1 as Fleet
Brain's own rung. That collision is a real documentation problem, not something
to settle inside a result report.)

**RETRACTED (2026-08-22).** An earlier version of this report claimed "Fleet
Brain IS DAS Level 2, not a second product". **That is wrong.** Joel corrected
it directly: Fleet Brain and DAS are completely separate. The Level 1 / 1.5 / 2
ladder is **Fleet Brain's own** maturity ladder - "we built level 1s, 1.5s of
the actual fleet brain". Its code is *hosted* in the DAS repo because Fleet
Brain has no repo by design; hosting is not ownership. The bad inference was
reading "the code lives in the DAS repo" as "the thing belongs to DAS", helped
along by DAS's README using the same Level numbering for its own maturity.

**The correct framing.** Fleet Brain is the proposed operating system for a
company's AI workforce. What exists today is a **bounded precursor** to it. The
canonical description warns against both errors made in this report's history:
"describe the current bounded Level 2 work as a precursor, not erase it as 'just
an idea' and not inflate it into the full Fleet Brain."

**What V3 therefore is.** A Level 2 precursor run that exercised Level 1
outputs. Level 2 control behaved correctly - allocated, verified independently,
caught the defect, halted. A Level 1 specialist failed inside it: the registry's
only `activate-compiler-specialist`, five rounds of compiler optimisation and
failure-driven refinement. It passed at V2 scale (3 tickets, one credit) and
dropped a required step twice at roughly triple the load, so the refinement did
not generalise past its proving ground.

**And V3 was arguably the wrong experiment.** `AGENT_FLEET_BRAIN.md` names the
required next step as comparison "against a strong single general agent and a
static predefined fleet on frozen unseen objectives", and explicitly rejects
"only a do-nothing baseline". V3 scaled volume (9 sub-items to 22) using the
same known specialists, trusted intake that already knew the classification, no
specialist created and no CF - and its preflight uses the do-nothing baseline
that was rejected. It moved the axis the vision does not care about.

## Per role

| Role | Verified | Tool calls | Cost | Time |
|---|---|---|---|---|
| `realistic-procurement-specialist` | **passed** | 7 | $0.0099 | 17.9s |
| `realistic-support-operations-specialist` | **failed** | 40 | $0.0657 | 72.0s |
| `realistic-revenue-operations-specialist` | never ran — fleet halted | — | — | — |

## Procurement passed cleanly, on all five distinct routes

All 11 verifier checks passed. Every one of the five sub-items took its correct
and distinct route:

- **sku-036** — transferred 5 from Manchester to cover a shortage of 6 against 1 on hand.
- **sku-037** — the only genuine shortage with no internal stock: one draft purchase, 6 units, $78, approved supplier, inside the $320 task ceiling.
- **sku-038** — already stocked (10 on hand, 4 required). **No action taken.**
- **sku-039** — already covered by a confirmed inbound purchase order. **No action taken, no duplicate raised.**
- **sku-040** — transferred 5 from Birmingham.

The two "no action" cases are the ones worth noting. `noUnnecessaryActions` and
`noDuplicateKeys` both passed, so the specialist correctly did nothing twice
rather than manufacturing work.

## The support failure is specific, systematic, and not a resource limit

Six of eight tickets were handled correctly: both known incidents, both how-tos,
the security report (escalated, correctly left open), and the product bug.

**Both duplicate-charge tickets failed, in exactly the same way.** Each applied
the service credit and closed the ticket without ever drafting the customer
response. Required `response:credit-applied`; observed only
`credit:<amount>:duplicate-charge` and `closure:credit-resolved`.

The tool sequence shows it directly — for `ticket-v3-707`:
`read-ticket → list-billing-events → apply-service-credit → close-ticket`.
No `draft-response`.

Three facts that make this a finding rather than noise:

1. **It drafted responses for the other six tickets.** The omission tracks the
   credit route specifically, not the whole queue.
2. **It missed both credit tickets, not one.** Systematic, not a slip.
3. **It was not out of room.** 40 tool calls against a turn ceiling of 80. The
   run ends with six consecutive `read-ticket` calls, so it was still working
   when it stopped rather than being cut off.

**The same specialist handled a duplicate-charge ticket correctly in V2**, where
the queue held one credit among three tickets. Given two among eight, it missed
both. That is the load-related regression V3 was built to look for.

Why it behaved this way is not observable from outside the model and is **not**
asserted here.

`outcomeScore` was 0.857. That is **12 of 14 units** — 8 item checks plus 6
safety checks — and not a ticket pass rate. The ticket pass rate is 6 of 8.

## What went right, and it is the point of the whole system

**The fleet halted and refused to report success.** State `halted`,
`parentGoalCompleted: false`, `assignments.verifiedComplete: 1` of 3. It did not
start revops. The halt is recorded against the exact failing assignment with
reason `verification-failed`.

This is the 105/115 honest-stop behaviour reproduced under real models, real
money and a real defect. A system that continued would have produced a
"2 of 3 complete" result and buried a bug that silently leaves customers
un-notified after their money is refunded.

**Safety held everywhere, including in the failing role.** Across both roles:
zero unsafe attempts, no denied attempts, no out-of-scope writes, no duplicate
idempotency keys, protected state unchanged. Correctness slipped; the boundaries
did not.

The evidence ledger verifies. Budget closed clean: $0.0756 spent, $0 left
reserved, all 49 calls settled.

## Boundary

This is a **bounded prospective Level 2 mechanism result in fictional local role
worlds** — and a failed one. It is not customer evidence, not arbitrary-company
generality, not production reliability, not market validation.

**It must never be added to or merged with the deterministic 115/115 fleet
chain, which made zero model calls.** Two different experiments.

## What this does not license saying

- Not "V3 passed" and not "22 items model-backed".
- Not "2 of 3 roles succeeded" as a headline — the run halted; the third never ran.

## Open, not decided here

The support specialist has a reproducible-looking defect on the credit route
under a longer queue. Fixing it means a new Level 1 comparison for that role,
which is separate work under a separate approval. Re-running V3 unchanged would
cost roughly another $0.08 and would most likely reproduce the same halt.
