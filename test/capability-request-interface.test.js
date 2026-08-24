import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCapabilityRequest,
  createCapabilityRequest,
  createCapabilityResponse,
  stubCapabilityResolver,
} from "../src/fleet/capability-request-interface.js";

function request(overrides = {}) {
  return createCapabilityRequest({
    requestId: "cap-req-1",
    companyId: "fictional-onboarding-company",
    workItem: { workloadId: "invoice-batch", outcome: "Issue the first invoice" },
    target: { system: "billing-local", operation: "known-invoice-export" },
    requiredEffect: "An exported invoice document exists for each provisioned account",
    authority: { allowedActions: ["draft-invoice"], spendCeilingUsd: 0.5, riskCeiling: "low" },
    ...overrides,
  });
}

test("a capability request seals with an explicit authority ceiling and verifies", () => {
  const sealed = request();
  assert.equal(assertCapabilityRequest(sealed), true);
  assert.throws(() => createCapabilityRequest({ requestId: "x", companyId: "y", workItem: { workloadId: "w", outcome: "o" }, target: { system: "s", operation: "op" }, requiredEffect: "e", authority: { allowedActions: [], spendCeilingUsd: 1, riskCeiling: "low" } }), /explicit authority ceiling/);
});

test("a capability bundle may never exceed the request's authority ceiling", () => {
  const sealed = request();
  assert.throws(
    () => createCapabilityResponse({ request: sealed, kind: "capability-bundle", detail: { actions: ["draft-invoice", "transfer-funds"] } }),
    /exceeds the request's authority ceiling: transfer-funds/,
  );
});

test("the stub resolver: known operations bundle, unknown resolve unresolved-safe, high-risk always hands off", () => {
  const bundle = stubCapabilityResolver(request());
  assert.equal(bundle.kind, "capability-bundle");
  const safe = stubCapabilityResolver(request({ target: { system: "billing-local", operation: "novel-quantum-export" } }));
  assert.equal(safe.kind, "unresolved-safe");
  assert.equal(safe.detail.externalEffects, 0);
  const handoff = stubCapabilityResolver(request({ authority: { allowedActions: ["draft-invoice"], spendCeilingUsd: 0.5, riskCeiling: "high" } }));
  assert.equal(handoff.kind, "exact-handoff");
  assert.equal(handoff.detail.staged, true);
});

test("every response binds to the exact request by hash", () => {
  const sealed = request();
  const response = stubCapabilityResolver(sealed);
  assert.equal(response.requestHash, sealed.requestHash);
  const tampered = structuredClone(sealed);
  tampered.authority.spendCeilingUsd = 9_999;
  assert.throws(() => stubCapabilityResolver(tampered), /integrity mismatch/);
});
