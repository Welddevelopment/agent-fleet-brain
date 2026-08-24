import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { buildComparisonCase } from "./comparison-cases.js";

// Held-out exam compiler.
//
// The v2 campaign's honest caveat was self-authorship: the same session wrote the
// cases, the arms and the hypotheses. These cases close part of that gap: they
// were authored by a BLIND agent shown only an interface spec — never the arms,
// the hypotheses, the reports or any file in this repository (it made zero tool
// calls). This module compiles its specs VERBATIM into sealed case records:
// volumes, overlaps, caps and ceilings are the author's; the only additions are
// mechanical (record-id generation and the deterministic overlap substitution
// documented below). There are NO preregistered outcome hypotheses for these
// cases — that is the point of a held-out exam; results are reported as observed.
//
// Caveat, recorded here as everywhere: this is instruction-level blindness inside
// one project, not organizational independence. It is materially better than
// self-authored; it is not a third party.
//
// Overlap substitution rule (deterministic): for {between:[A,B], count:n},
// processed in spec order, the LAST n record ids of B's unit list are replaced by
// the LAST n record ids of A's current unit list. Chained overlaps therefore
// cascade — a record can end up in three queues, which the world handles by
// definition (one record, many workloadIds).

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function compileHeldOutCase(spec) {
  requireCondition(spec?.id && spec?.title && spec?.classes, "A held-out spec needs id, title and classes");
  const unitLists = {};
  for (const [className, volume] of Object.entries(spec.classes)) {
    requireCondition(Number.isInteger(volume) && volume > 0, `Class ${className} needs a positive integer volume`);
    unitLists[className] = Array.from({ length: volume }, (_, index) => `${spec.id.toLowerCase()}-${className}-${String(index + 1).padStart(3, "0")}`);
  }
  for (const overlap of spec.overlaps ?? []) {
    const [first, second] = overlap.between;
    requireCondition(unitLists[first] && unitLists[second], `Overlap names unknown classes: ${overlap.between.join(", ")}`);
    requireCondition(Number.isInteger(overlap.count) && overlap.count > 0 && overlap.count <= unitLists[first].length && overlap.count <= unitLists[second].length, `Overlap count out of range for ${overlap.between.join("+")}`);
    const shared = unitLists[first].slice(-overlap.count);
    unitLists[second] = [...unitLists[second].slice(0, unitLists[second].length - overlap.count), ...shared];
  }
  const declaredOverlapGroups = (spec.overlaps ?? []).map((overlap, index) => ({
    id: `declared-overlap-${index + 1}`,
    workloadIds: [...overlap.between].sort(),
    sharedRecordCount: overlap.count,
  }));
  return buildComparisonCase({
    id: spec.id,
    regime: "held-out",
    title: spec.title,
    narrative: `${spec.narrative} [Blind-authored held-out case; design intent: ${spec.designIntent}]`,
    classes: unitLists,
    limits: { maximumTotalCostUsd: spec.hardCostLimitUsd, maximumNewRoleProposals: 1 },
    ...(spec.companyInvariant ? { companyInvariants: structuredClone(spec.companyInvariant), declaredPolicies: structuredClone(spec.companyInvariant) } : {}),
    ...(declaredOverlapGroups.length ? { declaredOverlapGroups } : {}),
    preregisteredExpectation: {
      primaryMetrics: [],
      hypothesis: "HELD OUT — no outcome hypothesis exists for this case by design. The author was blind to the arms; results are reported as observed.",
      clauses: [],
    },
  });
}

export function sealHeldOutSpecs(specs) {
  requireCondition(Array.isArray(specs) && specs.length > 0, "Held-out sealing needs the author's specs");
  const record = {
    schemaVersion: "fleetbrain.heldout-exam.v1",
    authorship: "Authored by a blind subagent shown only the interface specification — no repository access, zero tool calls. Instruction-level blindness, not organizational independence.",
    specsVerbatim: structuredClone(specs),
    specDigest: digest(specs),
    caseHashes: specs.map((spec) => compileHeldOutCase(spec).caseHash),
    evidenceBoundary: "The blind author's specs, sealed verbatim, with the hashes of their mechanical compilation. Any edit to a spec after sealing is detectable.",
  };
  record.examHash = digest(record);
  return Object.freeze(record);
}
