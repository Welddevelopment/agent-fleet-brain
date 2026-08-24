import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { createBoundedSpecialistRecord } from "./bounded-level2-contract.js";

// The frozen comparison catalogue: competence constants, the agent roster, the
// deliberately stale static mapping, and eleven cases across eight regimes — each
// with a PREREGISTERED hypothesis, including the ones where the adaptive fleet is
// expected to LOSE or share a failure. Those are recorded as known gaps, not
// patched: giving the adaptive arm abilities it does not have would rig the
// comparison and falsify the roadmap's motivation.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export const COMPARISON_CONSTANTS = Object.freeze({
  unitConstantsBySystem: Object.freeze({
    "support-local": Object.freeze({ unitCostUsd: 0.05, unitLatencyMs: 800 }),
    "procurement-local": Object.freeze({ unitCostUsd: 0.06, unitLatencyMs: 900 }),
    "crm-local": Object.freeze({ unitCostUsd: 0.05, unitLatencyMs: 850 }),
    "ledger-local": Object.freeze({ unitCostUsd: 0.08, unitLatencyMs: 1200 }),
    "archive-local": Object.freeze({ unitCostUsd: 0.02, unitLatencyMs: 500 }),
  }),
  activationOverhead: Object.freeze({ costUsd: 0.02, latencyMs: 400 }),
  perAgentCapacityPerWindow: 200,
});

const SYSTEM_VERIFIER = (system) => `${system}-scope-verifier-v1`;
const SYSTEM_POLICY = (system) => `policy-${system}`;

function classRequirement(system, tools, actions) {
  return { systems: [system], tools, contextSources: [`${system}-context`], authorityActions: actions, verifierId: SYSTEM_VERIFIER(system), policyHash: SYSTEM_POLICY(system) };
}

export function createComparisonRoster() {
  const constants = COMPARISON_CONSTANTS;
  const proved = (id, roleId, system, tools, actions) => createBoundedSpecialistRecord({
    id, roleId, version: "1", status: "proved-active",
    capability: classRequirement(system, tools, actions),
    performance: {
      passRate: 1, outcomeScore: 1,
      meanUnitCostUsd: constants.unitConstantsBySystem[system].unitCostUsd,
      medianLatencyMs: constants.unitConstantsBySystem[system].unitLatencyMs,
      capacityPerWindow: constants.perAgentCapacityPerWindow,
      unsafeAttempts: 0,
    },
    evidence: { selectionHash: `comparison-selection-${id}`, verifierReceiptHash: `comparison-verifier-${id}` },
  });
  const specialists = [
    proved("support-efficient-1", "support-operations", "support-local", ["read-ticket", "draft-response"], ["draft-response"]),
    proved("support-quality-1", "support-operations", "support-local", ["read-ticket", "draft-response", "create-escalation"], ["draft-response", "create-escalation"]),
    proved("procurement-1", "procurement-coverage", "procurement-local", ["read-demand", "draft-order"], ["draft-order"]),
    proved("revops-1", "revenue-operations", "crm-local", ["read-lead", "assign-owner"], ["assign-owner"]),
    proved("archivist-1", "records-archiving", "archive-local", ["read-record", "file-record"], ["file-record"]),
  ];
  const generalAgent = {
    schemaVersion: "fleetbrain.comparison-general-agent.v1",
    id: "general-agent-1",
    description: "A strong single general agent holding every permitted tool and authority action across every system, including systems no specialist covers.",
    capability: {
      systems: Object.keys(constants.unitConstantsBySystem).sort(),
      tools: ["read-ticket", "draft-response", "create-escalation", "read-demand", "draft-order", "read-lead", "assign-owner", "read-record", "file-record", "read-ledger", "reconcile-entry"].sort(),
      authorityActions: ["draft-response", "create-escalation", "draft-order", "assign-owner", "file-record", "reconcile-entry"].sort(),
    },
    capacityPerWindow: constants.perAgentCapacityPerWindow,
  };
  generalAgent.agentHash = digest(generalAgent);
  const roster = {
    schemaVersion: "fleetbrain.comparison-roster.v1",
    specialists,
    generalAgent: Object.freeze(generalAgent),
    evidenceBoundary: "A fictional proved-specialist roster and a fictional strong general agent under exact competence parity: identical per-system unit constants and identical capacity for every agent in every arm.",
  };
  roster.rosterHash = digest(roster);
  return Object.freeze(roster);
}

