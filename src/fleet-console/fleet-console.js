// Agent Fleet Brain console — renders preserved fleet evidence. No model calls.
// The section order is the demo order: honest boundary first, then the arc.

const main = document.querySelector("main");
const boundaryLabel = document.querySelector("#status-label");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
const pct = (v) => `${Math.round(Number(v) * 100)}%`;
const usd = (v) => `$${Number(v).toFixed(2)}`;
const humanise = (v) => String(v ?? "").replaceAll("-", " ");

async function load() {
  const response = await fetch("/api/fleet", { headers: { accept: "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`);
  return body;
}

function unavailable(reason) {
  return `<section class="fb-block"><p class="kicker">Agent Fleet Brain</p><h1 class="fb-title">Fleet evidence is unavailable.</h1><p class="lede">This console refuses to summarise a missing or mutated coordination chain. It will not improvise a result.</p><p class="notice error">${esc(reason)}</p></section>`;
}

function render({ fleet }) {
  if (!fleet || fleet.integrity !== "valid") return unavailable(fleet?.error ?? "No fleet checkpoint is loaded.");
  const c = fleet.continuation;
  const progress = Math.round((c.totalVerified / c.total) * 100);

  const intakeRows = fleet.intake.workloads.map((item) => `
    <article><span>${esc(item.system)}</span><strong>${esc(item.workload)}</strong><p>${esc(item.outcome)}</p><small>${esc(item.source)}</small></article>`).join("");

  const ledgerRows = fleet.plan.assignments.map((a) => `
    <article class="fleet-assignment ${a.phase}">
      <div class="fleet-assignment-main"><span>${esc(a.workload)}</span><strong>${esc(a.specialist)}</strong><small>${a.quantity} items · ${esc(a.phase === "residual" ? "new specialist, activated after the gap" : "verified before the gap")}</small></div>
      <dl><div><dt>Outcome</dt><dd>${pct(a.expectedOutcomeScore)}</dd></div><div><dt>Estimate</dt><dd>${usd(a.estimatedCostUsd)}</dd></div><div><dt>Verifier</dt><dd>${esc(a.verifier)}</dd></div></dl>
    </article>`).join("");

  return `
  <!-- 0. Honest boundary FIRST. Said out loud before anything impressive appears. -->
  <section class="fb-frame" id="frame" aria-label="What this is">
    <div class="fb-frame-inner">
      <p class="kicker">Before anything else</p>
      <h2>Bounded coordination over a fictional company. Deterministic. Zero model calls in this chain.</h2>
      <p>What it proves: the fleet controller allocates, verifies every item independently, stops honestly when it cannot route safely, and recovers without redoing finished work. What it does not prove: model-backed specialisation at scale, customer value, or production reliability.</p>
    </div>
  </section>

  <!-- 1. The goal -->
  <section class="fleet-workspace">
    <header class="fleet-hero" id="goal">
      <div><p class="kicker">One broad goal · four streams · one ceiling</p><h1>One goal.<br>Five specialists.</h1></div>
      <div class="fleet-goal"><span>Trusted broad goal</span><p>${esc(fleet.broadGoal)}</p><strong>${esc(humanise(c.finalState))}</strong></div>
    </header>

    <section class="fleet-summary" aria-label="Fleet completion summary">
      <article class="fleet-progress"><span>Verified outcome</span><strong>${c.totalVerified}<i> / ${c.total}</i></strong><div class="fleet-progress-track"><i style="width:${progress}%"></i></div><p>The parent goal completed only after every workload passed its bound external checker.</p></article>
      <article><span>Carried</span><strong>${c.carriedWithoutRerun}</strong><p>Previously verified items preserved without rerun.</p></article>
      <article><span>Residual</span><strong>${c.residualExecuted}</strong><p>Blocked finance items executed after activation.</p></article>
      <article><span>Safety</span><strong>${c.residualSafetyViolations}</strong><p>Residual safety violations detected.</p></article>
    </section>

    <!-- 2. Intake -->
    <section class="fleet-intake" id="intake">
      <div class="fleet-intake-copy"><p class="kicker">Trusted fleet intake</p><h2>The work arrives bounded.<br>The planner cannot widen it.</h2><p>Fresh customer-local snapshots reference only pre-verified adapter operations. They can describe current work, but they cannot invent a capability or grant spend, execution, role-creation or activation authority.</p><div><strong>${fleet.intake.adapters} adapters</strong><span>${fleet.intake.snapshots} fresh snapshots · ${fleet.intake.workloads.length} workload classes</span></div></div>
      <div class="fleet-intake-stack">${intakeRows}<footer>${esc(fleet.intake.boundary)}</footer></div>
    </section>

    <!-- 3. The decisive return -->
    <section class="fleet-turn" id="return">
      <div class="fleet-turn-copy"><p class="kicker">The decisive return</p><h2>It stopped honestly.<br>Then filled the missing role.</h2><p>The first plan completed every job it could safely route, but refused to hand finance work to a plausible general agent. A separate bounded comparison produced a finance specialist. Only the ten blocked items were replanned — the earlier ${c.carriedWithoutRerun} were carried, not rerun.</p></div>
      <div class="fleet-turn-states">
        <article><span>Initial state</span><strong>${fleet.initial.assigned} / ${fleet.initial.total}</strong><p>${esc(fleet.initial.roleGap)} had no proved match. Parent goal remained incomplete — on purpose.</p></article>
        <i aria-hidden="true">→</i>
        <article class="candidate"><span>Level 1 selection</span><strong>${esc(fleet.roleGap.selectedCandidate)}</strong><p>${pct(fleet.roleGap.frozenPassRate)} frozen-case pass · ${fleet.roleGap.safetyViolations} unsafe attempts · exact verifier bound.</p></article>
        <i aria-hidden="true">→</i>
        <article class="complete"><span>Continued state</span><strong>${c.totalVerified} / ${c.total}</strong><p>Prior work carried, residual verified, original broad goal completed.</p></article>
      </div>
    </section>

    <!-- 4. Ledger -->
    <section class="fleet-ledger" id="ledger">
      <div class="fleet-ledger-copy"><p class="kicker">Allocation ledger</p><h2>The recommendation is automatic.<br>The reasoning stays inspectable.</h2><p>${esc(fleet.plan.strategy)} was selected under the fictional ${usd(fleet.plan.hardCostLimitUsd)} ceiling. Each assignment is bound to one workload, one specialist and one independent checker — never to the specialist's own report.</p><dl><div><dt>Estimated total</dt><dd>${usd(fleet.plan.estimatedCostUsd)}</dd></div><div><dt>Expected outcome</dt><dd>${(fleet.plan.expectedOutcomeScore * 100).toFixed(1)}%</dd></div></dl></div>
      <div class="fleet-assignment-stack">${ledgerRows}</div>
    </section>

    <!-- 5. Boundary -->
    <footer class="fleet-boundary" id="boundary-section">
      <div><span>What exists</span><strong>A joined deterministic control mechanism in one fictional four-stream company.</strong></div>
      <div><span>What remains unproved</span><strong>${esc(fleet.nextGate)}</strong></div>
      <p>${esc(fleet.boundary)}</p>
      <p class="fb-separate"><strong>Separately,</strong> a small model-backed fleet campaign (V2) did run and complete: three fictional roles, 56 settled calls, $0.25, every task independently verified, zero unsafe attempts. It is a different, smaller run. It is never merged with the 115/115 above.</p>
    </footer>
  </section>`;
}

// Motion is additive only. Every element is fully visible at rest in CSS; GSAP
// merely animates *from* an offset. If the tab is backgrounded, the animation is
// skipped, or the library fails to load, the page is still complete on camera.
// (An earlier version animated *to* visible, which left the summary tiles at
// opacity 0 whenever a load happened while the tab was hidden.)
function animate() {
  if (!globalThis.gsap || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) return;
  gsap.registerPlugin?.(globalThis.ScrollTrigger);
  gsap.from(".fb-frame-inner > *", { y: 18, opacity: 0, duration: .6, stagger: .1, ease: "power2.out", clearProps: "all" });
  gsap.from(".fleet-hero > *", { y: 28, opacity: 0, duration: .75, stagger: .12, delay: .2, ease: "power3.out", clearProps: "all" });
  gsap.from(".fleet-summary > article", { y: 22, opacity: 0, duration: .6, stagger: .07, delay: .35, ease: "power2.out", clearProps: "all" });
  if (globalThis.ScrollTrigger) {
    gsap.utils.toArray(".fleet-assignment").forEach((card, i) => gsap.from(card, { y: 24 + i * 4, opacity: .35, scrollTrigger: { trigger: card, start: "top 92%", end: "top 68%", scrub: .35 } }));
    gsap.from(".fleet-turn-states", { opacity: .35, scrollTrigger: { trigger: ".fleet-turn", start: "top 82%", end: "center 55%", scrub: .5 } });
  }
}

try {
  const body = await load();
  main.innerHTML = render(body);
  boundaryLabel.textContent = "Preserved evidence · deterministic · 0 model calls in this console";
  animate();
} catch (error) {
  main.innerHTML = unavailable(error instanceof Error ? error.message : String(error));
  boundaryLabel.textContent = "Evidence unavailable";
}
