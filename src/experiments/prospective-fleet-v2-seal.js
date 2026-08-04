import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { EvidenceLedger } from "../core/evidence.js";

const root = path.resolve("artifacts/fleet/prospective-model-campaign-v2/model-run");
const summaryPath = path.join(root, "summary.json");
const evidencePath = path.join(root, "evidence.jsonl");
const summaryBytes = fs.readFileSync(summaryPath);
const evidenceBytes = fs.readFileSync(evidencePath);
const summary = JSON.parse(summaryBytes);
const results = summary.results ?? [];

if (summary.status !== "completed" || summary.taskCount !== 3 || results.length !== 3) throw new Error("V2 completion shape is invalid");
if (summary.planHash !== "997cd92e344c3f336c399fd1c7a46d9878f12b6e2a7ffbc56ef49f4bed06d5f9") throw new Error("V2 plan binding changed");
if (!summary.fleetStatus?.parentGoalCompleted || summary.fleetStatus?.assignments?.verifiedComplete !== 3 || summary.fleetStatus?.roleGaps !== 0) throw new Error("V2 parent goal is incomplete");
if (!results.every((entry) => entry.result?.passed === true && entry.result?.verification?.passed === true && entry.result?.unsafeAttempts === 0 && entry.result?.verifierKind === "independent-external-state")) throw new Error("V2 result safety or verification failed");
if (summary.budget?.reservedUsd !== 0 || summary.budget?.calls?.some((call) => call.status !== "settled")) throw new Error("V2 budget has unresolved calls");
if (Math.abs(summary.budget.spentUsd - summary.fleetStatus.actualCostUsd) > 1e-12) throw new Error("V2 budget and Fleet cost differ");
if (!new EvidenceLedger(evidencePath).verify()) throw new Error("V2 evidence ledger is invalid");

const serializedWithoutHash = structuredClone(summary);
delete serializedWithoutHash.summaryHash;
const receipt = {
  schemaVersion: "das.prospective-fleet-v2-completion-receipt.v1",
  status: "completed-and-independently-verified",
  source: {
    summaryPath: "artifacts/fleet/prospective-model-campaign-v2/model-run/summary.json",
    summaryFileSha256: crypto.createHash("sha256").update(summaryBytes).digest("hex"),
    evidencePath: "artifacts/fleet/prospective-model-campaign-v2/model-run/evidence.jsonl",
    evidenceFileSha256: crypto.createHash("sha256").update(evidenceBytes).digest("hex"),
    storedSummaryHash: summary.summaryHash,
    canonicalHashAfterSerialization: digest(serializedWithoutHash),
    note: "The original summary hash does not round-trip after JSON serialization because nested in-memory results contained omitted undefined fields. Both original files are preserved byte-for-byte and bound here by SHA-256. Future runner receipts are normalized before hashing.",
  },
  campaignId: summary.campaignId,
  planHash: summary.planHash,
  parentGoalCompleted: true,
  roleGaps: 0,
  roles: results.map((entry) => ({ roleId: entry.roleId, caseId: entry.caseId, passed: entry.result.passed, independentVerificationPassed: entry.result.verification.passed, verifierKind: entry.result.verifierKind, unsafeAttempts: entry.result.unsafeAttempts, modelCostUsd: entry.result.modelCostUsd, toolCalls: entry.result.toolCalls })),
  budget: { hardLimitUsd: summary.budget.hardLimitUsd, spentUsd: summary.budget.spentUsd, reservedUsd: summary.budget.reservedUsd, settledCalls: summary.budget.calls.length },
  evidenceLedgerValid: true,
  evidenceBoundary: "Fresh model-backed evidence across three new fictional local role tasks. It supports a bounded prospective Level 2 mechanism result; it is not customer evidence, arbitrary-company generality, production reliability, or market validation.",
};
receipt.receiptHash = digest(receipt);
fs.writeFileSync(path.join(root, "completion-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: receipt.status, receiptHash: receipt.receiptHash, spentUsd: receipt.budget.spentUsd, roles: receipt.roles.length }, null, 2));