export function assertCompetenceParity({ roster, constants }) {
  for (const specialist of roster.specialists) {
    const system = specialist.capability.systems[0];
    const table = constants.unitConstantsBySystem[system];
    requireCondition(table, `Specialist ${specialist.id} works a system with no unit constants: ${system}`);
    requireCondition(specialist.performance.meanUnitCostUsd === table.unitCostUsd && specialist.performance.medianLatencyMs === table.unitLatencyMs, `Specialist ${specialist.id} breaks competence parity: costs must be per-system, not per-agent`);
    requireCondition(specialist.performance.capacityPerWindow === constants.perAgentCapacityPerWindow, `Specialist ${specialist.id} breaks capacity parity`);
  }
  requireCondition(roster.generalAgent.capacityPerWindow === constants.perAgentCapacityPerWindow, "General agent breaks capacity parity");
  return true;
}

export function createComparisonStaticMapping() {
  const mapping = {
    schemaVersion: "fleetbrain.comparison-static-mapping.v1",
    description: "A frozen role-to-agent mapping designed once and never maintained — the definition of a static fleet. Its staleness is deliberate and documented per entry.",
    classAgent: {
      "support-tickets": "support-efficient-1",
      "support-queue-b": "support-quality-1",
      "support-escalations": "support-efficient-1",
      "support-escalations-approved": "support-quality-1",
      "support-surge": "support-efficient-1",
      "procurement-orders": "procurement-1",
      "crm-leads": "revops-1",
      "archive-filings": "archivist-1",
    },
    rationale: {
      "support-queue-b": "Stale load-balancing split: queue B was routed to the quality specialist when volumes were higher. Overlapping records now get written by two different agents (C1).",
      "support-escalations": "Stale authority assumption: escalations were once draftable by the efficient specialist; the authority moved and nobody updated the mapping (G2 denials).",
      "ledger-reconciliation": "ABSENT: the ledger class arrived after the mapping was designed. A static fleet cannot see work it was never told about (G1 false completion).",
    },
    evidenceBoundary: "The static baseline's mapping, sealed before any case runs. Classes absent from it are invisible to the static arm by construction.",
  };
  mapping.mappingHash = digest(mapping);
  return Object.freeze(mapping);
}

function workloadItem(id, className, system, tools, actions, volume, overrides = {}) {
  return {
    id,
    outcome: `Complete every ${className} item exactly once through its bounded write action`,
    source: `trusted-${system}-adapter`,
    volume,
    dueWithinMs: 60_000,
    maximumUnitCostUsd: 0.10,
    minimumOutcomeScore: 0.95,
    risk: "medium",
    requirement: classRequirement(system, tools, actions),
    ...overrides,
  };
}

const CLASS_SHAPES = {
  "support-tickets": ["support-local", ["read-ticket", "draft-response"], ["draft-response"]],
  "support-queue-b": ["support-local", ["read-ticket", "draft-response"], ["draft-response"]],
  "support-surge": ["support-local", ["read-ticket", "draft-response"], ["draft-response"]],
  "support-escalations": ["support-local", ["read-ticket", "create-escalation"], ["create-escalation"]],
  "support-escalations-approved": ["support-local", ["read-ticket", "create-escalation"], ["create-escalation"]],
  "procurement-orders": ["procurement-local", ["read-demand", "draft-order"], ["draft-order"]],
  "crm-leads": ["crm-local", ["read-lead", "assign-owner"], ["assign-owner"]],
  "archive-filings": ["archive-local", ["read-record", "file-record"], ["file-record"]],
  "ledger-reconciliation": ["ledger-local", ["read-ledger", "reconcile-entry"], ["reconcile-entry"]],
};

