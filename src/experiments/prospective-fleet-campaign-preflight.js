import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { runProspectiveFleetCampaignPreflight } from "../fleet/prospective-fleet-campaign-fixture.js";

const result = await runProspectiveFleetCampaignPreflight();
const output = path.resolve("artifacts/fleet/prospective-model-campaign-v1");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "plan.json"), `${JSON.stringify(result.plan, null, 2)}\n`);
const summary = { schemaVersion: "das.prospective-fleet-campaign-preflight.v1", status: "ready-awaiting-explicit-paid-approval", selectedSpecialists: result.plan.assignments.length, sealedTasks: result.plan.sealedTasks.count, maximumTaskEvaluations: result.plan.maximumTaskEvaluations, maximumModelTurns: result.plan.maximumModelTurns, hardSpendLimitUsd: result.plan.hardSpendLimitUsd, checks: result.checks, modelCalls: 0, paidModelSpendUsd: 0, evidenceBoundary: result.evidenceBoundary };
summary.summaryHash = digest(summary);
fs.writeFileSync(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
