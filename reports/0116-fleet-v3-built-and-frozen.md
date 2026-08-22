# 0116 — Fleet V3 built and frozen (and a record correction)

**Date:** 2026-08-22. **Workstream:** fleet-brain. **Spend: $0.**

## Record correction, first

Every Fleet V3 file in this report was committed inside **8d3ba27**, whose message
reads *"0115: B3 first attempt stopped pre-engineering; attestation gate fired
correctly"*. That message describes six of the seventeen files in it. The other
eleven are Fleet V3 and are unrelated to B3.

Two chats were committing to this repo at the same time and one staged everything
in the working tree. Nothing was lost or corrupted, and the history is **not**
being rewritten to fix it — another session was working on `main` at the time, and
rewriting shared history to tidy a message is a worse risk than the untidy message.
This report is the correction. If you are looking for where V3 landed, it is
8d3ba27, not a commit named after it.

## What was built

PROP-0006, approved by Joel under APR-0003 on 2026-08-20. Its dependency,
PROP-0002 execution attestation, landed in e5a9401 earlier the same day, which
cleared the "must not run until attestation lands" constraint.

|  | V2 | V3 |
|---|---|---|
| Roles | 3 | 3 |
| Sealed sub-items | 9 | **22** (5 procurement / 8 support / 9 revops) |
| Role turn ceilings | 20 / 48 / 56 | 48 / 80 / 96 |
| Approval token | `JOEL_APPROVED_PROSPECTIVE_FLEET_V2` | `JOEL_APPROVED_PROSPECTIVE_FLEET_V3` |
| Plan hash | `997cd92e…` | `5c2688be…` |

Frozen plan: `artifacts/fleet/prospective-model-campaign-v3/plan.json`.
Run with `npm run level2:prospective:v3:run`. Seal with `…:v3:seal`.

## Two deviations from PROP-0006, both deliberate

**Three roles, not four.** PROP-0006 suggested four. The fleet plan can only bind
specialists admitted from the sealed Level 1 registry, and that registry holds
exactly three — procurement, support, revops. A fourth needs its own Level 1
selection, which is separate work under a separate approval. Joel was shown this
and chose the three-role scope on 2026-08-22. **The 20–30 sub-item target is met:
22.**

**The $5 ceiling is unreachable, and the real figure is exact, not a maximum.**
APR-0003 records $5. The fleet's hard spend limit is derived — the sum of the three
specialists' per-task ceilings, $1.30 — and the authorization arithmetic requires
the explicit limit to be *at least* the planned minimum and *at most* the frozen
ceiling. Both are $1.30, so **$1.30 is the only value that authorizes**. A test
asserts $5, $1.31, $1.29 and $0 are all refused.

## Evidence and non-regression

- Preflight passes all nine checks: each case is solved by its deterministic
  reference strategy and failed by its do-nothing control. Zero model calls.
- **V2's frozen plan hash is unchanged** at
  `997cd92e344c3f336c399fd1c7a46d9878f12b6e2a7ffbc56ef49f4bed06d5f9`. V2's
  committed plan artifact and completion receipt are bound to it, so the
  parameterization had to preserve it exactly. A regression test pins it.
- The deterministic 115/115 fleet chain is untouched; the console on 4392 still
  returns `original-broad-goal-completed`.
- Suite: **546/546**, from a 541/541 baseline taken before this work.

## Why V3 was built and not run

The paid gate requires `DAS_PROSPECTIVE_FLEET_PRICING_VERIFIED_ON=<today>`, which
asserts pricing was checked against the provider today. It was not. B3's own
protocol says the same of its carried-forward table
(`DAS004_B3_PRICING_INDEPENDENTLY_REVERIFIED = false`). Setting that variable
without checking is the erratum-0111a failure wearing a different hat, so the run
stops here until pricing is actually verified.

## Boundary — unchanged, and load-bearing

The 115/115 chain is **deterministic, zero model calls**. V3, if it runs, is a
separate bounded model-backed campaign. **The two numbers must never be merged or
added.** V3 is not customer evidence, not arbitrary-company generality, not
production reliability, and not market validation.
