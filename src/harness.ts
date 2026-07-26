/**
 * LB-27 — the harness registry.
 *
 * A behavior's `harness_ref` names an entry id here; it never stores a command.
 * That is the whole containment story: `prove` executes something, so the set of
 * executable things must be a reviewable file in the repository rather than an
 * opaque string an agent can write into the database.
 *
 * Adding a harness is a code change that shows up in a diff. Pointing a behavior
 * at one is a data change. Modelled on rordi's `scripts/verify/INDEX.md`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { EvidenceTier } from "./types.js";
import { DomainError } from "./domain.js";

export const DEFAULT_REGISTRY = "harnesses.json";

/** A registered harness. `tier` here is what makes evidence tier honest — the caller never supplies it. */
export interface HarnessEntry {
  id: string;
  tier: EvidenceTier;
  runner: "vitest-wired" | "script";
  /** Path to the test file or executable, resolved against the repository root. */
  target: string;
  /**
   * The behavior ids this harness CONSENTS to prove.
   *
   * Binding takes two independent acts: a behavior names a harness
   * (`harness_ref`, a data change an agent can make) and the harness names the
   * behavior back (this list, a code change that shows up in a diff). Without
   * the second, an agent could bind any behavior to a trivially-passing entry
   * and verify it — the registry would constrain *what can be named* but not
   * *what a behavior names*.
   *
   * Fail-closed: an entry with no `proves` consents to nothing.
   */
  proves?: string[];
  purpose?: string;
  prerequisites?: string[];
}

export interface HarnessRegistry {
  path: string;
  harnesses: HarnessEntry[];
}

const TIERS = new Set(["unit", "wired", "live"]);
const RUNNERS = new Set(["vitest-wired", "script"]);

export function loadRegistry(registryPath = DEFAULT_REGISTRY): HarnessRegistry {
  const path = resolve(registryPath);
  if (!existsSync(path)) {
    throw new DomainError("registry_missing", `No harness registry at ${path}.`, "Create harnesses.json, or pass --registry PATH.");
  }
  let parsed: { harnesses?: unknown };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new DomainError("registry_unreadable", `Harness registry ${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed.harnesses)) {
    throw new DomainError("registry_invalid", `Harness registry ${path} has no harnesses array.`);
  }
  const harnesses = parsed.harnesses.map((raw, index) => {
    const entry = raw as Partial<HarnessEntry>;
    if (!entry.id) throw new DomainError("registry_invalid", `Harness entry ${index} has no id.`);
    if (!entry.tier || !TIERS.has(entry.tier)) {
      throw new DomainError("registry_invalid", `Harness ${entry.id} declares an unknown tier: ${String(entry.tier)}.`);
    }
    if (!entry.runner || !RUNNERS.has(entry.runner)) {
      throw new DomainError("registry_invalid", `Harness ${entry.id} declares an unknown runner: ${String(entry.runner)}.`);
    }
    if (!entry.target) throw new DomainError("registry_invalid", `Harness ${entry.id} declares no target.`);
    return entry as HarnessEntry;
  });
  return { path, harnesses };
}

export function resolveHarness(registry: HarnessRegistry, id: string | null | undefined): HarnessEntry {
  if (!id) {
    throw new DomainError(
      "harness_ref_missing",
      "This behavior declares no harness_ref, so there is nothing to execute.",
      "Register a harness in harnesses.json and set harness_ref on the behavior.",
    );
  }
  const entry = registry.harnesses.find((harness) => harness.id === id);
  if (!entry) {
    throw new DomainError(
      "harness_not_registered",
      `No harness registered under the id ${id}.`,
      `Add ${id} to ${registry.path}, or point the behavior at an existing entry.`,
    );
  }
  return entry;
}

/**
 * Resolve the harness for a behavior, requiring BOTH directions of the binding:
 * the behavior names the harness, and the harness consents to that behavior.
 */
export function resolveHarnessFor(registry: HarnessRegistry, behaviorId: string, harnessRef: string | null | undefined): HarnessEntry {
  const entry = resolveHarness(registry, harnessRef);
  if (!entry.proves?.includes(behaviorId)) {
    throw new DomainError(
      "harness_does_not_prove_behavior",
      `Harness ${entry.id} does not consent to prove ${behaviorId}.`,
      `Add ${behaviorId} to the \`proves\` list of ${entry.id} in ${registry.path}. That is a reviewed code change by design: it is what stops a behavior being pointed at a harness that cannot fail for it.`,
    );
  }
  return entry;
}

export interface HarnessRun {
  /** Null when the harness could not be executed at all — recorded as `not_run`, never as a decided verdict. */
  exitCode: number | null;
  output: string;
  durationMs: number;
  reason: string;
}

/**
 * Execute a registered harness. The verdict is derived from the exit code by the
 * caller; nothing here accepts a caller-supplied outcome.
 *
 * A live-tier harness refuses to run without an explicit opt-in, mirroring
 * rordi's `--i-understand-this-is-live` guard: a live proof can touch a deployed
 * target, so running one must be a deliberate act.
 */
export function runHarness(entry: HarnessEntry, options: { live?: boolean; cwd?: string } = {}): HarnessRun {
  const cwd = options.cwd ?? process.cwd();
  if (entry.tier === "live" && !options.live) {
    throw new DomainError(
      "live_opt_in_required",
      `Harness ${entry.id} is live-tier and was not given an explicit live opt-in.`,
      "Re-run with --live once you intend to drive the live target.",
    );
  }

  const target = isAbsolute(entry.target) ? entry.target : resolve(cwd, entry.target);
  const started = Date.now();

  if (!existsSync(target)) {
    return {
      exitCode: null,
      output: "",
      durationMs: Date.now() - started,
      reason: `Harness target does not exist: ${target}`,
    };
  }

  const [command, args] = entry.runner === "vitest-wired"
    ? ["npx", ["vitest", "run", "--config", "vitest.wired.config.ts", target]]
    : [target, []];

  const result = spawnSync(command, args as string[], { cwd, encoding: "utf8", timeout: 600_000 });

  if (result.error) {
    return {
      exitCode: null,
      output: String(result.stderr ?? ""),
      durationMs: Date.now() - started,
      reason: `Harness could not be executed: ${result.error.message}`,
    };
  }

  return {
    exitCode: result.status ?? null,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    durationMs: Date.now() - started,
    reason: result.status === 0 ? "Harness exited 0." : `Harness exited ${result.status}.`,
  };
}

/** A compact digest of what the run produced, for the evidence summary. */
export function runDigest(run: HarnessRun): string {
  const tail = run.output.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
  return tail.length > 400 ? `${tail.slice(0, 400)}...` : tail;
}
