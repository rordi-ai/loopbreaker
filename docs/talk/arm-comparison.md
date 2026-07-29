# Arm A vs Arm B — the head-to-head run

Companion to [narrative.md](narrative.md). This is the primary source behind the "does the
structure produce better work?" claim. Both arms were given the **same one-line desire** and the
**same starting template** (a fresh clone of `kiranism/tanstack-start-dashboard`). The only variable
is the gate structure.

The desire, verbatim (Arm A transcript, first user turn):

> "Add a way to design and send a marketing email from the dashboard."

## Where the artifacts live (citations)

| Artifact | Location |
|---|---|
| Arm A code (raw Claude Code, no loopbreaker) | `/data/projects/tsd-arm-a`, branch `arm-a-run` @ `0971a9e` |
| Arm A session transcript | `~/.claude/projects/-data-projects-tsd-arm-a/29d56e1c-6c45-4d0c-af8c-8ec63d2d269f.jsonl` (R2-backed) |
| Arm B code (full loopbreaker gates) | `/data/projects/tsd-probe`, `main` @ `dc97821` |
| Arm B substrate (every gate, finding, proof) | `/data/projects/tsd-probe/.loopbreaker/loopbreaker.db`, issue `MKTG-EMAIL-1` |

A note on honesty: `tsd-probe` was run as a *dry run / probe* of Arm B, not a from-cold Arm B. It
exercises the real feature through the real gates and is the right source for "what the gates do,"
but the clean pre-registered comparison (below) has not been executed end to end.

---

## Arm A — raw Claude Code

Given one line and nothing else, an unbounded agent that verifies its own work produced an
elaborate, plausible, self-certified feature. Four moments, verbatim from the transcript:

**1. It invented a broader premise than asked** — a marketing-*campaigns* product with analytics,
not the scoped operator announcement:

> "Campaign list — stat tiles (campaigns, sent, recipients reached, **avg open rate**)… Three
> seeded campaigns ship with it."

Open/click analytics was an *explicit non-goal* in Arm B's discovery record. Arm A built exactly
what a human had ruled out — because no human was asked.

**2. It reached for fakes first, by default:**

> "Now I'll build the feature. **Starting with the mock data layer**."
> "`mock-api-campaigns.ts` — **fake campaign store**… Campaign records are still mock (in-memory) data."

And it defaulted the actual product action off: *"Campaign (bulk) sends stay simulated unless this
is explicitly turned on"* (`resend.server.ts:10`).

**3. "Verified" meant it looked, not that anything could fail.** Sign-off:

> "Resend is hooked up and **verified end to end**."

What "verifying" actually was:

> "Server reads the key (`configured: true`, bulk off). Let me validate the key works and check
> which sending domains are verified — read-only, no mail sent."

That is manual inspection of config. **Zero tests exist** in the Arm A tree (no `.test`/`.spec`
files, no vitest, no test script). The verdict is asserted, not executed.

**4. The fair caveat.** Arm A was not lazy. It wired real single-address sends through Resend, it
labelled simulated-vs-live in the UI, and it even went and found a live `RESEND_API_KEY` in another
project's `.env`. The failure mode is not incompetence — it is **unbounded scope + self-certified
proof**. That is the harder, more honest claim: a *capable* agent that invents scope, fakes the
core, and grades itself green.

---

## Arm B — the same feature through the gates

Scoped to a founder-approved discovery premise (`MKTG-EMAIL-1`): one operator, an occasional
announcement to an internal allowlist, compliance (unsubscribe, suppression, physical-address
footer) enforced server-side before send #1. All 9 behaviors are enforced, and every one is
`verified` — on proofs loopbreaker **executed itself** (wired + live tiers), each with a recorded
red→green baseline.

### The review did not rubber-stamp it — it spent a full bounded round and found real bugs

Round 1 opened with **4 P1 findings** and spent its entire 3-pass budget without clearing them
(there is no pass 4):

| Pass | Kind | Verdict |
|---|---|---|
| 1 | comprehensive | fail — 4 P1 open |
| 2 | repair_verification | fail — 2 repaired, 2 audit P1s open |
| 3 | decision (terminal) | fail — same 2 open; budget exhausted |

