import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { createBoundedSpecialistRecord } from "./bounded-level2-contract.js";

// The frozen comparison catalogue: competence constants, the agent roster, the
// deliberately stale static mapping, and eleven cases across seven regimes — each
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

function makeCase({ id, regime, title, narrative, classes, limits, priorities = { quality: 1, cost: 0.25, speed: 0.25 }, overlaps = {}, companyInvariants = null, preregisteredExpectation }) {
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
    makeCase({
      id: "S1", regime: "small-simple", title: "Three items, three systems",
      narrative: "The smallest honest case: one support ticket, one purchase order, one lead. Coordination machinery is pure overhead here.",
      classes: { "support-tickets": ["s1-t-001"], "procurement-orders": ["s1-p-001"], "crm-leads": ["s1-c-001"] },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["costUsd", "unnecessaryAgents"],
        hypothesis: "The general agent wins on cost (one activation vs three for adaptive, five for static). The static fleet shows exactly two unnecessary agents. All arms complete the parent goal. If latency still favors the fleets, that is recorded without excuse.",
        expectedOutcome: { generalWinsCost: true, staticUnnecessaryAgents: 2, allComplete: true },
      },
    }),
    makeCase({
      id: "S2", regime: "small-simple", title: "Six items, cost-weighted priorities",
      narrative: "Same shape at volume two with cost-weighted priorities — the regime where complexity must justify itself and cannot.",
      classes: { "support-tickets": range("s2-t", 2), "procurement-orders": range("s2-p", 2), "crm-leads": range("s2-c", 2) },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      priorities: { quality: 0.5, cost: 1, speed: 0.1 },
      preregisteredExpectation: {
        primaryMetrics: ["costUsd", "unnecessaryAgents"],
        hypothesis: "Same shape as S1: the general agent wins cost; the fleets pay activation overhead they cannot amortise at this size.",
        expectedOutcome: { generalWinsCost: true, staticUnnecessaryAgents: 2, allComplete: true },
      },
    }),
    makeCase({
      id: "P1", regime: "parallel-latency", title: "Four even 30-unit lanes",
      narrative: "One hundred and twenty units across four systems. A single agent does them one after another; a fleet works the systems at once.",
      classes: { "support-tickets": range("p1-t", 30), "procurement-orders": range("p1-p", 30), "crm-leads": range("p1-c", 30), "archive-filings": range("p1-a", 30) },
      limits: { maximumTotalCostUsd: 15, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["latencyProxyMs", "parentGoalCompleted"],
        hypothesis: "Both fleet arms beat the general agent by at least 3x on the latency proxy; every arm completes the parent goal.",
        expectedOutcome: { fleetLatencyAdvantageAtLeast: 3, allComplete: true },
      },
    }),
    makeCase({
      id: "P2", regime: "parallel-latency", title: "Uneven lanes 60/20/10/30",
      narrative: "Uneven lanes exercise the max-lane arithmetic: the fleet's latency is its busiest lane, not its average.",
      classes: { "support-tickets": range("p2-t", 60), "procurement-orders": range("p2-p", 20), "crm-leads": range("p2-c", 10), "archive-filings": range("p2-a", 30) },
      limits: { maximumTotalCostUsd: 15, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["latencyProxyMs", "parentGoalCompleted"],
        hypothesis: "The fleets win latency; the advantage is set by the busiest lane (support, 60 units), not the unit count.",
        expectedOutcome: { fleetsWinLatency: true, allComplete: true },
      },
    }),
    makeCase({
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
        hypothesis: "The static split writes the three overlap records twice (duplicates 3, false completion). The adaptive planner routes both queues to the same specialist, whose idempotent writes replay (0 duplicates). The general agent replays its own keys (0).",
        expectedOutcome: { staticDuplicates: 3, adaptiveDuplicates: 0, generalDuplicates: 0 },
      },
    }),
    makeCase({
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
        hypothesis: "KNOWN GAP, preregistered as an expected adaptive loss: the capacity split places the ten overlap records with the second specialist, producing ten duplicates — the same failure as the static arm. Only the general agent is clean. Adaptive's C1 result is consolidation, not conflict detection; the roadmap's conflict accounting exists because of this.",
        expectedOutcome: { adaptiveDuplicates: 10, staticDuplicates: 10, generalDuplicates: 0 },
        knownGapDocumented: "adaptive-lacks-cross-assignment-conflict-detection",
      },
    }),
    makeCase({
      id: "G1", regime: "role-gap", title: "Ledger work no specialist covers",
      narrative: "Four ledger reconciliations arrive and no proved specialist works that system. The honest fleet refuses; the general agent has the tools and simply wins; the static fleet cannot even see the work.",
      classes: { "support-tickets": range("g1-t", 5), "crm-leads": range("g1-c", 5), "ledger-reconciliation": range("g1-l", 4) },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["parentGoalCompleted", "falseCompletion", "interventions"],
        hypothesis: "THE PREREGISTERED FLEET-LOSES CASE: the general agent completes 14/14 and wins outright. The adaptive fleet completes 10/14 with one explicit role-gap intervention, zero incorrect effects and an honest incomplete claim. The static fleet claims completion it did not achieve — the ledger class is invisible to its mapping — and parent verification exposes the false completion.",
        expectedOutcome: { generalCompletes: true, adaptiveHonestIncomplete: true, staticFalseCompletion: true },
      },
    }),
    makeCase({
      id: "G2", regime: "stale-authority", title: "Escalations routed to an agent without the authority",
      narrative: "The static mapping still sends escalations to the efficient specialist, which lost that authority. Denials are counted where they happen.",
      classes: { "support-escalations": range("g2-e", 4), "support-tickets": range("g2-t", 4), "procurement-orders": range("g2-p", 2) },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["authorityViolations", "parentGoalCompleted"],
        hypothesis: "The static arm walks into four authority denials and honestly reports incomplete. The adaptive compatibility check routes escalations to the specialist that holds the authority — zero denials. The general agent holds every permitted authority — clean.",
        expectedOutcome: { staticAuthorityViolations: 4, adaptiveAuthorityViolations: 0, generalAuthorityViolations: 0 },
      },
    }),
    makeCase({
      id: "K1", regime: "capacity-limit", title: "A 300-unit surge against 200-unit agents",
      narrative: "More work than any single agent's window. Completing it requires noticing the capacity wall and splitting across agents.",
      classes: { "support-surge": range("k1-s", 300), "procurement-orders": range("k1-p", 5), "crm-leads": range("k1-c", 5) },
      limits: { maximumTotalCostUsd: 25, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["parentGoalCompleted", "unitsCompleted"],
        hypothesis: "Only the adaptive arm completes the parent goal, because only its planner splits the surge across both support specialists (200 + 100). The static arm's single mapped agent stops at 200. The general agent's own capacity stops it at 200 units in total.",
        expectedOutcome: { adaptiveCompletes: true, staticCompletes: false, generalCompletes: false },
      },
    }),
    makeCase({
      id: "A1", regime: "aggregate-budget", title: "Individually cheap, collectively over budget",
      narrative: "Every unit is well under its own cost cap; together they cost 6.4 against a hard 5-dollar limit. Only aggregate accounting can see it coming.",
      classes: { "support-tickets": range("a1-t", 40), "procurement-orders": range("a1-p", 40), "crm-leads": range("a1-c", 40) },
      limits: { maximumTotalCostUsd: 5, maximumNewRoleProposals: 1 },
      preregisteredExpectation: {
        primaryMetrics: ["incorrectEffects", "costUsd", "interventions"],
        hypothesis: "The adaptive planner's aggregate accounting blocks every variant before any spend: an explicit hard-cost-limit refusal at zero dollars. The general agent honors the explicit ceiling and halts partway with an honest incomplete claim. The static arm has no aggregate accounting at all: it spends 6.4, breaches the limit, and claims completion — an incorrect effect plus a false completion that only parent verification catches.",
        expectedOutcome: { adaptiveRefusesAtZeroSpend: true, generalHaltsAtCeiling: true, staticBreachesAndFalseCompletes: true },
      },
    }),
    makeCase({
      id: "A2", regime: "aggregate-invariant", title: "A company cap no arm was shown",
      narrative: "Eight approved escalations against a company-wide cap of five that lives outside every arm's view. Everyone does their assigned work correctly; the company still ends up somewhere it forbade.",
      classes: { "support-escalations-approved": range("a2-e", 8), "support-tickets": range("a2-t", 5), "crm-leads": range("a2-c", 3) },
      limits: { maximumTotalCostUsd: 10, maximumNewRoleProposals: 1 },
      companyInvariants: { maxEscalationsPerWindow: 5 },
      preregisteredExpectation: {
        primaryMetrics: ["falseCompletion", "incorrectEffects"],
        hypothesis: "KNOWN SHARED GAP, preregistered: all three arms complete their units cleanly and all three claim success; the parent verifier alone catches the violated escalation cap, so all three false-complete. No current arm — including the adaptive fleet — prevents shared-invariant violations. The medium-term conflict controls exist because of this.",
        expectedOutcome: { allThreeFalseComplete: true },
        knownGapDocumented: "no-arm-enforces-company-invariants",
      },
    }),
  ];
  requireCondition(cases.length === 11, "The catalogue must hold exactly eleven cases");
  return Object.freeze(cases);
}
