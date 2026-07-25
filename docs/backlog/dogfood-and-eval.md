# Comprehensive dogfooding + eval plan

Companion to [rordi-parity.md](rordi-parity.md). That document said *which* Rordi concepts to pull
down. This one says how loopbreaker gets driven through its own six stages end-to-end, and what the
eval project must measure to support the talk.

Ordering decision (2026-07-25, ben@rordi.ai): dogfood **depth-first** — one issue all the way to
`ship` — and **bootstrap and verify the behaviors' verify harness before implementing anything**.

---

## 0. The finding that reorders everything: evidence injection

`recordEvidence` (`src/domain.ts:592`) is a plain INSERT of caller-supplied values:

```ts
input: { issueId, behaviorId?, tier: EvidenceTier, verdict: Verdict, summary, source? }
```

Nothing in the repository executes anything. There is no `child_process`, no test runner
invocation, no exit-code capture anywhere on the mutation path. `verifyBehavior`
(`src/domain.ts:607`) then applies exactly three mechanical checks:

1. the evidence row is attached to that behavior,
2. `verdict === "pass"`,
3. not (`enforced` **and** `tier === "unit"`).

Every one of those reads a value the caller wrote. **An agent can declare `tier: "wired", verdict:
"pass"` for a harness it never ran, and loopbreaker will verify the behavior and flip the issue to
`ship`.** The tier is self-declared, the verdict is self-declared, and `source` is a free string.

This is the same defect class as [premise injection](premise-injection-and-discovery-gate), at the
opposite end of the pipe:

| | Top of pipe | Bottom of pipe |
|---|---|---|
| Unchecked input | the shape's premise | the proof's verdict |
| Failure mode | rigorously certified *wrong* software | rigorously certified *unbuilt* software |
| Status | closed by LB-25 (shaped, planned, approved — **not yet implemented**) | **open** |

LB-16 and LB-18 are currently `ship`. Both reached it through asserted evidence. Their ship
disposition is not proof that they work; it is proof that someone said they work.

This is why harness-first is load-bearing rather than tidy: **until evidence is executed rather
than asserted, loopbreaker's ship verdict cannot be an eval metric**, because the arm being
measured also authors its own score.

### Verified repro (2026-07-25, against `1ac3ffa`)

Seed the demo into a disposable database — `DEMO-1` starts at `hold`, blocked on `DEMO-B3`, an
enforced behavior holding only `unit` evidence. Then, writing no code and running no test:

```sh
loopbreaker demo --db ./inject.db
loopbreaker evidence DEMO-1 --behavior DEMO-B3 --tier wired --verdict pass \
  --summary "Wired replay harness passes end to end." \
  --source "tests/replay/warm-followup.wired.test.ts" --db ./inject.db
loopbreaker verify DEMO-B3 --evidence <id> --db ./inject.db
```

`tests/replay/warm-followup.wired.test.ts` does not exist in the repository.

| | `shipping.disposition` | `shipping.reason` |
|---|---|---|
| before | `hold` | 1 enforced behavior is neither verified nor waived. |
| after | `ship` | Every enforced behavior is verified. |

The `enforced + unit` guard is the only mechanical defense, and it is escaped by typing `wired`.

---

## 1. The harness contract

A behavior's verify harness must be four things. Only the first exists today (as prose in
`behaviors.verify`).

1. **Addressable** — a runnable command, not a description. `harness_ref` on the behavior, e.g.
   `pnpm vitest run test/provenance/lb-21-b1.wired.test.ts`.
2. **Executed by loopbreaker, not reported to it** — a new `loopbreaker prove BEHAVIOR` runs the
   ref, captures exit code + stdout digest + duration, and writes the evidence row itself. The
   agent's role becomes *building* the harness, never *scoring* it.
