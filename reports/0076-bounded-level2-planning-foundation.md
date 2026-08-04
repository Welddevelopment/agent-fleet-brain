# Bounded Level 2 planning foundation

Date: 2026-08-05

## Result

A first bounded fleet-planning layer now sits above Level 1 specialist records without merging their authority or evidence.

The planner accepts a broad company goal and trusted workload inventory, checks every proved specialist against the required system, tools, context, authority, policy, verifier, quality, unit cost and latency, compares four allocation strategies, respects capacity and cost limits, and recommends one plan. It can divide one homogeneous workload across multiple compatible specialists. Unsupported work remains unassigned and becomes a zero-authority Level 1 role-gap request rather than being sent to an attractive but incompatible general agent.

## Fictional rehearsal

- Broad goal: clear bounded support, procurement, CRM and finance work before deadlines under a $10 operating ceiling.
- Workload classes: 4.
- Proved specialist records: 4.
- Total volume: 115.
- Routed volume: 105.
- Support load split across two compatible specialists because one lacked capacity.
- Estimated routed cost: $7.25.
- Unsupported finance volume: 10, represented by one human-approved role proposal.
- Automatic execution, model spend, role creation and activation authorities: 0.
- Independent plan verification: passed.

## Failure controls

- Mutating a specialist's authority invalidates its fingerprint.
- Assigning support work to the procurement specialist fails independent compatibility verification.
- Widening automatic role-creation authority fails closed even with a newly calculated contract hash.
- A zero-dollar impossible fleet limit returns a blocked plan rather than silently exceeding budget.
- Unsafe or unproved specialists cannot enter planning.

## Validation

- New focused tests: 4/4.
- Full local suite: 218/218.
- Model calls: 0.
- New paid spend: $0.
- Artifacts: `artifacts/fleet/bounded-level2-planning-v1/`.

## Evidence boundary

This is deterministic planning over fictional trusted workload and specialist records. It does not execute the 105 routed units, prove general strategic decomposition, create a new finance specialist, demonstrate customer value or establish a full Level 2 result. The next meaningful step is an explicit, durable execution controller that accepts only independently verified specialist outcomes and cannot mark the parent goal complete while a role gap remains.

