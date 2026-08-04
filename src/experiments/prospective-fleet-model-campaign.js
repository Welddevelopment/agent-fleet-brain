import { runProspectiveFleetModelCampaign } from "../fleet/prospective-fleet-campaign-runner.js";

try {
  const result = await runProspectiveFleetModelCampaign();
  console.log(JSON.stringify({ status: result.status, taskCount: result.taskCount, fleetStatus: result.fleetStatus, budget: result.budget, evidenceLedgerValid: result.evidenceLedgerValid, evidenceBoundary: result.evidenceBoundary }, null, 2));
} catch (error) {
  console.error(JSON.stringify(error.prospectiveFleetFailure ?? { status: "failed", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
