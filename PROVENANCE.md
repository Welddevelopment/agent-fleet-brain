# Provenance

**Read this before renaming anything in this repository.**

## Why the sealed content says `das.`

Throughout `artifacts/` you will find strings like:

```
"schemaVersion": "das.bounded-fleet-controller.v1"
"schemaVersion": "das.bounded-fleet-contract.v1"
"schemaVersion": "das.prospective-fleet-model-campaign-plan.v2"
```

There are **34 distinct `das.*` schemaVersion strings** in `artifacts/fleet/`, and
**21 more** in `src/fleet/` and `src/fleet-console/`.

**They do not mean this is DAS. They record where the work was hosted.**

This code is Agent Fleet Brain. It was built inside the Dynamic Agent Specialisation
repository between 2026-08-05 and 2026-08-22, because at the time Fleet Brain had no
repository of its own. Its ladder was renumbered into DAS's 1 / 1.5 / 2 scheme, which is
why files carry `bounded-level2-*` names describing the wrong product. The `das.` prefix
is a fossil of that hosting arrangement.

## Why they must never be renamed

**The strings are inside the content that was hashed.** Every sealed receipt,
plan hash, contract hash, specialist hash and evidence-ledger link in `artifacts/`
was computed over JSON that contains these exact bytes.

Renaming `das.*` to `fleetbrain.*` changes those bytes, which changes every hash,
which **destroys the evidence the names label** — including the 115/115 independently
verified chain and the V3 campaign. The strings are historical facts about what was
sealed, not claims about who owns the product.

The same applies to:

- `DAS_PROSPECTIVE_FLEET_APPROVAL` — the campaign approval environment variable, bound
  into `prospective-fleet-campaign.js` gate checks.
- V2's frozen plan hash `997cd92e344c3f336c399fd1c7a46d9878f12b6e2a7ffbc56ef49f4bed06d5f9`.
- The `bounded-level2-*` filenames, which appear inside sealed artifact paths.

**Nothing under `artifacts/` is ever edited.** If a rename feels tempting, the honest
fix is a note like this one, not a mutation.

## What the split preserved, and how it was proved

Split on 2026-08-23 from DAS at commit `e87bf79` using `git filter-repo`, keeping the
full history of every path that moved — **23 commits spanning 2026-08-05 to 2026-08-22**,
not a fresh single-commit copy.

A baseline was recorded *before* anything moved, in the coordination hub at
`workstreams/fleet-brain/baseline-2026-08-23/`:

- All 83 files under `artifacts/fleet/` hashed individually, the manifest rolling up to
  `884082909953c00372652d00bf191c36be942ef3ea2103402d5183df0871441c`.
- DAS full suite at 549/549.

After the move, the manifest was regenerated identically and compared:
**the rollup hash matches, so all 83 sealed artifacts are byte-for-byte unchanged.**
Re-verify any time:

```bash
find artifacts/fleet -type f | LC_ALL=C sort | while read -r f; do
  printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"
done | shasum -a 256
```

## The dependency on DAS is real, and deliberate

Fleet Brain depends on `dynamic-agent-specialisation` as a package (`file:` dependency,
so both repositories must be checked out side by side on disk).

This was Joel's decision on 2026-08-23, recorded in the hub as APR-0010 (renumbered from APR-0006 on 2026-08-24 after a numbering collision with concurrent main-hub approvals). It is not a
leftover of shared hosting. **Fleet Brain genuinely needs DAS to build specialists** —
`finance-role-gap.js` calls DAS's `compileSpecialist` — and that is layer five of Fleet
Brain's own architecture. Admitting the dependency is more honest than vendoring a copy
that would silently drift.

**The dependency runs one way.** Fleet Brain imports DAS. DAS must never import Fleet
Brain. 72 import sites across 33 files were rewired from relative paths like
`../core/canonical.js` to `dynamic-agent-specialisation/src/core/canonical.js`.

## DAS-owned data this repository reads but does not contain

Two artifact locations belong to DAS and stay there. `src/fleet/das-repository.js`
resolves them through the package, so they are read from the DAS checkout:

| Path | Owner | In git? |
|---|---|---|
| `artifacts/level1/registry-v1.json` | DAS | tracked |
| `artifacts/runs/piece5-cross-role-current-runtime/v1/summary.json` | DAS | **gitignored** |

**This changes only where a file is read from. It never changes what is recorded.**
`verifyEvidenceReferences` still returns each reference's original relative path string,
still checks its sha256, and still enforces the path-escape guard. No sealed content
depends on the resolution mechanism.

### The part that deserves your attention

`artifacts/fleet/level1-admission-v1/admission-receipts.json` — a sealed artifact here —
carries nine `evidenceReferences`, each `{path, sha256}`, resolving to **seven distinct
files under DAS's `artifacts/runs/`**. That directory is **gitignored, 118 MB, exists on
one machine, and is in no clone and no backup.**

All seven verified at split time: `ok=7, mismatch=0, missing=0`.

What this means precisely, because it is easy to overstate in either direction:

- **Integrity survives independently.** Each source file's sha256 is sealed inside the
  receipt, so *what was admitted, and against which exact bytes*, is provable from the
  artifacts in this repository alone.
- **Re-derivation does not.** You cannot rebuild the admission from source without DAS's
  run data. On a machine with only this repository, the admission tests cannot run.

Copying that 118 MB in is not the fix — it would re-create the coupling this split exists
to remove, and duplicate evidence that would then drift. But **the run data is unbacked-up
and backs most paid evidence for both products.** That risk predates this split and is
tracked in the hub as `spend.das.evidenceAtRisk`. It should be resolved on its own terms.

## What this repository does not claim

The evidence here is real but bounded, and the boundary matters more than the numbers:

- The **115/115 chain is deterministic — zero model calls.** It proves the controller
  allocates, verifies, stops honestly and recovers without redoing work. It does not
  prove model-backed specialisation at scale, customer value, or production reliability.
- The **V2 model-backed campaign** is separate: 3 fictional roles, 56 settled calls,
  $0.25. **Never merge these two numbers.** That mistake has been made before.
- **V3 halted on a failed independent verification and refused to report success.** That
  is the result — a caught defect, not a clean pass.
- Passing tests prove plumbing, never that a model did anything.

The canonical description of what Fleet Brain is — and is not — lives at
`~/Founder-OS/current/startups/AGENT_FLEET_BRAIN.md`. **Read it before describing this
product to anyone.**

## Schemas born after the split

Work created in this repository from 2026-08-24 onward uses a **`fleetbrain.*`**
schemaVersion prefix. The `das.*` strings above are historical facts and stay; new
mechanisms are Fleet Brain's own and are labelled as such. The boundary date is the
overnight build under APR-0011 (hub, `coordination/approvals/`; renumbered from APR-0007).
