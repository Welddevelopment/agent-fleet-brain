import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { runLevel1FleetAdmissionFixture } from "../fleet/level1-fleet-admission-fixture.js";

const result = runLevel1FleetAdmissionFixture();
const output = path.resolve("artifacts/fleet/level1-admission-v1");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "admission-receipts.json"), `${JSON.stringify(result.admissions.map((item) => item.receipt), null, 2)}\n`);
fs.writeFileSync(path.join(output, "specialists.json"), `${JSON.stringify(result.admissions.map((item) => item.specialist), null, 2)}\n`);
fs.writeFileSync(path.join(output, "contract.json"), `${JSON.stringify(result.contract, null, 2)}\n`);
fs.writeFileSync(path.join(output, "plan.json"), `${JSON.stringify(result.plan, null, 2)}\n`);
fs.writeFileSync(path.join(output, "verification.json"), `${JSON.stringify(result.verification, null, 2)}\n`);
const summary = { schemaVersion: "das.level1-fleet-admission-summary.v1", status: "completed", admittedSelections: result.admissions.length, routedItems: result.plan.selected.metrics.assignedVolume, roleGaps: result.plan.selected.roleGaps.length, verificationPassed: result.verification.passed, executionAuthorityGranted: Object.values(result.plan.authority).some(Boolean), modelCalls: 0, paidModelSpendUsd: 0, evidenceBoundary: result.evidenceBoundary };
summary.summaryHash = digest(summary);
fs.writeFileSync(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
