# 0080 — Bounded Level 2 generality matrix

Date: 2026-08-05  
Evidence class: zero-cost deterministic structural generality  
Paid model calls: 0  
New paid spend: $0

## Purpose

The first complete Level 2 loop used one fictional company shape. This checkpoint asks whether the same planner and independent verifier can handle materially different operating conditions without role-specific planner rewrites or unsafe fallback behavior.

## Five profiles

1. **Expanded standard day:** five proved specialist records cover 115/115 items. The plan is fully routable but still grants no execution authority.
2. **Support surge:** workload composition changes to 80 support, ten procurement, five CRM and five finance items. The same planner splits support capacity and covers 100/100 under the bounded ceiling.
3. **Compressed deadline:** the faster deadline excludes the slower support specialist. The plan routes 75/115 and exposes two exact gaps—support capacity and finance—rather than weakening latency or sending work to an incompatible agent.
4. **Role-proposal limit:** the owner permits only one proposed role while the plan needs two. The planner refuses the entire plan and reports `new-role-proposal-limit`.
5. **Hard budget limit:** the owner sets a zero-spend ceiling. Every variant exceeds it, so the planner refuses execution and reports `hard-cost-limit`.

## Correct refusal is now verifiable

Before this checkpoint, the planner could return `blocked-by-bounded-limits`, but the independent plan verifier expected a selected allocation and therefore could not certify a correct refusal. The verifier now has a separate fail-closed blocked-state path. It requires:

- no selected plan or selected-variant identity;
- every preserved alternative to violate at least one declared hard bound;
- the exact blocker class rather than a convenient substitute;
- the exact proved-specialist identity set; and
- zero execution, spend, role-creation or activation authority.

A mutated refusal that labels a budget block as a role-proposal block is rejected.

## Result

- Five materially different fictional planning profiles passed their precommitted expectations.
- Full, partial and correctly blocked branches were all independently verified.
- Hard budget and role-proposal limits were both exercised.
- No profile silently granted execution authority.
- Full local suite: **227/227 passing**.

## Evidence boundary

This strengthens structural generality of the bounded planning mechanism. It does not show model-agent performance, arbitrary company understanding, optimal real-world strategy, customer value or production scheduling. Only the original four-stream return scenario has joined disposable execution evidence; the additional profiles are planning and independent-plan-verification tests.

Artifacts: `artifacts/fleet/bounded-level2-generality-v1/`
