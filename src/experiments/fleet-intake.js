import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { runFleetIntakeFixture } from "../fleet/fleet-intake-fixture.js";

const result = runFleetIntakeFixture();
const output = path.resolve("artifacts/fleet/intake-v1");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "adapter-descriptors.json"), `${JSON.stringify(result.adapters, null, 2)}\n`);
fs.writeFileSync(path.join(output, "workload-snapshots.json"), `${JSON.stringify(result.snapshots, null, 2)}\n`);
fs.writeFileSync(path.join(output, "intake-receipt.json"), `${JSON.stringify(result.intake.receipt, null, 2)}\n`);
fs.writeFileSync(path.join(output, "contract.json"), `${JSON.stringify(result.intake.contract, null, 2)}\n`);
fs.writeFileSync(path.join(output, "plan.json"), `${JSON.stringify(result.plan, null, 2)}\n`);
fs.writeFileSync(path.join(output, "verification.json"), `${JSON.stringify(result.verification, null, 2)}\n`);
const summary = { schemaVersion: "das.fleet-intake-summary.v1", status: "completed", trustedAdapters: result.adapters.length, freshSnapshots: result.snapshots.length, workloadsCompiled: result.intake.contract.workload.length, routedItems: result.plan.selected.metrics.assignedVolume, verificationPassed: result.verification.passed, authorityGranted: Object.values(result.intake.receipt.authority).some(Boolean), modelCalls: 0, paidModelSpendUsd: 0, evidenceBoundary: result.evidenceBoundary };
summary.summaryHash = digest(summary);
fs.writeFileSync(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