export function buildComparisonCase({ id, regime, title, narrative, classes, limits, priorities = { quality: 1, cost: 0.25, speed: 0.25 }, overlaps = {}, companyInvariants = null, declaredPolicies = null, declaredOverlapGroups = null, preregisteredExpectation }) {
  // classes: { className: [recordIds] } — record ids listed per class; overlapping
  // records appear in several classes' unit lists but once in sharedRecords.
  const workload = [];
  const workloadUnits = {};
  const recordOwners = new Map();
  for (const [className, recordIds] of Object.entries(classes)) {
    const [system, tools, actions] = CLASS_SHAPES[className];
    workload.push(workloadItem(className, className, system, tools, actions, recordIds.length));
    workloadUnits[className] = [...recordIds];
    for (const recordId of recordIds) {
      if (!recordOwners.has(recordId)) recordOwners.set(recordId, { system, requiredAction: actions[0], workloadIds: [] });
      const owner = recordOwners.get(recordId);
      requireCondition(owner.system === system && owner.requiredAction === actions[0], `Record ${recordId} is claimed with inconsistent system or action`);
      owner.workloadIds.push(className);
    }
  }
  const sharedRecords = [...recordOwners.entries()]
    .map(([recordId, owner]) => ({ recordId, system: owner.system, requiredAction: owner.requiredAction, workloadIds: owner.workloadIds.sort() }))
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
  const record = {
    schemaVersion: "fleetbrain.comparison-case.v1",
    id,
    regime,
    title,
    narrative,
    contractInput: {
      companyId: "fictional-comparison-company",
      goal: `Comparison case ${id}: ${title} — complete the whole declared workload exactly once within every stated bound.`,
      planningWindow: `comparison-${id}`,
      workload,
      priorities,
      limits,
    },
    workloadUnits,
    sharedRecords,
    ...(companyInvariants ? { companyInvariants } : {}),
    // Declared knowledge visible to EVERY arm equally; consulting it is a
    // coordination policy. declaredPolicies mirrors companyInvariants when the
    // company has written the cap down; declaredOverlapGroups mirrors overlap
    // structure the company knows about (its own mail rules).
    ...(declaredPolicies ? { declaredPolicies } : {}),
    ...(declaredOverlapGroups ? { declaredOverlapGroups } : {}),
    preregisteredExpectation,
    evidenceBoundary: "A sealed fictional comparison case. Volumes, overlaps and invariants are constructed; nothing here involves a model, a customer or a real system.",
  };
  for (const item of record.contractInput.workload) {
    requireCondition(item.volume === record.workloadUnits[item.id].length, `Case ${id}: workload ${item.id} volume disagrees with its unit list`);
  }
  requireCondition(Object.keys(overlaps).length === 0 || Object.entries(overlaps).every(([recordId, expected]) => recordOwners.get(recordId)?.workloadIds.length === expected), `Case ${id}: declared overlaps do not match the unit lists`);
  record.caseHash = digest(record);
  return Object.freeze(record);
}

