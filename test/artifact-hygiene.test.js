import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertWritableArtifactPath, ensureFreshArtifactDirectory } from "../src/fleet/artifact-hygiene.js";

test("writes inside sealed evidence are refused, at the root and below it", () => {
  assert.throws(() => assertWritableArtifactPath("artifacts/fleet"), /sealed evidence/);
  assert.throws(() => assertWritableArtifactPath("artifacts/fleet/prospective-model-campaign-v2/summary.json"), /sealed evidence/);
  assert.throws(() => assertWritableArtifactPath("artifacts/fleet/new-subdir"), /sealed evidence/);
});

test("writes outside artifacts/ or escaping the repository are refused", () => {
  assert.throws(() => assertWritableArtifactPath("src/fleet"), /must stay under artifacts/);
  assert.throws(() => assertWritableArtifactPath("../elsewhere/artifacts/x"), /escapes the repository|must stay under artifacts/);
  assert.throws(() => assertWritableArtifactPath("artifacts/../src/fleet"), /must stay under artifacts/);
});

test("fresh directories under artifacts/ are created and returned absolute", () => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-hygiene-"));
  const created = ensureFreshArtifactDirectory("artifacts/fleet-comparison/run-1", { repositoryRoot });
  assert.ok(created.startsWith(repositoryRoot));
  assert.ok(fs.statSync(created).isDirectory());
  assert.throws(() => ensureFreshArtifactDirectory("artifacts/fleet/anything", { repositoryRoot }), /sealed evidence/);
});
