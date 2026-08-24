import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";

// The CF capability-request interface — ONE-SIDED, BY DESIGN.
//
// The canonical roadmap's rule: "Define the CF capability-request interface and
// test it separately before joining." This module is that definition, and nothing
// more: the typed request a fleet would submit when a specialist lacks an ABILITY
// (not a role — roles go to DAS), the three typed responses CF could return, and a
// stub resolver for contract tests. It does not import, call, or know anything
// about the Capability Factory codebase. Cross-repository integration is a
// separately gated decision (hub: cross-repository-integration NOT authorized),
// and this file is written so that joining later changes which RESOLVER runs, not
// what either side says.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export function createCapabilityRequest(input) {
  const record = {
    schemaVersion: "fleetbrain.capability-request.v1",
    requestId: String(input?.requestId ?? "").trim(),
    companyId: String(input?.companyId ?? "").trim(),
    workItem: {
      workloadId: String(input?.workItem?.workloadId ?? "").trim(),
      outcome: String(input?.workItem?.outcome ?? "").trim(),
    },
    target: {
      system: String(input?.target?.system ?? "").trim(),
      operation: String(input?.target?.operation ?? "").trim(),
    },
    requiredEffect: String(input?.requiredEffect ?? "").trim(),
    observations: (input?.observations ?? []).map((item) => String(item)),
    authority: {
      allowedActions: [...new Set((input?.authority?.allowedActions ?? []).map((item) => String(item).trim()).filter(Boolean))].sort(),
      spendCeilingUsd: Number(input?.authority?.spendCeilingUsd ?? 0),
      riskCeiling: String(input?.authority?.riskCeiling ?? "low"),
    },
    evidenceBoundary: "A typed capability request a fleet would hand to Capability Factory. It grants nothing; the stated authority is a CEILING the resolver may never exceed, not a delegation.",
  };
  requireCondition(record.requestId && record.companyId && record.workItem.workloadId && record.workItem.outcome, "A capability request needs an id, company and exact work item");
  requireCondition(record.target.system && record.target.operation && record.requiredEffect, "A capability request needs the exact target and required effect");
  requireCondition(record.authority.allowedActions.length > 0 && Number.isFinite(record.authority.spendCeilingUsd) && record.authority.spendCeilingUsd >= 0, "A capability request needs an explicit authority ceiling");
  requireCondition(["low", "medium", "high"].includes(record.authority.riskCeiling), "Risk ceiling must be low, medium or high");
  record.requestHash = digest(record);
  return Object.freeze(record);
}

export function assertCapabilityRequest(request) {
  requireCondition(request?.schemaVersion === "fleetbrain.capability-request.v1", "Unsupported capability request");
  requireCondition(request.requestHash && digest(withoutHash(request, "requestHash")) === request.requestHash, "Capability request integrity mismatch");
  return true;
}

const RESPONSE_KINDS = new Set(["capability-bundle", "unresolved-safe", "exact-handoff"]);

export function createCapabilityResponse({ request, kind, detail = {} }) {
  assertCapabilityRequest(request);
  requireCondition(RESPONSE_KINDS.has(kind), `Unsupported capability response kind: ${kind}`);
  const record = {
    schemaVersion: "fleetbrain.capability-response.v1",
    requestHash: request.requestHash,
    kind,
    // capability-bundle: a retained/new capability whose declared actions must sit
    //   inside the request's authority ceiling.
    // unresolved-safe: CF could not resolve it and made no external effect.
    // exact-handoff: the precise human step that remains, with everything staged.
    detail: structuredClone(detail),
    evidenceBoundary: "A typed Capability Factory response shape. In this repository it is only ever produced by the stub resolver; a real CF response requires the separately gated cross-repository decision.",
  };
  if (kind === "capability-bundle") {
    const actions = record.detail.actions ?? [];
    const ceiling = new Set(request.authority.allowedActions);
    const outside = actions.filter((action) => !ceiling.has(action));
    requireCondition(outside.length === 0, `Capability bundle exceeds the request's authority ceiling: ${outside.sort().join(", ")}`);
  }
  record.responseHash = digest(record);
  return Object.freeze(record);
}

// The stub resolver: deterministic, deliberately dumb, and honest about it. It
// exists so the fleet side of the contract is exercisable end to end today.
export function stubCapabilityResolver(request) {
  assertCapabilityRequest(request);
  if (request.authority.riskCeiling === "high") {
    return createCapabilityResponse({ request, kind: "exact-handoff", detail: { humanStep: `Perform ${request.target.operation} on ${request.target.system} manually`, staged: true, reason: "Stub policy: high-risk requests always hand off." } });
  }
  if (request.target.operation.startsWith("known-")) {
    return createCapabilityResponse({ request, kind: "capability-bundle", detail: { bundleId: `stub-bundle-${request.target.operation}`, actions: request.authority.allowedActions.slice(0, 1), retained: true } });
  }
  return createCapabilityResponse({ request, kind: "unresolved-safe", detail: { reason: "Stub policy: unknown operations resolve to unresolved-safe with zero external effects.", externalEffects: 0 } });
}
