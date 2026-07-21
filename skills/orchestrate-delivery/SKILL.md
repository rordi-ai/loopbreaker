---
name: orchestrate-delivery
description: Orchestrate a full Loopbreaker delivery as a three-role meta-agent system - a root orchestrator holding all state authority, isolated per-work-unit implementation workers, and an independent cross-vendor CLI reviewer that records its own findings over MCP. Use when a feature spans multiple work units, when implementation should fan out into parallel worktrees, or when review independence must be structural rather than promised.
---

# Orchestrate Delivery

Run the delivery pipeline as three separated roles so that no context ever grades
its own work. The frozen behavior contract is the only interface between them.

## Roles

1. **Root orchestrator** — the session reading this skill, on the strongest
   available model (Claude Code: Fable). It owns gate checks, contract imports,
   worktree merges, evidence recording for integration-level proof, and the ship
   conversation. It does not implement work units and never records review passes
   for changes it authored.
2. **Implementation workers** — one subagent per work unit on a Sonnet-class
   model, each in its own git worktree (Claude Code: spawn the `impl-worker`
   agent with `isolation: "worktree"`). A worker receives the issue ID, its one
   work unit, the enforced behaviors it owns, and the proof plan. It implements,
   tests, and reports; it must not edit behavior children, planning state, or
   review state.
3. **Independent reviewer** — the Codex CLI, a different vendor and model family,
   invoked non-interactively with the Loopbreaker MCP server injected. It runs
   `review-planning` before implementation and `review-invariants` after, and it
   records its own passes, findings, and evidence directly over MCP. Follow
   [references/codex-review.md](references/codex-review.md) exactly for the
   pinned invocation; do not improvise flags.

## Protocol

1. **Gate.** Call `delivery_readiness`. Drive `shape-strategy`, `plan-feature`,
   and an independent `review-planning` (via the reviewer role) until
   `implementation.admitted` is true. Never start workers before admission.
2. **Fan out.** Spawn one worker per work unit in parallel. Give each the frozen
   contract excerpt it owns, verbatim. Workers changing scope report back for a
   contract decision; they do not resolve it locally.
3. **Integrate.** Merge worktrees, run the repository verification, and record
   attributable evidence with `review_record_evidence` for proof the orchestrator
   directly observed.
4. **Review.** Invoke the reviewer for pass 1. Repair findings by re-dispatching
   the owning worker with the finding's smallest fix, then invoke the reviewer
   for pass 2, and pass 3 as decision only. Three passes bound both review
   stages; there is no pass 4.
5. **Ship.** Read `review_ship_status` and copy its disposition literally. Review
   completion never implies shipping readiness. A human authorizes any waiver.

## Separation rules

- See [state authority](../shared/state-authority.md): state lives in Loopbreaker,
  not in any transcript, and every role is bound by that discipline.
- The orchestrator may summarize reviewer output but must not filter, soften, or
  re-record it; reviewer findings enter the database only from the reviewer.
- Worker output is a proposal until the orchestrator merges it and evidence is
  recorded; a worker saying "done" is not evidence.
- If the reviewer cannot run (offline, missing CLI), stop and say so. Falling
  back to self-review silently is a protocol violation.
