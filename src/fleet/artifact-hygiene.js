import fs from "node:fs";
import path from "node:path";

// Sealed-evidence hygiene for anything that writes artifacts.
//
// The directories below hold hash-sealed evidence whose byte-identity IS the
// product's credibility. The old rehearsal experiments write into them by design
// (they created them); nothing new may. Every new experiment, demo or harness run
// must claim its output directory through ensureFreshArtifactDirectory, which
// refuses the sealed set and anything inside it.

const SEALED_ROOTS = Object.freeze([
  "artifacts/fleet",
  // Completed comparison campaigns and demo runs seal once finished: the claim
  // checker noted FB-0001's reproduce line could overwrite v1 in place (byte-
  // identical under the stubbed clock, but silently - now it refuses instead).
  "artifacts/fleet-comparison/deterministic-v1",
  "artifacts/fleet-comparison/deterministic-v2",
  "artifacts/demo/run-1",
  "artifacts/demo/run-2",
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertWritableArtifactPath(candidate, { repositoryRoot = "." } = {}) {
  const root = path.resolve(repositoryRoot);
  const resolved = path.resolve(root, candidate);
  requireCondition(resolved.startsWith(`${root}${path.sep}`), `Artifact path escapes the repository: ${candidate}`);
  const relative = path.relative(root, resolved).split(path.sep).join("/");
  requireCondition(relative === "artifacts" || relative.startsWith("artifacts/"), `Artifact writes must stay under artifacts/: ${candidate}`);
  for (const sealed of SEALED_ROOTS) {
    requireCondition(relative !== sealed && !relative.startsWith(`${sealed}/`), `Refusing to write inside sealed evidence: ${relative} (sealed root: ${sealed})`);
  }
  return resolved;
}

export function ensureFreshArtifactDirectory(candidate, { repositoryRoot = "." } = {}) {
  const resolved = assertWritableArtifactPath(candidate, { repositoryRoot });
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