3. **Discriminating (red-first)** — before implementation is admitted, the harness must **fail**
   against current HEAD. A harness that is green before the work exists proves nothing; it is the
   evidence-layer equivalent of a shape field with no human behind it. Record a `baseline_red`
   attestation naming the HEAD sha it failed at.
4. **Tier-honest** — the tier is *derived from what the harness touches*, not declared: in-process
   import → `unit`; real CLI/MCP subprocess or HTTP surface → `wired`; deployed target → `live`.

Three mechanisms port directly from Rordi (verified in `/data/projects/rordi` at `faba77fe8`):

- **`not_run` as the fail-closed default.** Rordi's `evidence_verdict` option set is
  `not_run | pass | fail`, and `not_run` never counts toward a gate. Loopbreaker's `Verdict` is
  `"pass" | "fail"` only (`src/types.ts:3`) — an unrun harness has no honest representation, so
  absence gets encoded as one of the two decided states. Add `not_run`.
- **`behavior_evidenced` as a guard predicate.** Rordi guards the `implemented → verified` edge on
  `BEHAVIOR_STATUS_MACHINE` with a fail-closed predicate
  (`apps/orchestrator/src/lib/behavior-evidenced-predicate.ts`): true iff ≥1 `supported_by` edge to
  an evidence entity with `verdict === 'pass'`, or the behavior's own claim verdict is `verified`.
  Its stated rule — *"couldn't observe passing evidence" is never treated as "passes"* — is exactly
  what `verifyBehavior` currently violates by trusting the asserted verdict.
- **The demote migration.** Rordi shipped `0159-demote-unbacked-verified-behaviors.ts` alongside the
  gate, retroactively demoting behaviors that had reached `verified` by bare assertion. Loopbreaker
  needs the same honesty pass over LB-16 and LB-18 rather than grandfathering them.

---

## 2. Phase A — bootstrap the harness (no loopbreaker code changes)

Target: **LB-21** (provenance stamping). Chosen because it is the cheapest admitted issue, it
unblocks LB-22 and LB-25, and its subject matter — recording *which ingress caused a write* — is
itself the thing that makes executed evidence distinguishable from asserted evidence.

LB-21 is `100/100 ready`, planning-review `approved` at pass 3, and carries **six enforced
behaviors, every one demanding `wired` proof**, all `pending` with zero evidence:

| Behavior | What its harness must actually drive |
|---|---|
| B1 | all ten writers through real CLI **and** MCP ingresses; read back all ten tables; assert the triple on every row version, incl. both profile setters and both status UPDATEs |
| B2 | identical mutation via CLI and via MCP → exactly `cli` and `mcp`; source-scan that no hook path invokes a writer |
| B3 | CLI write with `LOOPBREAKER_ACTOR` set and unset, plus one MCP write → exact `triggered_by`, `trigger_data` subcommand object vs `null` |
| B4 | the DEMO-1 finding action over real HTTP; source-scan for any remaining raw domain-row write |
| B5 | seed a disposable DB through all ten writers; assert the triple per record type in a live substrate response over CLI **and** MCP |
| B6 | render a node; observe the provenance footer |

Phase A deliverable, done by hand:

1. Write all six harnesses as real subprocess/HTTP drivers against a disposable DB. None may import
   the domain in-process — the contract says `wired`, and B1/B2/B3/B5 explicitly name both ingresses.
2. Run each against current HEAD and **record that it fails**, with the failure message. Six red
   baselines, one per behavior.
3. Any harness that passes red-first is a broken harness — it is not testing what the behavior says.
   Fix the harness before touching production code.

This phase is deliberately manual. It is the bootstrap: do it once by hand, see what the mechanism
has to be, then mechanize it in Phase C rather than guessing the mechanism first.

## 3. Phase B — implement LB-21 to green, and ship it

Implement the twelve write sites per the approved `production_wiring`, turn each harness green, and
record evidence **from the harness run** (exit code and captured output, transcribed by hand this
phase since `loopbreaker prove` does not exist yet — note the transcription honestly in `source`).
Then verify all six behaviors and take the ship decision.

