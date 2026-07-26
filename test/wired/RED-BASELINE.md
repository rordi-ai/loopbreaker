# LB-21 wired-harness red baseline

Recorded **2026-07-25** against **`1ac3ffa`** (`chore: stop committing entity data`), before any
LB-21 production code was written.

This file is the hand-kept form of the `baseline_red` attestation that LB-27 will mechanize. Its
purpose is to make the harnesses' discrimination checkable rather than asserted: a harness that is
green before the work exists proves nothing, so the red has to be recorded while the code is absent.

```sh
pnpm build && pnpm test:wired
```

## Result

**37 failed · 4 passed (41 assertions across 6 harnesses)**

Every failure is the absence of `trigger_type` / `triggered_by` / `trigger_data` — the exact columns
and readouts LB-21 exists to add. No harness failed on setup, a missing fixture, or a broken driver.

## The four assertions that pass, and why that is correct

These are preconditions, not the behavior under test. They must be green today, and their greenness
is what proves the harnesses fail for one reason only.

| Harness | Passing assertion | What it establishes |
|---|---|---|
| B1 | wrote at least one row version into every one of the ten tables | the fixture really does drive all ten writers through real CLI + MCP ingresses |
| B2 | no hook path invokes a writer (source scan) | already true at `1ac3ffa`; this is a regression guard on B2's "hooks are read-only" claim, not a new capability |
| B5 | returns a substrate over both ingresses | the read model responds on both surfaces before provenance is added to it |
| B6 | serves a substrate the canvas can build from | `buildReviewGraph` maps the HTTP substrate into nodes |

## Per-behavior red

| Behavior | Assertions | Red | Fails because |
|---|---|---|---|
| LB-21-B1 | 14 | 13 | no provenance columns on any of the ten domain tables; both profile-setter rows and both behaviour-status progressions unstamped |
| LB-21-B2 | 4 | 3 | `trigger_type` absent, so neither `cli` nor `mcp` can be observed on the two identical mutations |
| LB-21-B3 | 4 | 4 | `triggered_by` / `trigger_data` absent, so no actor fallback or subcommand payload exists |
| LB-21-B4 | 3 | 3 | the demo finding UPDATE is unstamped, and the raw `UPDATE findings` at `src/server.ts:72` still bypasses the domain layer |
| LB-21-B5 | 12 | 11 | `substrate()` exposes no provenance for any record type over CLI or MCP |
| LB-21-B6 | 4 | 3 | the HTTP substrate carries no provenance, so no node footer can render it |

## Harness constraints

- Every mutation is produced through a **real ingress** — a spawned `dist/cli.js`, a real MCP stdio
  client against `mcp/server.bundle.mjs`, or HTTP against a spawned `loopbreaker serve`. No harness
  imports the domain in-process to write. Reading the database to assert is permitted; the
  constraint is on how writes are produced.
- The suite is excluded from `pnpm test` / `pnpm verify` via `vitest.config.ts`. A pending contract
  is not a regression and must not break the repository's gate. `pnpm test:wired` runs it.
- Requires a current build; the harnesses spawn built artifacts and fail loudly if they are missing.

## Known gap, recorded rather than glossed

**LB-21-B6 does not mount React.** The repository has no DOM test stack, so the harness drives the
real HTTP surface and runs the result through `buildReviewGraph` — the mapping the canvas renders
from — but does not assert painted output. B6's contract says "render a node and observe the
provenance footer." If that means the mounted component, this harness must be upgraded before its
evidence counts. Recording it as-is would overstate what was observed.

## Two things the harnesses surfaced about the current code

1. `findings` has **no CLI writer**. The review-finding path is reachable only through MCP
   (`review_upsert_finding`) or the DEMO-1 HTTP action, which is why the B1 fixture must use both
   ingresses to reach all ten tables.
2. `src/server.ts:118` already calls `broadcast(issueId, "browser")` — the server names the browser
   as an event *source* today, while its writes are stamped with whatever ingress opened the handle.
   Relevant to the `web` trigger_type issue.

---

# Green

Recorded **2026-07-25**, after LB-21's twelve write sites were implemented.

```sh
pnpm build && pnpm test:wired
```

**40 of 41 assertions pass.** Each behavior's harness was run in isolation to produce its evidence:

| Behavior | Harness | Result | Disposition |
|---|---|---|---|
| LB-21-B1 | `test/wired/lb-21-b1.test.ts` | exit 0, 14/14 | verified |
| LB-21-B2 | `test/wired/lb-21-b2.test.ts` | exit 0, 4/4 | verified |
| LB-21-B3 | `test/wired/lb-21-b3.test.ts` | exit 0, 4/4 | verified |
| LB-21-B4 | `test/wired/lb-21-b4.test.ts` | 2/3 | **waived** (named debt) |
| LB-21-B5 | `test/wired/lb-21-b5.test.ts` | exit 0, 12/12 | verified |
| LB-21-B6 | `test/wired/lb-21-b6.test.ts` | exit 0, 4/4 | verified (advisory) |

