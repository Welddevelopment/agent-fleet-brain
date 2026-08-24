import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshArtifactDirectory } from "../fleet/artifact-hygiene.js";
import { runFleetBrainDemo } from "../fleet/demo-story.js";

// The one-command Fleet Brain demo.
//
//   npm run demo
//
// Runs the whole deterministic story into a FRESH artifacts/demo/run-N directory
// (never overwriting an earlier run, never touching sealed evidence — the hygiene
// guard makes that structurally impossible), prints the narrative, and points at
// the console.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(repositoryRoot);

let runIndex = 1;
while (fs.existsSync(path.join(repositoryRoot, "artifacts", "demo", `run-${runIndex}`)) && fs.readdirSync(path.join(repositoryRoot, "artifacts", "demo", `run-${runIndex}`)).length > 0) runIndex += 1;
const outputDirectory = ensureFreshArtifactDirectory(process.argv[2] ?? `artifacts/demo/run-${runIndex}`, { repositoryRoot });

const story = await runFleetBrainDemo({ outputDirectory, approvedBy: process.env.DEMO_OPERATOR ?? "demo-operator" });

const line = (text = "") => console.log(text);
line();
line("AGENT FLEET BRAIN — deterministic demo story");
line("=".repeat(60));
line();
line(`BOUNDARY FIRST: ${story.honesty.boundary}`);
line();
story.stages.forEach((stage, index) => {
  line(`${index + 1}. [${stage.stage}] ${stage.status}`);
  line(`   ${stage.summaryLine}`);
  line(`   receipt ${stage.stageHash.slice(0, 12)}…`);
  line();
});
line("NOT PROVED BY ANY OF THE ABOVE:");
for (const item of story.honesty.notProved) line(`  - ${item}`);
line();
line(`Story sealed: ${story.storyHash.slice(0, 12)}…  (${path.relative(repositoryRoot, outputDirectory)}/manifest.json)`);
line(`Model calls: ${story.deterministic.modelCalls}. Paid spend: $${story.deterministic.paidModelSpendUsd}.`);
line();
line("Console: npm run fleet:console  ->  http://127.0.0.1:4392  (Demo run panel)");