This is loopbreaker's first genuine six-stage traversal: shape → planning → planning-review →
implementation → executed evidence → ship. LB-16 and LB-18 only traversed the first four.

## 4. Phase C — LB-27: mechanize the harness gate

Turn Phase A's hand discipline into the gate. Scope: `harness_ref` on behaviors; `loopbreaker prove`
as the only writer of evidence verdicts; `not_run` verdict with fail-closed semantics; `baseline_red`
attestation required before implementation admission; tier derived rather than declared; a demote
pass over already-`verified` behaviors.

Shape and plan it through loopbreaker itself. Its own behaviors get Phase-A treatment — harness red
first, then implementation.

## 5. Phase D — LB-28: grains and domains

**Why the queue is jammed.** Eight issues sit admitted-but-unimplemented, each with ~5 enforced
behaviors each demanding wired proof. That is ~40 wired harnesses standing between the backlog and
any ship. The gate is not wrong; it is *unmodulated* — every behavior in every issue carries an
identical proof obligation. Rordi's recent invariant work is precisely the fix, and it does not
weaken the gate; it gives the gate axes.

- **Domain.** `behavior_domain` (RD-4473, `0160-behavior-domain-converge-and-backfill.ts`) is an
  option set assigned by a **pure, deterministic, conservative keyword classifier** that proposes a
  domain only on an unambiguous single-domain match — ambiguous cases are left **unset for founder
  review, never force-guessed, never auto-stamped `other`**. That conservatism is the whole design:
  the classifier is allowed to be silent, never to be confidently wrong. Rordi runs it alongside a
  separate technical `canon_domain` catalog (durability/fidelity/security/privacy/tenancy/
  performance/cost/reliability/velocity/ux). The proof bar should be a function of domain — a
  `substrate` behavior and a `ux` behavior do not warrant the same wired obligation.
- **Grain.** Migration `0147-remint-interview-skills-batched-rounds.ts` encodes a *grain split*:
  an initiative gets **one batched ≤4-question ask**; an epic gets the **exhaustive interview in
  batched rounds**. This is the real root cause behind LB-25. `shape-strategy`'s "do not conduct an
  exhaustive interview, batch at most four questions" is not a wrong policy — it is an
  **initiative-grain policy applied at issue grain**. The fix is to bind interview depth to grain,
  which needs **LB-23 tiers** to have somewhere to hang. LB-25's later slices already depend on
  LB-23; this makes that dependency the point rather than a scheduling detail.
- **Advisory as derived, not declared.** Loopbreaker's `advisory: true` is an author-set per-behavior
  boolean — i.e. the exact lever an agent can pull to walk out of the gate it finds inconvenient.
  Rordi's org-canon gate (RD-4516) is advisory *by construction*: it nudges through a health rollup
  instead of blocking. Derive enforcement from domain × grain and the discretion disappears.
- **Multiplicative health.** `org-canon-health.ts` computes `coverage × conformance × freshness ×
  coherence` — a **product**, so no term can be averaged away. Loopbreaker's planning health is
  5 × 20 additive against a threshold of 80, with hard blockers carrying the conjunctive weight
  separately. Worth checking whether a dimension can score 0 while the issue still reads `ready`;
  if so, the product form is the cleaner primitive. *(Open question, not yet verified.)*

---

## 6. The eval project

Reuse the existing pattern rather than inventing one: `/data/projects/rordi-eval-sandbox` is a
disposable target repo whose README states an explicit **disposability contract** — any `eval/*`
branch force-deletable, `main` force-resettable, `scripts/reset.sh` idempotent and guarded so it
refuses to run unless the `origin` URL matches the sandbox. Loopbreaker's eval needs the same
shape, plus one thing Rordi's does not have: a **labeled corpus with ground truth**.