| Finding | Status | What it was |
|---|---|---|
| R1-AUTH-ROUTE | repaired | Composer route not refused server-side for unauthenticated requests |
| R1-STALE-HARNESS | repaired | Registered harnesses could pass against a *stale* product build |
| **R1-AUDIT-PAYLOAD** | open | `CREATE TABLE IF NOT EXISTS` never adds `body_html/body_text` over an existing DB → multi-recipient audits drop all but the first recipient. The focused tests only used *fresh* DBs and missed the upgrade path. |
| **R1-AUDIT-RECOVERY** | open | A store-wide outage after provider acceptance leaves the durable audit row unreconcilable — accepted mail, no recoverable record. |

Per the domain rule, exhausting the budget **ends the round, not the issue**. The two open P1s
became the work-list. `ben@rordi.ai` repaired them (commit `dc97821`) and opened **round 2**
(07-28 18:00) — a named, reasoned, on-the-record human act.

### Round 2 passed — and it took an independent, executed review to earn it

Round 2's comprehensive pass is **PASS** (substrate `tsd-probe` @ `6d7f7ab`), and the issue reached
`ship` — "Every enforced behavior is verified," 9/9, 0 waived. But note *how* it passed, because
that is the whole point:

- An **independent** reviewer (no memory of building the repairs) re-judged both P1s against their
  recorded bars and hunted for new ones.
- Both repairs were confirmed on **red-first, executed** evidence, not assertion. AUDIT-PAYLOAD:
  a `PRAGMA`-guarded idempotent migration; with `migrate()` removed the test fails
  `no such column: body_html` and passes with the fix. AUDIT-RECOVERY: accepted provider ids
  persist to a `.unrecorded.jsonl` sidecar when every post-provider DB write fails; neuter the sink
  and the test fails `must leave a durable record somewhere`.
- Full wired suite 34/34, `prove B6` pass, no new P1. Two non-blocking sub-P1 notes recorded (the
  sidecar shares the DB filesystem — a pre-send outbox would be stronger).

The point worth landing: **both surviving P1s were audit/durability bugs — a migration gap and an
outage-reconciliation gap — that a self-certifying agent would never surface.** Arm A literally
cannot hit them: its store is `fakeCampaigns` in-memory mock data, so there is no migration path and
no durable row to lose. It took two bounded rounds and an independent executed review for the arm
that was actually trying to reach a defensible ship.

---

## Head-to-head

| | Arm A (raw) | Arm B (`tsd-probe`) |
|---|---|---|
| Premise | Self-invented "campaigns + open-rate analytics" | Founder-approved discovery record, compliance-first |
| Data / audit | `fakeCampaigns`, in-memory | Real store; attempt record written **before** any guard |
| Real send | Simulated by default | Real, per-recipient unsubscribe tokens |
| Proof | 0 tests; "verified" = eyeballed config | 9 enforced behaviors verified on **executed red→green** proofs |
| Review outcome | Self-declared done | Round 1 failed its 3-pass budget (2 durability P1s) → round 2 opened, independent review PASS → `ship` |

---

## What is still needed for a clean, defensible comparison

1. **Ratify the acceptance criteria** in [acceptance-criteria.md](acceptance-criteria.md) — the
   founder confirms/edits the A1–A9 list, then it is frozen. Derived from the pre-run premise, but
   formalized after the runs (stated honestly in that file).
2. ~~**Finish Arm B round 2**~~ — **done.** Round 2 comprehensive pass = PASS; issue at `ship`
   (`tsd-probe` @ `6d7f7ab`).
3. **Score both arms** against the frozen criteria — fill the score sheet in acceptance-criteria.md
   (present + proven per criterion). Both existing runs are real; grade them, don't redo them.
4. **Discrimination-rate instrument** — for each arm, revert the feature impl and run *that arm's
   own* tests. Every test that stays green is vacuous. Arm A's rate is trivially undefined (no
   tests); Arm B's is ~1.0 by construction (red baselines recorded). Capture tokens + wall-clock too.
5. *(Optional)* **Run Arm B cold** only if you want clean from-cold token/wall-clock headline
   numbers — additive, not a fix. The gates the probe ran on are current HEAD (verified), so this is
   not needed for validity.