function range(prefix, count, start = 1) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(start + index).padStart(3, "0")}`);
}

export function createComparisonCases() {
  const cases = [
    buildComparisonCase({
      id: "S1", regime: "small-simple", title: "Three items, three systems",
      narrative: "The smallest honest case: one support ticket, one purchase order, one lead. Coordination machinery is pure overhead here.",
      classes: { "support-tickets": ["s1-t-001"], "procurement-orders": ["s1-p-001"], "crm-leads": ["s1-c-001"] },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["costUsd", "unnecessaryAgents"],
        hypothesis: "The single general agent wins on cost: one activation against three working agents in every multi-agent arm. Every arm completes. Idle roster shows up as two unnecessary agents in each fleet arm and the shard.",
        clauses: [
          { id: "S1-g-cost-wins", arm: "general", metric: "costUsd", op: "ltAllOf", versusArms: ["sharded", "static", "adaptive"] },
          { id: "S1-g-complete", arm: "general", metric: "parentGoalCompleted", op: "true" },
          { id: "S1-h-complete", arm: "sharded", metric: "parentGoalCompleted", op: "true" },
          { id: "S1-s-complete", arm: "static", metric: "parentGoalCompleted", op: "true" },
          { id: "S1-a-complete", arm: "adaptive", metric: "parentGoalCompleted", op: "true" },
          { id: "S1-s-idle", arm: "static", metric: "unnecessaryAgents", op: "eq", value: 2 },
          { id: "S1-a-idle", arm: "adaptive", metric: "unnecessaryAgents", op: "eq", value: 2 },
          { id: "S1-h-idle", arm: "sharded", metric: "unnecessaryAgents", op: "eq", value: 2 },
        ],
      },
    }),
    buildComparisonCase({
      id: "S2", regime: "small-simple", title: "Six items, cost-weighted priorities",
      narrative: "Same shape at volume two with cost-weighted priorities — the regime where complexity must justify itself and cannot.",
      classes: { "support-tickets": range("s2-t", 2), "procurement-orders": range("s2-p", 2), "crm-leads": range("s2-c", 2) },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      priorities: { quality: 0.5, cost: 1, speed: 0.1 },
      preregisteredExpectation: {
        primaryMetrics: ["costUsd"],
        hypothesis: "Same shape as S1: the single general agent wins cost. At six units the round-robin shard activates five clones and pays the most overhead of anyone.",
        clauses: [
          { id: "S2-g-cost-wins", arm: "general", metric: "costUsd", op: "ltAllOf", versusArms: ["sharded", "static", "adaptive"] },
          { id: "S2-all-complete", arm: "sharded", metric: "parentGoalCompleted", op: "true" },
        ],
      },
    }),
    buildComparisonCase({
      id: "P1", regime: "parallel-latency", title: "Four even 30-unit lanes",
      narrative: "One hundred and twenty units across four systems. A single agent does them one after another; a fleet works the systems at once.",
      classes: { "support-tickets": range("p1-t", 30), "procurement-orders": range("p1-p", 30), "crm-leads": range("p1-c", 30), "archive-filings": range("p1-a", 30) },
      limits: { maximumTotalCostUsd: 15, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["latencyProxyMs", "parentGoalCompleted"],
        hypothesis: "Parallelism is headcount, not intelligence: the round-robin shard beats EVERY other arm on latency, including both fleets, because its partition is more even than one-agent-per-system lanes. The fleets still beat the single agent. Every arm completes.",
        clauses: [
          { id: "P1-h-fastest", arm: "sharded", metric: "latencyProxyMs", op: "ltAllOf", versusArms: ["general", "static", "adaptive"] },
          { id: "P1-s-beats-g", arm: "static", metric: "latencyProxyMs", op: "ltAllOf", versusArms: ["general"] },
          { id: "P1-a-beats-g", arm: "adaptive", metric: "latencyProxyMs", op: "ltAllOf", versusArms: ["general"] },
          { id: "P1-all-complete", arm: "sharded", metric: "parentGoalCompleted", op: "true" },
          { id: "P1-g-complete", arm: "general", metric: "parentGoalCompleted", op: "true" },
        ],
      },
    }),
    buildComparisonCase({
      id: "P2", regime: "parallel-latency", title: "Uneven lanes 60/20/10/30",
      narrative: "Uneven lanes exercise the max-lane arithmetic: the fleet's latency is its busiest lane, not its average.",
      classes: { "support-tickets": range("p2-t", 60), "procurement-orders": range("p2-p", 20), "crm-leads": range("p2-c", 10), "archive-filings": range("p2-a", 30) },
      limits: { maximumTotalCostUsd: 15, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["latencyProxyMs"],
        hypothesis: "Uneven lanes hurt the fleets (their latency is the busiest system lane) but not the shard (its partition ignores systems). Shard fastest again; fleets still beat the single agent.",
        clauses: [
          { id: "P2-h-fastest", arm: "sharded", metric: "latencyProxyMs", op: "ltAllOf", versusArms: ["general", "static", "adaptive"] },
          { id: "P2-s-beats-g", arm: "static", metric: "latencyProxyMs", op: "ltAllOf", versusArms: ["general"] },
          { id: "P2-a-beats-g", arm: "adaptive", metric: "latencyProxyMs", op: "ltAllOf", versusArms: ["general"] },
        ],
      },
    }),
    buildComparisonCase({
      id: "C1", regime: "shared-record-conflict", title: "Overlapping support queues, capacity to consolidate",
      narrative: "Queue B overlaps three ticket records. The static mapping splits the queues across two agents; the planner can consolidate both onto one.",
      classes: {
        "support-tickets": ["c1-a-001", "c1-a-002", "c1-a-003", "c1-a-004", "c1-a-005", "c1-a-006"],
        "support-queue-b": ["c1-b-001", "c1-b-002", "c1-b-003", "c1-a-004", "c1-a-005", "c1-a-006"],
        "procurement-orders": ["c1-p-001"],
        "crm-leads": ["c1-c-001"],
      },
      overlaps: { "c1-a-004": 2, "c1-a-005": 2, "c1-a-006": 2 },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["duplicatesConflicts", "falseCompletion"],
        hypothesis: "THE COORDINATION CASE. Overlapping queues: the static split double-writes 3 records; the round-robin shard ALSO double-writes 3 (different clones catch the two copies) and — because every clone-scoped receipt passes — claims completion falsely. The adaptive planner lands both queues on one specialist (a capacity-permitting consolidation via deterministic tie-break, not conflict detection — see C2) and its idempotent replays produce 0. The single agent replays its own keys: 0 duplicates by construction, since duplicates require two writers.",
        clauses: [
          { id: "C1-a-clean", arm: "adaptive", metric: "duplicatesConflicts", op: "eq", value: 0 },
          { id: "C1-g-clean", arm: "general", metric: "duplicatesConflicts", op: "eq", value: 0 },
          { id: "C1-s-dup", arm: "static", metric: "duplicatesConflicts", op: "eq", value: 3 },
          { id: "C1-h-dup", arm: "sharded", metric: "duplicatesConflicts", op: "eq", value: 3 },
          { id: "C1-h-false", arm: "sharded", metric: "falseCompletion", op: "true" },
          { id: "C1-s-honest", arm: "static", metric: "falseCompletion", op: "false" },
          { id: "C1-a-complete", arm: "adaptive", metric: "parentGoalCompleted", op: "true" },
        ],
      },
    }),
    buildComparisonCase({
      id: "C2", regime: "shared-record-conflict", title: "Overlap across a forced capacity split — a known adaptive gap",
      narrative: "At volume 220 the planner MUST split queue B across both support specialists, and the overlap lands in the second partition. Consolidation was C1's win; conflict DETECTION does not exist in the adaptive arm, and this case proves it.",
      classes: {
        "support-tickets": range("c2-t", 180),
        "support-queue-b": [...range("c2-q", 30), ...range("c2-t", 10, 171)],
        "procurement-orders": ["c2-p-001"],
        "crm-leads": ["c2-c-001"],
      },
      limits: { maximumTotalCostUsd: 25, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["duplicatesConflicts"],
        hypothesis: "KNOWN GAP, preregistered as an expected adaptive loss: the capacity split places the ten overlap records with the second specialist, producing ten duplicates — the same failure as the static arm. Only the single agent is structurally clean. The shard's count is an ordering artifact of volumes mod clone-count and is deliberately NOT preregistered — it is reported as observed, as evidence that these counts are properties of orderings, not policies (the adversarial review's FB-C-009).",
        clauses: [
          { id: "C2-a-dup", arm: "adaptive", metric: "duplicatesConflicts", op: "eq", value: 10 },
          { id: "C2-s-dup", arm: "static", metric: "duplicatesConflicts", op: "eq", value: 10 },
          { id: "C2-g-clean", arm: "general", metric: "duplicatesConflicts", op: "eq", value: 0 },
        ],
        knownGapDocumented: "adaptive-detects-conflicts-late-via-scope-ownership-and-cannot-prevent-them",
      },
    }),
    buildComparisonCase({
      id: "G1", regime: "role-gap", title: "Ledger work no specialist covers",
      narrative: "Four ledger reconciliations arrive and no proved specialist works that system. The honest fleet refuses; the general agent has the tools and simply wins; the static fleet cannot even see the work.",
      classes: { "support-tickets": range("g1-t", 5), "crm-leads": range("g1-c", 5), "ledger-reconciliation": range("g1-l", 4) },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["parentGoalCompleted", "falseCompletion", "interventions"],
        hypothesis: "THE PREREGISTERED FLEET-LOSES CASE: both general arms hold ledger authority and complete 14/14. The adaptive fleet completes 10/14 with one explicit role-gap intervention, zero incorrect effects and an honest incomplete claim. The static fleet claims completion it did not achieve — the ledger class is invisible to its mapping.",
        clauses: [
          { id: "G1-g-wins", arm: "general", metric: "parentGoalCompleted", op: "true" },
          { id: "G1-h-wins", arm: "sharded", metric: "parentGoalCompleted", op: "true" },
          { id: "G1-a-incomplete", arm: "adaptive", metric: "parentGoalCompleted", op: "false" },
          { id: "G1-a-honest", arm: "adaptive", metric: "falseCompletion", op: "false" },
          { id: "G1-a-intervened", arm: "adaptive", metric: "interventions", op: "gte", value: 1 },
          { id: "G1-s-false", arm: "static", metric: "falseCompletion", op: "true" },
        ],
      },
    }),
    buildComparisonCase({
      id: "G2", regime: "stale-authority", title: "Escalations routed to an agent without the authority",
      narrative: "The static mapping still sends escalations to the efficient specialist, which lost that authority. Denials are counted where they happen.",
      classes: { "support-escalations": range("g2-e", 4), "support-tickets": range("g2-t", 4), "procurement-orders": range("g2-p", 2) },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["authorityViolations"],
        hypothesis: "The static arm walks into four authority denials. The adaptive compatibility check routes escalations to the holder of the authority — zero. Both general arms hold every permitted authority — zero. What this measures: a maintained authority table against an unmaintained one.",
        clauses: [
          { id: "G2-s-denied", arm: "static", metric: "authorityViolations", op: "eq", value: 4 },
          { id: "G2-a-clean", arm: "adaptive", metric: "authorityViolations", op: "eq", value: 0 },
          { id: "G2-g-clean", arm: "general", metric: "authorityViolations", op: "eq", value: 0 },
          { id: "G2-h-clean", arm: "sharded", metric: "authorityViolations", op: "eq", value: 0 },
        ],
      },
    }),
    buildComparisonCase({
      id: "K1", regime: "capacity-limit", title: "A 300-unit surge against 200-unit agents",
      narrative: "More work than any single agent's window. Completing it requires noticing the capacity wall and splitting across agents.",
      classes: { "support-surge": range("k1-s", 300), "procurement-orders": range("k1-p", 5), "crm-leads": range("k1-c", 5) },
      limits: { maximumTotalCostUsd: 25, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["parentGoalCompleted"],
        hypothesis: "Capacity splitting is also headcount, not intelligence: the adaptive planner splits the surge 200/100 and completes — and so does the round-robin shard, faster, with no planner at all. The single agent stops at its 200-unit window; the static arm's single mapped support agent stops at 200 (its arm finishes 210 of 310 including the small classes).",
        clauses: [
          { id: "K1-a-complete", arm: "adaptive", metric: "parentGoalCompleted", op: "true" },
          { id: "K1-h-complete", arm: "sharded", metric: "parentGoalCompleted", op: "true" },
          { id: "K1-g-stops", arm: "general", metric: "parentGoalCompleted", op: "false" },
          { id: "K1-s-stops", arm: "static", metric: "parentGoalCompleted", op: "false" },
        ],
      },
    }),
    buildComparisonCase({
      id: "A1", regime: "aggregate-budget", title: "Individually cheap, collectively over budget",
      narrative: "Every unit is well under its own cost cap; together they cost 6.4 against a hard 5-dollar limit. Only aggregate accounting can see it coming.",
      classes: { "support-tickets": range("a1-t", 40), "procurement-orders": range("a1-p", 40), "crm-leads": range("a1-c", 40) },
      limits: { maximumTotalCostUsd: 5, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["incorrectEffects", "costUsd", "interventions"],
        hypothesis: "Aggregate budget accounting is one summation, and every arm given it refuses identically at zero dollars — the planner via its variant accounting, both general arms via the same pre-check (v1 withheld it from them; the adversarial review called that a hand-installed competence gap and it was). Only the static arm, which has no aggregate accounting anywhere, spends 6.40 in fictional cost units against the 5.00 limit, breaches it, and claims completion.",
        clauses: [
          { id: "A1-a-refuses", arm: "adaptive", metric: "costUsd", op: "eq", value: 0 },
          { id: "A1-g-refuses", arm: "general", metric: "costUsd", op: "eq", value: 0 },
          { id: "A1-h-refuses", arm: "sharded", metric: "costUsd", op: "eq", value: 0 },
          { id: "A1-a-intervened", arm: "adaptive", metric: "interventions", op: "gte", value: 1 },
          { id: "A1-g-intervened", arm: "general", metric: "interventions", op: "gte", value: 1 },
          { id: "A1-s-breaches", arm: "static", metric: "incorrectEffects", op: "gte", value: 1 },
          { id: "A1-s-false", arm: "static", metric: "falseCompletion", op: "true" },
        ],
      },
    }),
    buildComparisonCase({
      id: "A2", regime: "aggregate-invariant", title: "A company cap no arm was shown",
      narrative: "Eight approved escalations against a company-wide cap of five that lives outside every arm's view. Everyone does their assigned work correctly; the company still ends up somewhere it forbade.",
      classes: { "support-escalations-approved": range("a2-e", 8), "support-tickets": range("a2-t", 5), "crm-leads": range("a2-c", 3) },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      companyInvariants: { maxEscalationsPerWindow: 5 },
      preregisteredExpectation: {
        primaryMetrics: ["falseCompletion", "incorrectEffects"],
        hypothesis: "KNOWN SHARED GAP, preregistered: all FOUR arms complete their units cleanly, all four claim success, and the parent verifier alone catches the violated escalation cap — four false completions. No coordination policy in this harness prevents shared-invariant violations. The medium-term conflict controls exist because of this.",
        clauses: [
          { id: "A2-g-false", arm: "general", metric: "falseCompletion", op: "true" },
          { id: "A2-h-false", arm: "sharded", metric: "falseCompletion", op: "true" },
          { id: "A2-s-false", arm: "static", metric: "falseCompletion", op: "true" },
          { id: "A2-a-false", arm: "adaptive", metric: "falseCompletion", op: "true" },
        ],
      },
    }),
  ];
  requireCondition(cases.length === 11, "The catalogue must hold exactly eleven cases");
  return Object.freeze(cases);
}