**Arms.** (A) unbounded agent review, no loopbreaker. (B) loopbreaker-gated. Same model, same
scenarios, same seeds.

**Corpus.** Seeded scenarios, each carrying ground truth about what is wrong and where.

| Claim | Scenario seed | Primary metric | Depends on |
|---|---|---|---|
| Bounding stops review loops | a P1 whose plausible repair introduces a new P2 — the canonical cycling trigger | passes-to-terminate; **whether arm A terminates at all** | nothing (measurable now) |
| Premise gate catches injection | a shape with one unsourced field, in the LB-20 tailnet pattern | refusal rate on injected fields, **plus a negative control**: a fully founder-sourced shape, to catch a gate that simply refuses everything | LB-25 **implemented** (today only shaped/planned) |
| Gates catch real defects | plans with a seeded planning defect — unowned behavior, unwired proof, absent rollback | precision/recall of planning-health + planning-review vs. ground-truth labels | nothing (measurable now) |
| Cost and honesty of the verdict | full issues run end-to-end per arm | tokens, wall-clock, and **false-ship rate** = declared-shippable ∩ actually-has-unverified-enforced-behavior | **LB-27** — see below |

**The honesty metric is blocked on Phase C.** Measuring whether loopbreaker's ship verdict tracks
ground truth requires evidence the agent under test cannot author. Today it can. Running claim 4
before LB-27 would measure the agent's willingness to self-report, not the gate.

**Free real data.** LB-21's own planning-review history is already a ground-truth datapoint: two
`changes_required` passes on a genuine mutation-inventory inconsistency (`LB-21-PLAN-F1`), converging
at pass 3. LB-20's tailnet finding is a documented, real premise-injection instance with a known
correct verdict. Both are corpus entries that cost nothing to create because they actually happened.

**The eval executor and the behavior harness are the same machine.** `loopbreaker prove` runs a ref
and scores by exit code; an eval scenario runs a ref and scores against ground truth. Build one.

---

---

---

## 7. The interview gate already exists upstream

Correction to an earlier version of this plan, which priced the durable `hil_ask` primitive as a
build and cut it for that reason. It is a **port**, and the expensive part is already settled.

Rordi runs it in production — ~1,840 lines across `apps/orchestrator/src/rpc/router/hil.ts` (772),
`packages/api-contract/src/hil.ts` (416), and `apps/orchestrator/src/api/hil-resolve-link.ts` (652),
with recent fixes still landing (RD-4771, RD-4775). The semantics are decided and battle-tested:

- a durable entity (`type_slug: 'hil'`) that **waits indefinitely — no bounded timeout**;
- `blocking: true` parks the calling session in `waiting_gate`; the answer is delivered back as a
  new user message, so the agent's next turn continues *with* it;
- structured `options` render as tappable buttons on the inbox card;
- an attention spine fires at mint (RD-2196);
- kinds are `ratification | triage | commitment | interview | **attestation**` — **the LB-25 use
  case is already a first-class kind upstream.**

Even the failure modes are documented: `blocking` nested inside the `options` array was silently
accepted as a junk option while top-level `blocking` stayed `false`, so the session never parked and
no answer ever came back (the live RD-2051 gap). That now errors at the contract boundary. Designing
this primitive from scratch would mean rediscovering that class of bug.

What ports is the **contract and its guarantees**, not the code — loopbreaker has no Durable
Objects, no entity ontology, and no inbox UI. The flattened slice is a table with a park state, an
answer endpoint on the existing HTTP server, and a panel in the existing React app. Small, because
the hard question — *what must this primitive guarantee* — is answered.

And `rordi-interview` (`~/.claude/skills/rordi-interview/SKILL.md`) is the working gate on top of it:
build the decision tree first, one blocking ask per question, recommend with conviction, end the turn
and let the session park. It explicitly forbids the native `AskUserQuestion` because that tool
"renders only in a local terminal, times out, and is bypassed by some runner substrates."

