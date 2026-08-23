# Agent Fleet Brain

Where Capability Factory and DAS converge: one broad goal, many specialists, work
allocated and **every item independently verified**.

**Read `PROVENANCE.md` before renaming anything.** The sealed artifacts contain
`das.*` strings that record where this work was hosted. Renaming them destroys the
evidence they label.

**Read `~/Founder-OS/current/startups/AGENT_FLEET_BRAIN.md` before describing this
product to anyone.** It is the canonical account of what exists and what does not.

## Setup

This repository depends on the DAS repository as a package, so both must be checked
out side by side:

```
~/Desktop/Dynamic Agent Specialisation
~/Desktop/Agent Fleet Brain
```

```bash
npm install
npm test
```

Node 24+ is required. If `node` is not on your PATH:

```bash
export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
```

## The console

Fleet Brain's console runs on **port 4392**, separate from DAS's on 4391.

```bash
npm run fleet:console
```

## Layout

| Path | What |
|---|---|
| `src/fleet/` | the bounded fleet controller, planner, verifier, intake and admission |
| `src/fleet-console/` | the console front door, port 4392 |
| `src/console/fleet-state.js` | console state reader, shared shape with the DAS console |
| `src/experiments/` | rehearsals, seals and campaign runners |
| `artifacts/fleet/` | **sealed evidence — never edited** |
| `reports/` | 0076–0084, 0116, 0117 |

Report numbers are inherited from the shared DAS sequence. **0116 and 0117 each exist
twice**, once for Fleet Brain and once for DAS's B3 work. Cite them by title, not number.
