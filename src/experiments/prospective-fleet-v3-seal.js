import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { EvidenceLedger } from "../core/evidence.js";
import { PROSPECTIVE_FLEET_V3_CAMPAIGN } from "../fleet/prospective-fleet-v3.js";
import { PROSPECTIVE_FLEET_V3_ITEM_COUNTS } from "../fleet/prospective-fleet-v3-cases.js";

// Independent re-check of a finished V3 run. It re-reads what the runner wrote
// and re-derives every load-bearing property rather than trusting the summary's
// own status field. It refuses to seal anything that is not a clean completion.

const root = path.resolve(PROSPECTIVE_FLEET_V3_CAMPAIGN.artifactRoot, "model-run");
const planPath = path.resolve(PROSPECTIVE_FLEET_V3_CAMPAIGN.artifactRoot, "plan.json");
const summaryPath = path.join(root, "summary.json");
const evidencePath = path.join(root, "evidence.jsonl");

const summaryBytes = fs.readFileSync(summaryPath);
const evidenceBytes = fs.readFileSync(evidencePath);
const summary = JSON.parse(summaryBytes);
const frozenPlan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const results = summary.results ?? [];
const expectedTaskCount = Object.keys(PROSPECTIVE_FLEET_V3_ITEM_COUNTS).length;

if (summary.status !== "completed" || summary.taskCount !== expectedTaskCount || results.length !== expectedTaskCount) throw new Error("V3 completion shape is invalid");
if (summary.campaignId !== PROSPECTIVE_FLEET_V3_CAMPAIGN.campaignId) throw new Error(`V3 seal read a different campaign: ${summary.campaignId}`);
if (summary.planHash !== frozenPlan.planHash) throw new Error("V3 result is not bound to the frozen preflight plan");
if (!summary.fleetStatus?.parentGoalCompleted || summary.fleetStatus?.assignments?.verifiedComplete !== expectedTaskCount || summary.fleetStatus?.roleGaps !== 0) throw new Error("V3 parent goal is incomplete");
if (!results.every((entry) => entry.result?.passed === true && entry.result?.verification?.passed === true && entry.result?.unsafeAttempts === 0 && entry.result?.verifierKind === "independent-external-state")) throw new Error("V3 result safety or verification failed");
if (summary.budget?.reservedUsd !== 0 || summary.budget?.calls?.some((call) => call.status !== "settled")) throw new Error("V3 budget has unresolved calls");
if (Math.abs(summary.budget.spentUsd - summary.fleetStatus.actualCostUsd) > 1e-12) throw new Error("V3 budget and Fleet cost differ");
if (summary.budget.spentUsd > frozenPlan.hardSpendLimitUsd) throw new Error("V3 spend exceeded the frozen fleet ceiling");
if (!new EvidenceLedger(evidencePath).verify()) throw new Error("V3 evidence ledger is invalid");

// The runner normalizes its summary before hashing, so unlike V2 this should
// round-trip. Check rather than assume, and record both either way.
const serializedWithoutHash = structuredClone(summary);
delete serializedWithoutHash.summaryHash;
const canonicalAfterSerialization = digest(serializedWithoutHash);

const receipt = {
  schemaVersion: "das.prospective-fleet-v3-completion-receipt.v1",
  status: "completed-and-independently-verified",
  source: {
    summaryPath: path.join(PROSPECTIVE_FLEET_V3_CAMPAIGN.artifactRoot, "model-run", "summary.json"),
    summaryFileSha256: crypto.createHash("sha256").update(summaryBytes).digest("hex"),
    evidencePath: path.join(PROSPECTIVE_FLEET_V3_CAMPAIGN.artifactRoot, "model-run", "evidence.jsonl"),
    evidenceFileSha256: crypto.createHash("sha256").update(evidenceBytes).digest("hex"),
    storedSummaryHash: summary.summaryHash,
    canonicalHashAfterSerialization: canonicalAfterSerialization,
    summaryHashRoundTripped: canonicalAfterSerialization === summary.summaryHash,
  },
  campaignId: summary.campaignId,
  planHash: summary.planHash,
  parentGoalCompleted: true,
  roleGaps: 0,
  subItemsByRole: PROSPECTIVE_FLEET_V3_ITEM_COUNTS,
  subItemCount: Object.values(PROSPECTIVE_FLEET_V3_ITEM_COUNTS).reduce((sum, value) => sum + value, 0),
  roles: results.map((entry) => ({ roleId: entry.roleId, caseId: entry.caseId, passed: entry.result.passed, independentVerificationPassed: entry.result.verification.passed, verifierKind: entry.result.verifierKind, unsafeAttempts: entry.result.unsafeAttempts, modelCostUsd: entry.result.modelCostUsd, toolCalls: entry.result.toolCalls })),
  budget: { hardLimitUsd: summary.budget.hardLimitUsd, spentUsd: summary.budget.spentUsd, reservedUsd: summary.budget.reservedUsd, settledCalls: summary.budget.calls.length },
  evidenceLedgerValid: true,
  evidenceBoundary: "Fresh model-backed evidence across three fictional local role tasks carrying 22 sub-items. It supports a bounded prospective Level 2 mechanism result at a larger size than V2. It is not customer evidence, arbitrary-company generality, production reliability, or market validation, and it must never be added to or merged with the deterministic 115/115 fleet chain, which made zero model calls.",
};
receipt.receiptHash = digest(receipt);
fs.writeFileSync(path.join(root, "completion-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: receipt.status, receiptHash: receipt.receiptHash, spentUsd: receipt.budget.spentUsd, roles: receipt.roles.length, subItems: receipt.subItemCount }, null, 2));
