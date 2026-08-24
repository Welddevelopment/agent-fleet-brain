import fs from "node:fs";
import path from "node:path";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";
import { assertFleetAssignmentObservation } from "./bounded-level2-controller.js";

// Fleet memory: the durable performance history behind "fleet adaptation".
//
// The recovered 2026-08-01 ladder defines the rung above the current one as: the
// system "measures the whole fleet and decides when to add, alter, merge or retire
// specialists." This module is the bounded, honest start of it — the MEASURING and
// the DECIDING-AS-PROPOSAL. It appends verified observations to a hash-chained
// ledger (every entry links the previous entry's hash, so history cannot be
// silently rewritten or reordered), derives per-specialist records from that
// history alone, and emits retire/watch/keep PROPOSALS with the evidence attached.
// Nothing here executes a proposal: retiring a specialist remains a human decision
// through the normal approval gates, exactly like every other authority in this
// codebase.

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export class FleetMemory {
  #filePath;
  #entries;

  constructor({ filePath }) {
    requireCondition(filePath, "Fleet memory needs an owner-controlled durable path");
    this.#filePath = path.resolve(filePath);
    this.#entries = [];
    if (fs.existsSync(this.#filePath)) {
      this.#entries = JSON.parse(fs.readFileSync(this.#filePath, "utf8"));
      this.#verifyChain();
    }
  }

  #verifyChain() {
    let previousHash = "";
    for (const [index, entry] of this.#entries.entries()) {
      requireCondition(entry.schemaVersion === "fleetbrain.fleet-memory-entry.v1", `Fleet memory entry ${index} has an unsupported schema`);
      requireCondition(entry.previousHash === previousHash, `Fleet memory chain broken at entry ${index}: history was reordered or rewritten`);
      requireCondition(entry.entryHash === digest(withoutHash(entry, "entryHash")), `Fleet memory entry ${index} integrity mismatch`);
      previousHash = entry.entryHash;
    }
  }

  recordObservation({ observation, campaignId, recordedAt }) {
    assertFleetAssignmentObservation(observation);
    requireCondition(String(campaignId ?? "").trim(), "Fleet memory needs the campaign the observation came from");
    requireCondition(String(recordedAt ?? "").trim(), "Fleet memory needs an explicit deterministic timestamp — its entries are hashed");
    const entry = {
      schemaVersion: "fleetbrain.fleet-memory-entry.v1",
      previousHash: this.#entries.length ? this.#entries[this.#entries.length - 1].entryHash : "",
      campaignId: String(campaignId),
      recordedAt: String(recordedAt),
      specialistId: observation.specialistId,
      specialistHash: observation.specialistHash,
      workloadId: observation.workloadId,
      observationHash: observation.observationHash,
      verificationPassed: observation.verificationPassed,
      completedQuantity: observation.completedQuantity,
      actualCostUsd: observation.actualCostUsd,
      unsafeAttempts: observation.unsafeAttempts,
      incorrectSideEffects: observation.incorrectSideEffects,
    };
    entry.entryHash = digest(entry);
    this.#entries.push(entry);
    fs.writeFileSync(this.#filePath, `${JSON.stringify(this.#entries, null, 2)}\n`, { mode: 0o600 });
    return Object.freeze(structuredClone(entry));
  }

  history() {
    this.#verifyChain();
    return structuredClone(this.#entries);
  }

  specialistRecords() {
    this.#verifyChain();
    const bySpecialist = new Map();
    for (const entry of this.#entries) {
      if (!bySpecialist.has(entry.specialistId)) {
        bySpecialist.set(entry.specialistId, { specialistId: entry.specialistId, observations: 0, verificationsPassed: 0, unitsCompleted: 0, totalCostUsd: 0, unsafeAttempts: 0, incorrectSideEffects: 0, campaigns: new Set() });
      }
      const record = bySpecialist.get(entry.specialistId);
      record.observations += 1;
      record.verificationsPassed += entry.verificationPassed ? 1 : 0;
      record.unitsCompleted += entry.completedQuantity;
      record.totalCostUsd += entry.actualCostUsd;
      record.unsafeAttempts += entry.unsafeAttempts;
      record.incorrectSideEffects += entry.incorrectSideEffects;
      record.campaigns.add(entry.campaignId);
    }
    return [...bySpecialist.values()]
      .map((record) => ({ ...record, campaigns: [...record.campaigns].sort(), verificationRate: record.observations ? record.verificationsPassed / record.observations : 0 }))
      .sort((left, right) => left.specialistId.localeCompare(right.specialistId));
  }
}

// The adaptation advisor: reads the memory, PROPOSES. Its thresholds are declared
// in its own receipt so a proposal can never claim more neutrality than it has.
export function proposeFleetAdaptations({ memory, minimumObservations = 3, watchVerificationRate = 1, generatedAt }) {
  requireCondition(memory instanceof FleetMemory, "The advisor reads a verified fleet memory");
  requireCondition(String(generatedAt ?? "").trim(), "The advisor needs an explicit deterministic timestamp");
  const records = memory.specialistRecords();
  const proposals = records.map((record) => {
    let recommendation = "keep";
    let reason = "No adverse evidence in the recorded history.";
    if (record.unsafeAttempts > 0 || record.incorrectSideEffects > 0) {
      recommendation = "propose-retire";
      reason = `Recorded ${record.unsafeAttempts} unsafe attempt(s) and ${record.incorrectSideEffects} incorrect side effect(s) — safety history disqualifies until re-proved.`;
    } else if (record.observations < minimumObservations) {
      recommendation = "insufficient-history";
      reason = `Only ${record.observations} observation(s) against a minimum of ${minimumObservations} — no adaptation decision is honest yet.`;
    } else if (record.verificationRate < watchVerificationRate) {
      recommendation = "propose-watch";
      reason = `Verification rate ${(record.verificationRate * 100).toFixed(1)}% across ${record.observations} observations — below the watch threshold.`;
    }
    return { specialistId: record.specialistId, recommendation, reason, evidence: { observations: record.observations, verificationRate: record.verificationRate, unitsCompleted: record.unitsCompleted, totalCostUsd: Number(record.totalCostUsd.toFixed(10)), unsafeAttempts: record.unsafeAttempts, incorrectSideEffects: record.incorrectSideEffects, campaigns: record.campaigns } };
  });
  const receipt = {
    schemaVersion: "fleetbrain.fleet-adaptation-proposals.v1",
    generatedAt: String(generatedAt),
    thresholds: { minimumObservations, watchVerificationRate },
    proposals,
    authority: { retirementAuthorized: false, activationAuthorized: false, executionAuthorized: false },
    evidenceBoundary: "Adaptation PROPOSALS derived from the hash-chained fleet history, with thresholds declared. Nothing here retires, activates or executes anything — every proposal awaits a human decision through the normal approval gates.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}