Ship disposition: **`ship_with_debt`** — 5 enforced, 4 verified, 1 waived.

## The evidence is hand-transcribed, and its `source` says so

`loopbreaker prove` does not exist yet (Phase C / LB-27). So each evidence row was recorded by a
human-run command quoting the harness ref and its exit code, and every `source` string ends with
`(hand-transcribed; loopbreaker prove does not exist yet)`.

That is the honest state, and it is exactly the gap LB-27 closes: the verdict still originates from
a caller's assertion *about* a run, not from the run itself. The harnesses being real and red-first
is what makes the assertion trustworthy here; it is not a substitute for executing them.

## Why B4 was waived rather than fixed

B4's architectural clause — *no raw INSERT, UPDATE, or DELETE of a domain row outside
`src/domain.ts` and the db.ts setters* — is unmet for `src/seed.ts` alone.

Provenance itself is **not** bypassed: `server.ts`'s raw `UPDATE findings` now routes through
`upsertFinding`, and seed's six raw INSERTs carry the triple. What remains unmet is the structural
clause, because `seedDemo` deliberately fabricates a state the gated domain writers cannot legally
produce — behaviors pre-set to `verified`, `legacy_pass_count: 13`, review passes that never passed
a gate. Routing it through those writers is not available without destroying the fixture.

Founder decision (ben@rordi.ai, 2026-07-25): accept as named debt. The alternative on the table was
relocating the fixture writer into `domain.ts`, which would satisfy the path check by moving the
path. Declining that, and declining to narrow the harness scan, is the point — adjusting the test
until it passes is the failure mode this phase exists to prevent.

## One harness bug the scan caught in itself

The raw-write regex matched the *comment* left behind describing the removed `server.ts` write. The
scan was flagging its own documentation. Fixed by skipping comment lines — worth recording, because
a harness that reports a violation it invented is as dishonest as one that misses a real one.

---

# LB-27 red baseline

Recorded **2026-07-25** against **`09e7523`**, before any LB-27 code was written.

```sh
pnpm test:wired -- test/wired/lb-27-*.test.ts
```

**24 failed · 2 passed · 0 skipped (26 assertions across 6 harnesses)**

The two passes are genuine preconditions: `harnesses.json` exists and every entry declares a valid
tier, runner and target. Everything else fails because `prove`, `demote`, `harnesses`, the
`executed` / `exit_code` / `harness_id` / `baselined` columns, and the not-executed verify gate do
not exist yet.

## Design, from the stage-zero interview (ben@rordi.ai, 2026-07-25)

| Decision | Answer |
|---|---|
| What `harness_ref` points at | A **registry entry id** in `harnesses.json`, never a command. The registry declares id, tier, runner, target and prerequisites. Adding a harness is a reviewable code change; pointing a behavior at one is a data change. Live-tier entries require an explicit opt-in. Modelled on rordi's `scripts/verify/INDEX.md`. |
| Red-baseline enforcement | **Warn but record.** A pass with no recorded red baseline is flagged `baselined: 0` in the read model rather than refused — refusing would strand every behavior whose code already exists, since a red baseline cannot be observed retroactively. |
| Demote | **Dry-run first, apply on command.** `demote --dry-run` names exactly what would lose verified status and changes nothing; `--apply` applies that set and is idempotent. |

The exec-surface decision was a correction to an earlier proposal of mine that would have locked
`harness_ref` to a vitest file under `test/wired/`. That would have made the **live tier
unreachable** — a live proof drives a real browser or a deployed target and cannot be a unit-runner
invocation. Loopbreaker has three tiers; the proposal served two.

## Six vacuous assertions, found and removed

The first run reported 13 failed / 8 passed. Six of those eight passes were **vacuous** — they
passed *because nothing existed*, not because anything held:

- `if (evidence.length > 0) { ... }` — no evidence, so the block never ran and the test passed.
- `Number(row?.executed ?? 0)` — no column, so the default supplied the expected value.
- "a caller-supplied `--tier` never reached the row" — trivially true against an empty table.
- "the dry run does not name `DEM-OK-B1`" — trivially true of an error payload.

Each was replaced with an explicit precondition that fails loudly when the substrate is empty. This
is exactly the defect the red baseline exists to catch, written into these harnesses by their own
author within an hour of documenting it. The discipline caught it; unexamined green would not have.

Five further tests were **skipped** rather than failed, because B6's `beforeAll` threw on the absent
`prove` command. A skipped test is not a recorded red — it is an absence of evidence in either
direction — so the setup was made tolerant so every assertion runs and fails on its own merits.
