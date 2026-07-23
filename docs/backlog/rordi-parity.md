# Rordi-parity backlog

Loopbreaker is a deliberate distillation of Rordi's entity-native contract. This backlog tracks
the handful of Rordi concepts judged worth pulling *down* into the distillation — not the whole
superset. Coherence evaluation, data-driven ontology/status-machines, and facets stay upstream in
Rordi on purpose: loopbreaker's fixed 6-stage gate *is* the product.

Ordered by dependency. Each item is scoped as a loopbreaker issue with candidate behavior children
(`trigger` / `expected` / `verify`) ready to shape → import → plan.

---

## LB-21 — Provenance stamping (do first)

**Why first:** a cheap column trio on the single mutation path (`src/domain.ts`), and the later
items (freshness, tiers) all benefit from having it in place before they add rows.

**Scope:** stamp every state progression with who/what caused it. Add `trigger_type`
(`agent` | `human` | `hook` | `cli`), `triggered_by` (identifier), and `trigger_data` (JSON) to the
records written by `recordPass`, `recordPlanningReviewPass`, `recordEvidence`, `verifyBehavior`,
`createWaiver`, `shapeRecord`. Surface in `substrate()` and the visualizer node footers.

- **B1** — WHEN any domain mutation runs · EXPECT the persisted row carries a non-null
  `trigger_type` and `triggered_by` · PROVE a domain test asserts the columns on each writer.
- **B2** — WHEN provenance is absent from an inbound call · EXPECT it defaults to `cli`/`agent` by
  interface, never null · PROVE unit test over CLI vs MCP vs hook entry points.
- **B3** — WHEN `substrate()` renders a pass/evidence/finding · EXPECT the provenance is included in
  the read model · PROVE snapshot test + a visualizer footer line.

**Non-goals:** a full append-only events log spanning session/workflow planes (that's Rordi's).

---

## LB-22 — Verification freshness / decay (highest value)

**Why:** loopbreaker treats "verified" as permanent. Real proof rots — a behavior verified against a
now-changed contract or a stale wired replay should decay and demand re-attestation.

**Scope:** add `verified_at` and an optional `decay_half_life_days` (default 90) to evidence /
behavior verification. Derive `freshness` ∈ `fresh` | `decaying` | `expired` in `substrate()`.
`review_ship_status` treats an `expired` enforced behavior as **not** shipping-ready (same class as
unverified), surfaced with its own reason so it's distinguishable from never-verified.

- **B1** — WHEN a behavior was verified longer than one half-life ago · EXPECT its freshness is
  `decaying`, past `expired` threshold it is `expired` · PROVE a time-injected domain test.
- **B2** — WHEN an enforced behavior is `expired` · EXPECT ship disposition is `hold` with reason
  `verification_expired`, distinct from `unverified` · PROVE ship-status test.
- **B3** — WHEN fresh evidence is re-recorded for an expired behavior · EXPECT freshness returns to
  `fresh` and shipping recovers · PROVE round-trip test.
- **B4** — WHEN the visualizer renders a behavior node · EXPECT decaying/expired tone (amber/red) and
  a freshness line · PROVE `web/src/graph.ts` mapping + component test.

**Non-goals:** bitemporal `valid_from`/`valid_to` intervals and supersession edges (Rordi's claim
calculus) — this is the flattened freshness slice only.

---

## LB-23 — Initiative / epic tiers above issue

**Why:** prerequisite for any multi-issue portfolio UI (the "missing UI structure"). Also gives the
epic a home for the executable scenario + a completion gate spanning its issues.

**Scope:** add `initiatives` and `epics` tables (or a single typed `containers` table) with
parent/child edges to issues. `initiative` carries strategic fields (priority, appetite,
reversibility, decider); `epic` carries an executable-scenario body + a completion rule (all child
issues shipped). New CLI/MCP read surfaces: `review_list_issues` gains grouping; a new
`portfolio`/`review_portfolio` read model aggregates roll-up state.

- **B1** — WHEN issues are imported under an epic · EXPECT the epic reports child issues and a
  computed completion state · PROVE domain test over a seeded 2-issue epic.
- **B2** — WHEN every enforced behavior across an epic's issues is shipping-ready · EXPECT the epic
  completion gate reads `complete`, else `open` with the blocking issue ids · PROVE roll-up test.
- **B3** — WHEN the portfolio read model is requested · EXPECT initiative → epic → issue hierarchy
  with per-node disposition · PROVE `review_portfolio` MCP + CLI snapshot.

**Non-goals:** Rordi's unified `entities` table / data-driven schemas — keep concrete typed tables.

---

## LB-24 — Canon invariants as first-class entities

**Why:** loopbreaker's domain rules (behavior children enforced by default; 3-pass cap; freeze on
approval; review-completion ≠ ship-readiness) are baked into code. Making them queryable nodes lets
the UI *show why a gate held* and lets a review cite the invariant it enforced.

**Scope:** a `canon` table of invariant nodes (`id`, `title`, `statement`, `enforced`, optional
`domain`). Gate decisions in `substrate()` reference the canon id they enforce (e.g. a held
implementation gate cites `canon:planning-review-precedes-implementation`). Read-only surface first;
no editing of enforcement semantics from data (the rules stay in `domain.ts`).

- **B1** — WHEN a gate holds an issue · EXPECT the held reason carries the `canon` id it enforces ·
  PROVE substrate test mapping each gate → canon id.
- **B2** — WHEN canon is listed · EXPECT the seeded core invariants are present and marked enforced ·
  PROVE a seed + list test.
- **B3** — WHEN the visualizer inspects a held gate node · EXPECT the enforcing invariant statement
  is shown · PROVE `web/` inspector panel test.

**Non-goals:** the claim calculus (computed status from evaluators, justification edges, coherence
axes, canon domains/tiers/register). Canon here is a documentation-grade queryable node, not a
claim-bearing evaluated entity.

---

## Cross-cutting: portfolio UI (unblocked by LB-23)

The single-issue, inspect-only visualizer (`web/`) is what Track-1 (Herdr plugin) exposes today.
Once LB-23 lands, add an initiative→epic→issue portfolio view + an attention queue, informed by
Rordi's Map v2 (force-directed, initiative territories, semantic LOD) and FleetStrip (needs-you
queue). This is where the "UI structure missing from Rordi" gets built into loopbreaker's own `web/`,
supervised by the Herdr plugin (`herdr-plugin.toml`).