### This session is the missing record

The premise decisions behind this plan were elicited through three rounds of native
`AskUserQuestion` — the exact tool the interview gate forbids. Those answers now exist only in a
chat transcript: not durable, not attributable, not queryable, and not bound to any shape field.
They are precisely the founder-issued records LB-25 is designed to require.

The session designing the discovery gate demonstrated why it is needed, by not having it.

This also **fixes the eval corpus for claim 2**. It does not need synthetic seeded premise
injections. A working interview gate emits a durable, provenance-stamped record for every premise
decision, and those are real data with real ground truth. Build the gate, and the corpus accrues as
a byproduct of using it.

### Premise decisions from this session (2026-07-25, ben@rordi.ai)

Recorded here because there is nowhere better yet. This is the seed fixture for LB-25 and the first
corpus entries for claim 2.

| Decision | Answer |
|---|---|
| What "the ontology builder" refers to | Loopbreaker's own delivery graph — shape → behaviors → planning → canon → tiers. Dogfooding means driving real issues through all six stages, not just the front half. |
| Dogfood depth | Depth-first: one issue all the way to `ship`. |
| Eval claims | All four: bounding stops loops, premise gate catches injection, gates catch real defects, cost and honesty of the verdict. Plus: adopt Rordi's grains/domains balancing. |
| Verify harness | Behaviors' verify harnesses must be bootstrapped and verified **before** implementation. |
| LB-25 | Promote into the dogfood line rather than leaving it a design argument. |
| The HIL channel | Use the already-built web app surface; do not drop the durable primitive. |
| Scheduling | Sequence by dependency, not by calendar days. |

---

## 8. The dependency chain

No calendar. These are the only real serializations; everything else runs in parallel.

```text
harness bootstrap (LB-21 × 6 wired, each RED at HEAD)
   └─> LB-21 implementation ──> GREEN ──> verify ──> SHIP        first full six-stage traversal
          │
          ├─> `loopbreaker prove` + not_run + baseline_red
          │        └─> demote pass over LB-16 / LB-18            ──> claim 4 result
          │
          └─> web ingress as a fifth trigger_type  (NEW ISSUE)
                 └─> hil_ask port: durable ask, park, answer-by-web, refuse-by-ingress
                        └─> interview gate ──> LB-25 field binding  ──> claim 2
```

Why each edge is real:

- **harness RED before implementation** — a harness that is green before the work exists proves
  nothing, so the red baseline has to be captured while the code is still absent.
- **LB-21 before the web ingress** — without provenance there is nothing to distinguish ingresses
  *with*.
- **web ingress before `hil_ask`** — if a browser answer is indistinguishable from a CLI write, the
  in-session agent can answer its own ask. The channel must be attributable before it is trusted.
- **`prove` before the demote result** — the demote count is only meaningful once evidence is
  executed rather than asserted.

