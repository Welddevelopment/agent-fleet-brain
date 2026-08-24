import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { compileGoalWorkGraph, createDeclaredObjective } from "./goal-compiler.js";

// The trusted half of open-ended goal decomposition.
//
// The vision needs a model to look at a broad goal and PROPOSE how it breaks into
// work. The canonical doc's rule: "models may propose semantic decomposition, but
// trusted code must check." This module is that trusted code, built and tested
// BEFORE any model is attached: it takes a decomposition proposal as UNTRUSTED
// input — arbitrary JSON from anywhere — and either compiles it into a fully
// verified work graph through the standard goal-compiler checks (coverage both
// ways, acyclicity, no invented operations, constitutional authority) or refuses
// with the exact defect named. A malicious or hallucinated proposal cannot become
// work; at worst it becomes a well-labelled refusal receipt.
//
// The model slot is deliberately empty: attaching one is a PAID run behind the
// standard approval gate. Until then, proposals come from humans or fixtures, and
// every property a model proposal will need to satisfy is already enforced.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateDecompositionProposal({ proposal, companyId, adapters, snapshots, constitution = null }) {
  requireCondition(companyId && Array.isArray(adapters) && Array.isArray(snapshots), "Proposal validation needs the trusted company inputs");
  const rejection = (stage, reason) => Object.freeze({
    accepted: false,
    stage,
    reason,
    receipt: Object.freeze((() => {
      const record = {
        schemaVersion: "fleetbrain.decomposition-proposal-rejection.v1",
        companyId: String(companyId),
        stage,
        reason,
        proposalDigest: digest(proposal ?? null),
        evidenceBoundary: "An untrusted decomposition proposal was refused by trusted code. Nothing was planned or executed from it.",
      };
      record.receiptHash = digest(record);
      return record;
    })()),
  });

  // Stage 1 — shape: the proposal must LOOK like a declared objective. Untrusted
  // input gets no benefit of the doubt; unknown fields are rejected rather than
  // ignored, so nothing can smuggle instructions through unchecked properties.
  if (typeof proposal !== "object" || proposal === null) return rejection("shape", "Proposal is not an object");
  const allowedTop = new Set(["objectiveId", "kind", "statement", "outcomeClasses"]);
  const unknownTop = Object.keys(proposal).filter((key) => !allowedTop.has(key));
  if (unknownTop.length > 0) return rejection("shape", `Proposal carries unknown fields that would go unchecked: ${unknownTop.sort().join(", ")}`);
  if (!Array.isArray(proposal.outcomeClasses)) return rejection("shape", "Proposal has no outcome classes");
  const allowedClass = new Set(["id", "description", "selector", "required", "dependsOn"]);
  for (const [index, outcomeClass] of proposal.outcomeClasses.entries()) {
    if (typeof outcomeClass !== "object" || outcomeClass === null) return rejection("shape", `Outcome class ${index + 1} is not an object`);
    const unknown = Object.keys(outcomeClass).filter((key) => !allowedClass.has(key));
    if (unknown.length > 0) return rejection("shape", `Outcome class ${outcomeClass.id ?? index + 1} carries unknown fields: ${unknown.sort().join(", ")}`);
  }

  // Stage 2 — sealing: the proposal must survive the declared-objective
  // invariants (unique ids, unique selectors, declared dependencies, meaningful
  // statement). Failures name the defect.
  let objective;
  try {
    objective = createDeclaredObjective({
      companyId,
      objectiveId: proposal.objectiveId,
      kind: proposal.kind ?? "proposed-decomposition",
      statement: proposal.statement,
      outcomeClasses: proposal.outcomeClasses,
      declaredBy: "untrusted-proposal",
    });
  } catch (error) {
    return rejection("objective-invariants", error.message);
  }

  // Stage 3 — grounding: the full goal-compiler check against the trusted company
  // state. Coverage both directions, acyclic dependencies, every operation
  // adapter-declared, authority inside the constitution.
  let graph;
  try {
    graph = compileGoalWorkGraph({ objective, adapters, snapshots, constitution });
  } catch (error) {
    return rejection("grounding", error.message);
  }

  const acceptance = {
    schemaVersion: "fleetbrain.decomposition-proposal-acceptance.v1",
    companyId: String(companyId),
    proposalDigest: digest(proposal),
    objectiveHash: objective.objectiveHash,
    graphHash: graph.graphHash,
    constitutionHash: constitution ? constitution.constitutionHash : "",
    nodes: graph.nodes.length,
    workloadItems: graph.coverage.mappedItems,
    evidenceBoundary: "An untrusted decomposition proposal passed every trusted-code check and compiled into a verified work graph. Acceptance proves the proposal was well-grounded; it grants no execution authority and says nothing about who or what authored the proposal.",
  };
  acceptance.receiptHash = digest(acceptance);
  return Object.freeze({ accepted: true, objective, graph, receipt: Object.freeze(acceptance) });
}
