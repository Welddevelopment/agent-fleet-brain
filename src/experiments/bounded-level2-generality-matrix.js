import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { runBoundedFleetGeneralityMatrix } from "../fleet/bounded-level2-generality.js";

const outputDirectory = path.resolve("artifacts/fleet/bounded-level2-generality-v1");
fs.mkdirSync(outputDirectory, { recursive: true });
const matrix = runBoundedFleetGeneralityMatrix();
for (const profile of matrix.profiles) {
  const directory = path.join(outputDirectory, profile.result.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "contract.json"), `${JSON.stringify(profile.contract, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, "plan.json"), `${JSON.stringify(profile.plan, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, "verification.json"), `${JSON.stringify(profile.verification, null, 2)}\n`);
}
const summary = {
  schemaVersion: matrix.schemaVersion,
  status: matrix.status,
  profiles: matrix.profiles.map((profile) => profile.result),
  checks: matrix.checks,
  modelCalls: 0,
  paidModelSpendUsd: 0,
  evidenceBoundary: matrix.evidenceBoundary,
};
summary.summaryHash = digest(summary);
fs.writeFileSync(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