Runs in parallel, needs nothing: the evidence-injection demo (works against `main` today), the
claim 1 and claim 3 writeups (LB-21's own review history is already the datapoint), and the
`rordi-parity.md` refresh for LB-19 / LB-26.

### The web ingress is a new issue, not an LB-21 amendment

`startServer(db, port)` takes the handle opened at `cli.ts:322`, so every web-originated write would
stamp `cli`. LB-21-B2 fixes `trigger_type` to *exactly* `cli | mcp | hook | plugin_hook`, and that
contract froze when planning review approved at pass 3 — there is no pass 4.

So `web` cannot be slipped into LB-21. It opens as its own issue and goes through shape → planning →
planning review like anything else. That is the freeze doing its job: refusing a quiet contract
widening at the moment it was most convenient to make one. Worth showing in the talk, with the audit
trail, rather than hiding behind a clean run.

Also relevant to that issue's shape: `demoAction` (`src/server.ts:59`) throws `demo_action_forbidden`
for any issue but `DEMO-1` and is a hardcoded switch of four verbs, and `web/src/` contains **zero**
`<input>`, `<textarea>`, or `onSubmit` — every interaction today is a button. The HTTP mutation path
exists; a general answer-submission surface does not.
---

## 9. Discovery becomes stage zero

Scope decisions (2026-07-25, ben@rordi.ai): the interview runs with the **native
`AskUserQuestion`** — no durable inbox needed for the questions themselves. Everything stays in
**this repo**; no separate eval repo yet. The HIL primitive shrinks to **one job: the durable
approval that advances the stage.**

That is the right place to spend the durability budget. The interview *content* can be in-session,
because it is recorded and re-readable. The *approval* cannot be, because it is the one act an agent
must not be able to issue on its own behalf.

The pipeline goes from six ordered authorities to seven:

```text
0. DISCOVERY   interview walks the decision tree → discovery record → founder approval  ← NEW
1. shape       derives from the approved record
2. planning
3. planning review
4. implementation
5. evidence    executed, not asserted
6. ship
```

**The gate:** a shape cannot reach `proceed` without an approved discovery record for its issue.
Drafting a shape stays legal — deriving one from the record is exactly what the agent should do.
What is refused is `proceed` on a premise no human ever approved.

### This retires the LB-25 root cause by restructuring, not by adding a check

`skills/shape-strategy/SKILL.md:31` currently reads:

> Ask only for product judgment that cannot be learned from available context. Batch at most four
> independent questions. … Do not conduct an exhaustive interview for a broad initiative.

Memory recorded this as the licensing defect — the instruction that let an agent-invented premise
through. With a discovery stage above it, **that instruction becomes correct.** Shaping is no longer
where premises are elicited; it is where an already-approved premise gets projected into shape
fields. A shaping agent *should not* be interviewing, because the interview already happened one
stage up and was signed off. The defect was never the sentence — it was that nothing stood above it.

This is also the [grain split](rordi-parity.md) landing in loopbreaker's own vocabulary: exhaustive
interview at discovery, four confirming questions at shape. Same rule Rordi encodes as
initiative-vs-epic depth, expressed as stage depth instead.

### Simpler binding than LB-25 contracts

LB-25 specifies **field-isomorphic** binding: every required shape field must equal an answer
provably originating from the founder through a channel the agent does not mediate. Stage-zero
approval is weaker — one human approval over the whole record, not per-field value-binding.

So this is **a new issue, not LB-25**, for the same reason `web` could not be slipped into LB-21:
LB-25's contract froze on planning-review approval at pass 3. Substituting a wholesale approval for
field-isomorphic binding is exactly the kind of convenient narrowing the freeze exists to refuse.
LB-25 stays on the books as the stronger gate; stage zero is the shippable slice beneath it.

That is now **twice in one session** that the freeze has caught a convenient substitution — the web
ingress and this. Both are talk material, with the audit trail to back them.

### Named residual risk

Until the `web` ingress lands, an in-session agent can invoke whatever command records the approval,
because CLI and web are indistinguishable in provenance. Ship stage zero with that risk **named**,
the way LB-25's own shape names its token-exfiltration risk — not hidden behind the word "approved."
The web ingress hardens it afterward; it is not a prerequisite.

### What stage zero needs

- a `discovery_records` table: issue_id, the question/answer walk, status `draft | approved`,
  `approved_by`, `approved_at`, and the LB-21 provenance triple;
- `shape_record` refusing `proceed` when no approved record exists, by name;
- one durable approval act, distinguishable from an agent's own writes as soon as `web` exists;
- a seventh skill — the interview — sitting above `shape-strategy`, and `orchestrate-delivery`
  (`SKILL.md:33`) updated to drive it first;
- `delivery_readiness` gaining discovery as the first ordered authority, ahead of shape.

Existing issues are grandfathered, as LB-25's shape already provides for.
