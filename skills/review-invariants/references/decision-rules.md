# Bounded review decision rules

Apply all eight rules in order.

## 1. Freeze the ship contract

The issue's enforced behavior children are the acceptance surface. Parent strategy,
design prose, and reviewer preferences may explain them but cannot silently add
requirements. A genuinely new requirement requires explicit re-scoping.

## 2. Compute applicability deterministically

A candidate invariant applies when changed paths or required production-wiring paths
intersect its declared scope. Only explicit, current, enforced invariants can block.
An invariant without a usable scope becomes a proposal or debt item, not an immediate
blocker. Never use broad architectural taste as an implicit scope matcher.

## 3. Use a two-plus-one budget

- Pass 1 is comprehensive.
- Pass 2 verifies admitted repairs and repair regressions.
- Pass 3 is decision-only.
- Never authorize automatic pass 4.

A passing pass may end review early. Two failed repair attempts force a decision
packet; they do not expand the audit state space.

## 4. Make proof proportionate

Require one real wired or live capability proof for each enforced behavior. Add
lower-level fault injection only when the real layer cannot safely create the
failure. Do not automatically require unit, database, deployed, and browser proof
for every predicate. Reject proof from an unwired component or unrelated revision.

## 5. Separate severity from ship disposition

- P0: blocks because it is destructive, corrupting, or crosses a security boundary.
- P1: blocks only when the four-part blocker test passes.
- P2: non-blocking by default; block only when an explicit acceptance proof is absent.
- P3: debt.

The four-part blocker test requires all of:

1. Contract: name the exact enforced behavior or applicable invariant.
2. Reachability: show the current production path or reproducible interleaving.
3. Impact: show how the contract becomes materially false.
4. Closure: name the smallest in-scope repair and concrete proof; explain why a safe
   rollback or deferral does not preserve the claimed behavior.

Reject style, speculative risk, optional hardening, unrelated pre-existing debt,
future-proofing, and duplicate symptoms as blockers.

## 6. Replace convergence packets with a decision packet

After two failed repairs, report:

- reachability;
- impact;
- rollback or containment;
- smallest remaining repair;
- evidence already obtained and still missing.

A human chooses hold, split/re-scope, or ship with debt. The packet cannot authorize
another expanding review.

## 7. Make behavior status the shipping authority

Call `review_ship_status`. Shipping is:

- `ship` when every enforced behavior is verified;
- `ship_with_debt` when every unverified enforced behavior has an explicit waiver;
- `hold` otherwise.

Review verdicts are evidence supporting those states, never a parallel hidden gate.
Do not create a waiver on the human's behalf.

## 8. Keep watchers off by default

Do not start polling or scheduled review cycles from this skill. If a user explicitly
enables a watcher, require a stable target, bounded cadence, expiry, and completed-
slice trigger. Worktree dirtiness alone is not a review trigger. Stop automatically
when review completes, the expiry is reached, or the user moves on.
