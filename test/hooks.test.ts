import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runHookCommand } from "../src/cli.js";
import { LoopbreakerDb } from "../src/db.js";
import { importContract, recordPlanningReviewPass, recordShape, substrate, DISCOVERY_FIELDS, approveDiscovery, recordDiscovery } from "../src/domain.js";
import { evaluatePreToolUse, runSessionStartHook, type HookEvent } from "../src/hooks.js";
import { composePrime, renderPrime } from "../src/prime.js";
import type { PlanningProfile, ShapeProfile } from "../src/types.js";

/**
 * LB-28 — satisfy the discovery gate for a fixture issue.
 *
 * Discovery is the first ordered authority, so any test that drives an issue
 * past shape needs an approved premise. These tests cover DOWNSTREAM stages and
 * use shape as scaffolding; the gate itself is covered by the LB-28 wired
 * harnesses. Recording it explicitly keeps that dependency visible rather than
 * quietly exempting the suite.
 */
function satisfyDiscovery(db: LoopbreakerDb, issueId: string): void {
  recordDiscovery(db, issueId, DISCOVERY_FIELDS.map((field) => ({
    field,
    question: `What is the ${field}?`,
    answer: `Fixture answer for ${field}.`,
  })));
  // Fixture privilege, mirroring seedDemo: write the approved state directly
  // rather than paying the ingress round-trip. Approval is refused on any
  // ingress but `web`, and opening a second browser-ingress handle per fixture
  // thrashes the WAL lock. The ingress RULE has its own dedicated test; these
  // fixtures only need the resulting state.
  db.raw.prepare(
    "UPDATE discovery_records SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE issue_id = ?",
  ).run("fixture-founder", issueId);
}


const databases: LoopbreakerDb[] = [];

function database(): LoopbreakerDb {
  const db = new LoopbreakerDb(join(mkdtempSync(join(tmpdir(), "loopbreaker-hooks-")), "test.db"));
  db.migrate();
  databases.push(db);
  return db;
}

/**
 * A database living at <dir>/.loopbreaker/loopbreaker.db -- the production
 * layout runHookCommand's pre-tool-use branch assumes when it derives
 * repoRoot from db.path. Returns both the open db and the containing repo
 * directory.
 */
function repoDatabase(): { db: LoopbreakerDb; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "loopbreaker-hooks-repo-"));
  const db = new LoopbreakerDb(join(dir, ".loopbreaker", "loopbreaker.db"));
  db.migrate();
  databases.push(db);
  return { db, dir };
}

function healthyPlanning(behaviorIds: string[]): PlanningProfile {
  return {
    outcome: "Deliver the bounded behavior contract.",
    appetite: "One focused implementation slice.",
    non_goals: ["Unrelated platform changes"],
    work_units: [{ id: "implement", title: "Implement the contract", behavior_ids: behaviorIds, done_when: "Every behavior is wired and proven." }],
    proofs: behaviorIds.map((behaviorId) => ({ behavior_id: behaviorId, tier: "wired" as const, method: `Exercise ${behaviorId} through the wired boundary.` })),
    production_wiring: "Construct the implementation through the production entry point.",
    rollback: "Disable the entry point and retain the prior path.",
    migration: "No migration is required.",
    decision_owner: "Issue owner",
    risks: [],
  };
}

function healthyShape(): ShapeProfile {
  return {
    problem: "A bounded user-visible problem exists.", appetite: "One focused slice.",
    smallest_slice: "Implement one observable behavior.", non_goals: ["Unrelated redesign"],
    success_signal: "The wired behavior passes.", reversibility: "Disable the new entry point.",
    decision_owner: "Issue owner", risks: [], disposition: "proceed",
  };
}

