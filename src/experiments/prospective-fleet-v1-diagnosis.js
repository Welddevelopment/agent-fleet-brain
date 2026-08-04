import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";

const repositoryRoot = path.resolve(".");
const sourceRelativePath = "artifacts/fleet/prospective-model-campaign-v1/model-run/latest-failure.json";
const outputRelativePath = "artifacts/fleet/prospective-model-campaign-v1/diagnosis.json";
const sourceBytes = fs.readFileSync(path.join(repositoryRoot, sourceRelativePath));
const failure = JSON.parse(sourceBytes);
const revops = failure.results.find((item) => item.roleId === "realistic-revenue-operations-specialist")?.result;

if (failure.status !== "failed" || failure.verifiedCompleteTasks !== 2 || failure.attemptedTasks !== 3) throw new Error("Unexpected V1 campaign shape");
if (failure.fleetStatus?.parentGoalCompleted !== false || failure.evidenceLedgerValid !== true) throw new Error("Unexpected V1 safety/evidence state");
if (revops?.reason !== "turn-limit-reached" || revops.toolCalls !== 24 || revops.unsafeAttempts !== 0 || revops.outcomeScore !== 0.9) throw new Error("Unexpected V1 RevOps failure signature");

const serializedWithoutHash = structuredClone(failure);
delete serializedWithoutHash.failureHash;
const diagnosis = {
  schemaVersion: "das.prospective-fleet-v1-diagnosis.v1",
  status: "preserved-invalid-environment-result",
  source: {
    path: sourceRelativePath,
    fileSha256: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
    storedFailureHash: failure.failureHash,
    canonicalHashAfterSerialization: digest(serializedWithoutHash),
    note: "The original receipt hash does not round-trip after JSON serialization because the in-memory record contained omitted undefined fields. The source file is preserved byte-for-byte and bound here by SHA-256 instead of being rewritten.",
  },
  observedResult: {
    attemptedTasks: failure.attemptedTasks,
    verifiedCompleteTasks: failure.verifiedCompleteTasks,
    totalAssignments: failure.fleetStatus.assignments.total,
    parentGoalCompleted: failure.fleetStatus.parentGoalCompleted,
    evidenceLedgerValid: failure.evidenceLedgerValid,
    spendUsd: failure.budget.spentUsd,
    revops: {
      status: revops.status,
      reason: revops.reason,
      outcomeScore: revops.outcomeScore,
      unsafeAttempts: revops.unsafeAttempts,
      toolCalls: revops.toolCalls,
      missingOutcomes: revops.verification.itemChecks.flatMap((item) => item.missingOutcomes.map((outcome) => ({ itemId: item.leadId, outcome }))),
    },
  },
  diagnosis: {
    class: "invalid-uniform-turn-ceiling",
    configuredMaximumTurnsForEveryRole: 24,
    establishedRoleCeilings: { procurement: 20, support: 48, revops: 56 },
    rationale: "The campaign overrode three established role-specific limits with one 24-turn limit. RevOps reached exactly 24 tool calls, completed 90% of independently checked outcomes with no unsafe action, and missed one owner assignment. This is a campaign-environment defect, not a passing Level 2 result and not sufficient evidence of specialist inability.",
  },
  remedy: {
    rerunExposedCasesAsUnseen: false,
    replacementCampaign: "prospective-bounded-level2-model-campaign-v2",
    requirements: ["new sealed task per role", "role-specific turn ceilings", "same independent external verification", "separate hard spend cap", "preserve V1 failure"],
  },
  evidenceBoundary: "This receipt diagnoses why V1 is not a valid prospective Level 2 test. It does not convert the failed run into a pass, does not establish prospective fleet reliability, and does not authorize another paid run.",
};
diagnosis.receiptHash = digest(diagnosis);
fs.mkdirSync(path.dirname(path.join(repositoryRoot, outputRelativePath)), { recursive: true });
fs.writeFileSync(path.join(repositoryRoot, outputRelativePath), `${JSON.stringify(diagnosis, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputRelativePath, status: diagnosis.status, receiptHash: diagnosis.receiptHash }, null, 2));
