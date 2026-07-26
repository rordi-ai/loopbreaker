/**
 * LB-27 — the executed-evidence path.
 *
 * Kept in its own module so `domain.ts` never imports the runner: the domain
 * layer decides what evidence *means*, this decides how a run *produces* it.
 *
 * The one invariant here: nothing in this file accepts an outcome from a caller.
 * A caller chooses which registered harness runs; the exit code decides the rest.
 */

import type { LoopbreakerDb } from "./db.js";
import { DomainError, recordEvidence } from "./domain.js";
import { loadRegistry, resolveHarnessFor, runDigest, runHarness, type HarnessEntry } from "./harness.js";
import type { Substrate, Verdict } from "./types.js";

export interface ProveResult {
  behavior_id: string;
  harness: HarnessEntry;
  verdict: Verdict;
  exit_code: number | null;
  duration_ms: number;
  reason: string;
  substrate: Substrate;
}

export function proveBehavior(
  db: LoopbreakerDb,
  behaviorId: string,
  options: { registryPath?: string; live?: boolean; cwd?: string } = {},
): ProveResult {
  const behavior = db.raw.prepare(
    "SELECT id, issue_id, harness_ref FROM behaviors WHERE id = ?",
  ).get(behaviorId) as { id: string; issue_id: string; harness_ref: string | null } | undefined;
  if (!behavior) throw new DomainError("behavior_not_found", `Behavior ${behaviorId} does not exist.`);

  const registry = loadRegistry(options.registryPath);
  // Both directions must agree: the behavior names the harness, and the
  // harness consents to the behavior. See resolveHarnessFor.
  const harness = resolveHarnessFor(registry, behavior.id, behavior.harness_ref);
  const run = runHarness(harness, { live: options.live, cwd: options.cwd });

  // The verdict is a function of the exit code alone. A harness that could not
  // be executed yields `not_run` — never a decided outcome, because failing to
  // observe a pass is not the same as observing a failure.
  const verdict: Verdict = run.exitCode === null ? "not_run" : run.exitCode === 0 ? "pass" : "fail";

  const substrate = recordEvidence(db, {
    issueId: behavior.issue_id,
    behaviorId: behavior.id,
    // Tier comes from the registry entry, never from the caller.
    tier: harness.tier,
    verdict,
    summary: `${harness.purpose ?? harness.id}: ${run.reason} ${runDigest(run)}`.trim(),
    source: `${harness.runner}:${harness.target}`,
    executed: true,
    harnessId: harness.id,
    exitCode: run.exitCode,
  });

  return {
    behavior_id: behavior.id,
    harness,
    verdict,
    exit_code: run.exitCode,
    duration_ms: run.durationMs,
    reason: run.reason,
    substrate,
  };
}
