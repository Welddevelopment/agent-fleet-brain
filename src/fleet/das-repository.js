import { createRequire } from "node:module";
import path from "node:path";

// Fleet Brain owns its own code and its own sealed artifacts under artifacts/fleet/.
// It does NOT own DAS's Level 1 registry or the paid run summaries its admission
// evidence points at; those stay in the DAS repository, which is a declared package
// dependency. This resolves that repository's root so DAS-owned artifacts are read
// from where they actually live.
//
// This changes only WHERE a file is read from. It never changes what is recorded:
// evidence references keep their original relative path strings, and every hash check
// and path-escape guard still runs against them. See PROVENANCE.md.
const require = createRequire(import.meta.url);

export const dasRepositoryRoot = path.dirname(require.resolve("dynamic-agent-specialisation/package.json"));

export function dasArtifactPath(relativePath) {
  return path.join(dasRepositoryRoot, relativePath);
}
