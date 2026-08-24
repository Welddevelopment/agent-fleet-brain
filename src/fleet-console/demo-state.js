import fs from "node:fs";
import path from "node:path";
import { digest } from "dynamic-agent-specialisation/src/core/canonical.js";

// Loads the latest demo run for the console, failing closed exactly like the
// preserved-evidence loader: a missing or mutated manifest renders as
// "unavailable", never as an improvised summary. Full hashes never leave this
// API — the console shows 12-character prefixes only.

const prefix = (hash) => String(hash ?? "").slice(0, 12);

export function loadDemoState({ demoRoot = "artifacts/demo" } = {}) {
  try {
    const root = path.resolve(demoRoot);
    if (!fs.existsSync(root)) return { integrity: "absent", error: "No demo run exists yet. Run: npm run demo" };
    const runs = fs.readdirSync(root).filter((name) => name.startsWith("run-") && fs.existsSync(path.join(root, name, "manifest.json")));
    if (runs.length === 0) return { integrity: "absent", error: "No demo run exists yet. Run: npm run demo" };
    runs.sort((left, right) => Number(right.slice(4)) - Number(left.slice(4)));
    const run = runs[0];
    const manifest = JSON.parse(fs.readFileSync(path.join(root, run, "manifest.json"), "utf8"));
    if (manifest.schemaVersion !== "fleetbrain.demo-story.v1") return { integrity: "invalid", error: "Unsupported demo manifest" };
    const expected = manifest.storyHash;
    const copy = structuredClone(manifest);
    delete copy.storyHash;
    if (!expected || digest(copy) !== expected) return { integrity: "invalid", error: "Demo manifest failed its integrity check — refusing to render it" };
    for (const stage of manifest.stages) {
      const stageCopy = structuredClone(stage);
      const stageExpected = stageCopy.stageHash;
      delete stageCopy.stageHash;
      if (!stageExpected || digest(stageCopy) !== stageExpected) return { integrity: "invalid", error: `Demo stage ${stage.stage} failed its integrity check — refusing to render it` };
    }
    return {
      integrity: "valid",
      run,
      storyHash: prefix(manifest.storyHash),
      boundary: manifest.honesty.boundary,
      notProved: manifest.honesty.notProved,
      modelCalls: manifest.deterministic.modelCalls,
      paidModelSpendUsd: manifest.deterministic.paidModelSpendUsd,
      stages: manifest.stages.map((stage) => ({
        stage: stage.stage,
        status: stage.status,
        summaryLine: stage.summaryLine,
        receipt: prefix(stage.stageHash),
      })),
    };
  } catch (error) {
    return { integrity: "invalid", error: error instanceof Error ? error.message : String(error) };
  }
}