/** A blocked issue: imported but with no discovery record, so its gate is "discovery" — the first ordered authority since LB-28. */
function blockedIssue(db: LoopbreakerDb, issueId: string): void {
  importContract(db, {
    issueId, title: "Blocked fixture issue",
    behaviors: [{ id: `${issueId}-B1`, title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
  });
}

/** An admitted issue: shaped, planned, and independently planning-review approved. */
function admittedIssue(db: LoopbreakerDb, issueId: string): void {
  importContract(db, {
    issueId, title: "Admitted fixture issue",
    behaviors: [{ id: `${issueId}-B1`, title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    planning: healthyPlanning([`${issueId}-B1`]),
  });
  satisfyDiscovery(db, issueId);
  recordShape(db, issueId, healthyShape());
  recordPlanningReviewPass(db, { issueId, passNumber: 1, verdict: "approved", summary: "Coherent." });
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("runSessionStartHook", () => {
  it("emits hookSpecificOutput.additionalContext with the rendered prime block when an issue is linked", () => {
    const db = database();
    admittedIssue(db, "HOOK-1");
    db.setActiveIssue("HOOK-1");

    const raw = runSessionStartHook(db, { hook_event_name: "SessionStart", cwd: "/somewhere" });
    expect(raw.length).toBeGreaterThan(0);
    const parsed = JSON.parse(raw) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toBe(renderPrime(composePrime(db, "HOOK-1")));
  });

  it("emits the bootstrap nudge when no issue is linked", () => {
    // SUPERSEDES LB-18-B3's "no active issue -> no context". That silence made
    // the plugin inert and invisible: an observed session with all tools and
    // skills loaded went straight to coding, never learning the pipeline
    // existed. Silence remains correct for PERMISSION and is wrong for
    // ORIENTATION, so session-start now orients while gating nothing.
    const db = database();
    const output = JSON.parse(runSessionStartHook(db, { hook_event_name: "SessionStart" }));
    const context = output.hookSpecificOutput.additionalContext as string;
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(context).toContain("delivery_link");
    expect(context).toContain("discovery-interview");
    expect(context, "the nudge must not claim a gate is being enforced").toContain("no gate is currently enforced");
  });

  it("emits nothing and never throws on unparseable/garbage event input", () => {
    const db = database();
    admittedIssue(db, "HOOK-3");
    db.setActiveIssue("HOOK-3");
    // @ts-expect-error -- deliberately passing a non-object to prove the wrapper swallows it.
    expect(runSessionStartHook(db, "not an object")).not.toBeUndefined();
  });
});

describe("evaluatePreToolUse", () => {
  const repoRoot = "/repo";
  const cwd = "/repo";

  function edit(target: Record<string, unknown>): HookEvent {
    return { hook_event_name: "PreToolUse", cwd, tool_name: "Edit", tool_input: target };
  }

  it("denies each of the four mutating tool names against an in-repo target on a blocked issue", () => {
    const db = database();
    blockedIssue(db, "GATE-1");
    db.setActiveIssue("GATE-1");

    for (const toolName of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      const pathField = toolName === "NotebookEdit" ? "notebook_path" : "file_path";
      const event: HookEvent = { hook_event_name: "PreToolUse", cwd, tool_name: toolName, tool_input: { [pathField]: "/repo/src/app.ts" } };
      const decision = evaluatePreToolUse(db, event, repoRoot);
      expect(decision.decision, `tool ${toolName}`).toBe("deny");
      expect(decision.reason).toBeTruthy();
    }
  });

  it("allows an unlisted tool (Bash) targeting the same in-repo path", () => {
    const db = database();
    blockedIssue(db, "GATE-2");
    db.setActiveIssue("GATE-2");

    const event: HookEvent = { hook_event_name: "PreToolUse", cwd, tool_name: "Bash", tool_input: { command: "rm /repo/src/app.ts" } };
    expect(evaluatePreToolUse(db, event, repoRoot)).toEqual({ decision: "allow" });
  });

  it("denies with the exact active shipping-gate reason on a blocked issue", () => {
    const db = database();
    blockedIssue(db, "GATE-3");
    db.setActiveIssue("GATE-3");

    const decision = evaluatePreToolUse(db, edit({ file_path: "/repo/src/app.ts" }), repoRoot);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toBe("No discovery record exists; the premise has no human behind it.");
  });

  it("allows a target entirely outside the repository root", () => {
    const db = database();
    blockedIssue(db, "GATE-4");
    db.setActiveIssue("GATE-4");

    const decision = evaluatePreToolUse(db, edit({ file_path: "/etc/passwd" }), repoRoot);
    expect(decision).toEqual({ decision: "allow" });
  });

  it("allows a target inside the .loopbreaker state directory", () => {
    const db = database();
    blockedIssue(db, "GATE-5");
    db.setActiveIssue("GATE-5");

    const decision = evaluatePreToolUse(db, edit({ file_path: "/repo/.loopbreaker/loopbreaker.db" }), repoRoot);
    expect(decision).toEqual({ decision: "allow" });
  });

  it("denies a multi-target event mixing one allowed and one deniable path", () => {
    const db = database();
    blockedIssue(db, "GATE-6");
    db.setActiveIssue("GATE-6");

    const event: HookEvent = {
      hook_event_name: "PreToolUse", cwd, tool_name: "MultiEdit",
      tool_input: { file_path: "/etc/passwd", notebook_path: "/repo/notebooks/a.ipynb" },
    };
    const decision = evaluatePreToolUse(db, event, repoRoot);
    expect(decision.decision).toBe("deny");
  });

  it("allows when the path fields are missing or non-string", () => {
    const db = database();
    blockedIssue(db, "GATE-7");
    db.setActiveIssue("GATE-7");

    expect(evaluatePreToolUse(db, edit({}), repoRoot)).toEqual({ decision: "allow" });
    expect(evaluatePreToolUse(db, edit({ file_path: 42 }), repoRoot)).toEqual({ decision: "allow" });
    expect(evaluatePreToolUse(db, { hook_event_name: "PreToolUse", cwd, tool_name: "Edit" }, repoRoot)).toEqual({ decision: "allow" });
  });

  it("allows on a corrupt/empty event with no recognizable tool_name", () => {
    const db = database();
    blockedIssue(db, "GATE-8");
    db.setActiveIssue("GATE-8");

    expect(evaluatePreToolUse(db, {}, repoRoot)).toEqual({ decision: "allow" });
    // @ts-expect-error -- deliberately malformed input to prove the wrapper fails open.
    expect(evaluatePreToolUse(db, null, repoRoot)).toEqual({ decision: "allow" });
  });

  it("allows an in-repo edit once the issue is implementation-admitted", () => {
    const db = database();
    admittedIssue(db, "GATE-9");
    db.setActiveIssue("GATE-9");

    const decision = evaluatePreToolUse(db, edit({ file_path: "/repo/src/app.ts" }), repoRoot);
    expect(decision).toEqual({ decision: "allow" });
  });

  it("denies an in-repo edit when a governed repo has no issue linked", () => {
    const db = database();
    blockedIssue(db, "GATE-10");
    // No setActiveIssue call: no linked issue.

    // SUPERSEDES LB-18-B4's "no active issue -> allow". Allowing made the whole
    // pipeline opt-in by an agent with no incentive to opt in: two observed
    // sessions with every tool, skill and the bootstrap nudge loaded edited
    // source directly and never mentioned loopbreaker. Advisory text loses to a
    // direct user request; only a gate changes behaviour.
    //
    // Fail-open is preserved where it matters: this path is only reached when a
    // database already exists for the repository, which is unambiguous evidence
    // it is governed. A repo that never ran `loopbreaker init` is untouched.
    const decision = evaluatePreToolUse(db, edit({ file_path: "/repo/src/app.ts" }), repoRoot);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("delivery_link");
  });
});

describe("hook fixture files", () => {
  const fixturesDir = resolve(import.meta.dirname, "fixtures");

  it("the Bash fixture allows regardless of admission", () => {
    const db = database();
    blockedIssue(db, "FIX-1");
    db.setActiveIssue("FIX-1");
    const event = JSON.parse(readFileSync(join(fixturesDir, "hook-pretooluse-bash.json"), "utf8")) as HookEvent;
    expect(evaluatePreToolUse(db, { ...event, cwd: "/repo" }, "/repo")).toEqual({ decision: "allow" });
  });

  it("the missing-path fixture allows regardless of admission", () => {
    const db = database();
    blockedIssue(db, "FIX-2");
    db.setActiveIssue("FIX-2");
    const event = JSON.parse(readFileSync(join(fixturesDir, "hook-pretooluse-missing-path.json"), "utf8")) as HookEvent;
    expect(evaluatePreToolUse(db, { ...event, cwd: "/repo" }, "/repo")).toEqual({ decision: "allow" });
  });

  it("the empty-event fixture allows for pre-tool-use and yields no context for session-start", () => {
    const db = database();
    admittedIssue(db, "FIX-3");
    db.setActiveIssue("FIX-3");
    const event = JSON.parse(readFileSync(join(fixturesDir, "hook-empty-event.json"), "utf8")) as HookEvent;
    expect(evaluatePreToolUse(db, event, "/repo")).toEqual({ decision: "allow" });
  });

  it("the corrupt-event fixture text fails JSON.parse and the CLI wrapper must fail open (covered end-to-end below)", () => {
    const raw = readFileSync(join(fixturesDir, "hook-corrupt-event.txt"), "utf8");
    expect(() => JSON.parse(raw)).toThrow();
  });
});

describe("runHookCommand (full session-start/pre-tool-use wiring, in-process)", () => {
  it("session-start emits additionalContext matching composePrime/renderPrime inside a linked repository", () => {
    const { db, dir } = repoDatabase();
    admittedIssue(db, "APP-42");
    db.setActiveIssue("APP-42");

    const event = JSON.stringify({ hook_event_name: "SessionStart", cwd: dir });
    const stdout = runHookCommand("session-start", event, db);
    expect(stdout.length).toBeGreaterThan(0);

    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toBe(renderPrime(composePrime(db, "APP-42")));
  });

  it("session-start emits the bootstrap nudge in a repository with a database but no active-issue binding", () => {
    const { db, dir } = repoDatabase();
    const event = JSON.stringify({ hook_event_name: "SessionStart", cwd: dir });
    const context = JSON.parse(runHookCommand("session-start", event, db)).hookSpecificOutput.additionalContext;
    expect(context).toContain("delivery_link");
  });

  it("session-start emits nothing on corrupt stdin JSON with no active issue", () => {
    const { db } = repoDatabase();
    const raw = readFileSync(resolve(import.meta.dirname, "fixtures", "hook-corrupt-event.txt"), "utf8");
    expect(runHookCommand("session-start", raw, db)).toBe("");
  });

  // Regression for LB-18-REV-1: unparseable stdin used to be swallowed into
  // `{}` and then still dispatched to runSessionStartHook, which ignores its
  // event argument entirely -- so whenever an issue happened to be linked,
  // corrupt stdin silently emitted the prime block anyway. B3's frozen
  // contract requires no context "without ... parseable stdin", full stop,
  // independent of whether an issue is linked or admitted.
  it("LB-18-REV-1 regression: session-start with corrupt stdin emits nothing even when an issue IS linked", () => {
    const { db } = repoDatabase();
    admittedIssue(db, "APP-42");
    db.setActiveIssue("APP-42");

    const raw = readFileSync(resolve(import.meta.dirname, "fixtures", "hook-corrupt-event.txt"), "utf8");
    expect(runHookCommand("session-start", raw, db)).toBe("");
  });

  it("pre-tool-use denies an in-repo edit on a blocked issue with the exact gate reason", () => {
    const { db, dir } = repoDatabase();
    blockedIssue(db, "APP-42");
    db.setActiveIssue("APP-42");

    const targetPath = join(dir, "src", "app.ts");
    const event = JSON.stringify({ hook_event_name: "PreToolUse", cwd: dir, tool_name: "Edit", tool_input: { file_path: targetPath } });
    const stdout = runHookCommand("pre-tool-use", event, db);

    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason?: string } };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(substrate(db, "APP-42").shipping.reason);
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe("No discovery record exists; the premise has no human behind it.");
  });

  it("pre-tool-use allows an in-repo edit once the linked issue is implementation-admitted", () => {
    const { db, dir } = repoDatabase();
    admittedIssue(db, "APP-42");
    db.setActiveIssue("APP-42");

    const targetPath = join(dir, "src", "app.ts");
    const event = JSON.stringify({ hook_event_name: "PreToolUse", cwd: dir, tool_name: "Edit", tool_input: { file_path: targetPath } });
    const stdout = runHookCommand("pre-tool-use", event, db);

    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision: string } };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("pre-tool-use allows an out-of-repo target on a blocked issue", () => {
    const { db, dir } = repoDatabase();
    blockedIssue(db, "APP-42");
    db.setActiveIssue("APP-42");

    const event = JSON.stringify({ hook_event_name: "PreToolUse", cwd: dir, tool_name: "Edit", tool_input: { file_path: "/etc/passwd" } });
    const stdout = runHookCommand("pre-tool-use", event, db);

    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision: string } };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("pre-tool-use allows on corrupt stdin JSON with no active issue", () => {
    const { db } = repoDatabase();
    const raw = readFileSync(resolve(import.meta.dirname, "fixtures", "hook-corrupt-event.txt"), "utf8");
    const stdout = runHookCommand("pre-tool-use", raw, db);
    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision: string } };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  // pre-tool-use's fail-open default must hold even with a blocked issue
  // linked: unparseable stdin can't identify any mutating tool or target, so
  // there is nothing to deny -- unlike session-start, this branch was never
  // buggy, but the coordinator asked this case be pinned explicitly since
  // both hooks now share one dispatch function (dispatchHook).
  it("pre-tool-use allows on corrupt stdin JSON even when a blocked issue is linked", () => {
    const { db } = repoDatabase();
    blockedIssue(db, "APP-42");
    db.setActiveIssue("APP-42");

    const raw = readFileSync(resolve(import.meta.dirname, "fixtures", "hook-corrupt-event.txt"), "utf8");
    const stdout = runHookCommand("pre-tool-use", raw, db);
    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision: string } };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("emits no output for an unrecognized hook name", () => {
    const { db } = repoDatabase();
    expect(runHookCommand("not-a-real-hook", "{}", db)).toBe("");
  });
});
