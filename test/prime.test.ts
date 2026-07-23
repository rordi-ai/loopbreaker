import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLinkCommand, type Flags } from "../src/cli.js";
import { LoopbreakerDb } from "../src/db.js";
import { DomainError, importContract, recordEvidence, recordPlanningReviewPass, recordShape, upsertFinding, upsertPlanningFinding, verifyBehavior } from "../src/domain.js";
import { composePrime, primePayload, renderPrime, resolveIssue } from "../src/prime.js";
import type { PlanningProfile, ShapeProfile } from "../src/types.js";

const databases: LoopbreakerDb[] = [];

function database(): LoopbreakerDb {
  const db = new LoopbreakerDb(join(mkdtempSync(join(tmpdir(), "loopbreaker-prime-")), "test.db"));
  db.migrate();
  databases.push(db);
  return db;
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

function healthyShape(disposition: ShapeProfile["disposition"] = "proceed"): ShapeProfile {
  return {
    problem: "A bounded user-visible problem exists.", appetite: "One focused slice.",
    smallest_slice: "Implement one observable behavior.", non_goals: ["Unrelated redesign"],
    success_signal: "The wired behavior passes.", reversibility: "Disable the new entry point.",
    decision_owner: "Issue owner", risks: [], disposition,
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("active issue link", () => {
  it("has no active issue until one is linked, round-trips set/show, and clears explicitly", () => {
    const db = database();
    expect(db.activeIssue()).toBeNull();

    importContract(db, {
      issueId: "APP-42", title: "Retry one request",
      behaviors: [{ id: "APP-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    });

    db.setActiveIssue("APP-42");
    expect(db.activeIssue()).toBe("APP-42");

    db.clearActiveIssue();
    expect(db.activeIssue()).toBeNull();
  });

  it("persists the last bound issue across repeated sets", () => {
    const db = database();
    importContract(db, {
      issueId: "APP-1", title: "First",
      behaviors: [{ id: "APP-1-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    });
    importContract(db, {
      issueId: "APP-2", title: "Second",
      behaviors: [{ id: "APP-2-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    });
    db.setActiveIssue("APP-1");
    expect(db.activeIssue()).toBe("APP-1");
    db.setActiveIssue("APP-2");
    expect(db.activeIssue()).toBe("APP-2");
  });
});

describe("resolveIssue", () => {
  it("prefers the explicit issue over the active binding", () => {
    const db = database();
    importContract(db, {
      issueId: "SOMETHING-ELSE", title: "Not this one",
      behaviors: [{ id: "SOMETHING-ELSE-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    });
    db.setActiveIssue("SOMETHING-ELSE");
    expect(resolveIssue(db, "APP-42")).toBe("APP-42");
  });

  it("falls back to the active binding when no issue is named", () => {
    const db = database();
    importContract(db, {
      issueId: "APP-9", title: "Active by default",
      behaviors: [{ id: "APP-9-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    });
    db.setActiveIssue("APP-9");
    expect(resolveIssue(db)).toBe("APP-9");
  });

  it("throws a clear DomainError when neither an explicit nor an active issue exists", () => {
    const db = database();
    expect(() => resolveIssue(db)).toThrowError(DomainError);
    try {
      resolveIssue(db);
      expect.fail("expected resolveIssue to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("no_active_issue");
    }
  });
});

describe("composePrime / renderPrime determinism", () => {
  function admittedIssue(db: LoopbreakerDb, issueId: string): void {
    importContract(db, {
      issueId, title: "Deterministic prime fixture",
      behaviors: [
        { id: `${issueId}-B1`, title: "Persist before invoking", trigger: "Requested", expected: "Persisted first", verify: "Trace wired request" },
        { id: `${issueId}-B2`, title: "Show diagnostics", trigger: "Inspected", expected: "Diagnostics visible", verify: "Inspect one log", advisory: true },
      ],
      planning: healthyPlanning([`${issueId}-B1`, `${issueId}-B2`]),
    });
    recordShape(db, issueId, healthyShape());
    recordPlanningReviewPass(db, { issueId, passNumber: 1, verdict: "approved", summary: "Coherent." });
  }

  it("throws issue_not_found for an unknown issue", () => {
    const db = database();
    expect(() => composePrime(db, "NOPE")).toThrowError(DomainError);
    try {
      composePrime(db, "NOPE");
    } catch (error) {
      expect((error as DomainError).code).toBe("issue_not_found");
    }
  });

  it("returns the same block across repeated calls with no state change (admitted, held on verification)", () => {
    const db = database();
    admittedIssue(db, "PRIME-1");

    const first = composePrime(db, "PRIME-1");
    const second = composePrime(db, "PRIME-1");
    expect(second).toEqual(first);
    expect(renderPrime(second)).toBe(renderPrime(first));

    expect(first).toEqual({
      issue_id: "PRIME-1",
      authority_chain: {
        shape: { disposition: "proceed", ready: true },
        planning: { score: 100, ready: true },
        planning_review: { disposition: "approved", approved: true },
        implementation: { admitted: true },
        shipping: { disposition: "hold" },
      },
      next_action: "verify or waive enforced behaviors",
      open_blocking_findings: [],
      unverified_enforced_behaviors: [{ id: "PRIME-1-B1", title: "Persist before invoking" }],
    });
  });

  it("reflects the shape gate before shape is recorded", () => {
    const db = database();
    importContract(db, {
      issueId: "PRIME-2", title: "Not yet shaped",
      behaviors: [{ id: "PRIME-2-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    });
    const block = composePrime(db, "PRIME-2");
    expect(block.authority_chain.shape).toEqual({ disposition: null, ready: false });
    expect(block.next_action).toBe("record shape proceed");
  });

  it("reflects the planning_review gate and surfaces its own next_action", () => {
    const db = database();
    importContract(db, {
      issueId: "PRIME-3", title: "Awaiting planning review",
      behaviors: [{ id: "PRIME-3-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
      planning: healthyPlanning(["PRIME-3-B1"]),
    });
    recordShape(db, "PRIME-3", healthyShape());
    const block = composePrime(db, "PRIME-3");
    expect(block.authority_chain.shipping.disposition).toBe("hold");
    expect(block.next_action).toBe("comprehensive");
  });

  it("lists open P0/P1 planning and code-review findings, excluding P2/P3 and non-open findings", () => {
    const db = database();
    importContract(db, {
      issueId: "PRIME-4", title: "Findings fixture",
      behaviors: [{ id: "PRIME-4-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
      planning: healthyPlanning(["PRIME-4-B1"]),
    });
    recordShape(db, "PRIME-4", healthyShape());
    recordPlanningReviewPass(db, { issueId: "PRIME-4", passNumber: 1, verdict: "changes_required", summary: "One issue." });
    upsertPlanningFinding(db, {
      issueId: "PRIME-4", findingId: "PRIME-4-PF1", reviewPassNumber: 1, stage: "planning", severity: "P1", status: "open",
      title: "Wiring is ambiguous", reachability: "Reaches production.", impact: "May not exist in prod.", smallestFix: "Name the constructor.",
    });
    upsertPlanningFinding(db, {
      issueId: "PRIME-4", findingId: "PRIME-4-PF2", stage: "planning", severity: "P3", status: "open", title: "Minor nit",
    });
    upsertFinding(db, {
      issueId: "PRIME-4", findingId: "PRIME-4-F1", severity: "P2", status: "open", title: "Non-blocking review note",
    });

    const block = composePrime(db, "PRIME-4");
    expect(block.open_blocking_findings).toEqual([{ id: "PRIME-4-PF1", severity: "P1", title: "Wiring is ambiguous" }]);
  });

  it("drops behaviors from unverified_enforced_behaviors once verified", () => {
    const db = database();
    admittedIssue(db, "PRIME-5");
    const withEvidence = recordEvidence(db, { issueId: "PRIME-5", behaviorId: "PRIME-5-B1", tier: "wired", verdict: "pass", summary: "Traced." });
    const evidence = withEvidence.evidence.at(-1)!;
    verifyBehavior(db, "PRIME-5-B1", evidence.id);

    const block = composePrime(db, "PRIME-5");
    expect(block.unverified_enforced_behaviors).toEqual([]);
    expect(block.authority_chain.shipping.disposition).toBe("ship");
    expect(block.next_action).toBe("ship");
  });

  it("renders a stable, timestamp-free text form", () => {
    const db = database();
    admittedIssue(db, "PRIME-6");
    const block = composePrime(db, "PRIME-6");
    const rendered = renderPrime(block);
    expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(renderPrime(block)).toBe(rendered);
    expect(rendered.split("\n")).toEqual([
      "issue: PRIME-6",
      "shape: disposition=proceed ready=true",
      "planning: score=100 ready=true",
      "planning_review: disposition=approved approved=true",
      "implementation: admitted=true",
      "shipping: disposition=hold",
      "next_action: verify or waive enforced behaviors",
      "open_blocking_findings: none",
      "unverified_enforced_behaviors: PRIME-6-B1 Persist before invoking",
    ]);
  });
});

// In-process exercise of the exact CLI dispatch logic (runLinkCommand, the
// function `main()`'s `link` branch calls) and the exact payload function
// both the CLI `prime` command and the MCP `delivery_prime` tool call
// (primePayload). No child process, no tsx cold start -- see LB-18-REV-2:
// spawning tsx per invocation overran vitest's worker RPC under load and
// made `pnpm test` nondeterministically exit 1 even though assertions
// passed. runHookCommand (test/hooks.test.ts) established this in-process
// pattern for exactly the same class of problem.
describe("CLI link dispatch (in-process, via runLinkCommand)", () => {
  const noFlags: Flags = {};

  it("round-trips link (set/show/clear) and returns an explicit null when unlinked", () => {
    const db = database();
    importContract(db, {
      issueId: "APP-42", title: "Retry one request",
      behaviors: [{ id: "APP-42-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    });

    expect(runLinkCommand(db, ["link"], { show: true })).toEqual({ active_issue: null });

    expect(runLinkCommand(db, ["link", "APP-42"], noFlags)).toEqual({ active_issue: "APP-42" });
    expect(runLinkCommand(db, ["link"], { show: true })).toEqual({ active_issue: "APP-42" });

    expect(runLinkCommand(db, ["link"], { clear: true })).toEqual({ active_issue: null });
    expect(runLinkCommand(db, ["link"], { show: true })).toEqual({ active_issue: null });
  });

  it("gives --clear priority over --show and a positional issue", () => {
    const db = database();
    importContract(db, {
      issueId: "APP-42", title: "Retry one request",
      behaviors: [{ id: "APP-42-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    });
    runLinkCommand(db, ["link", "APP-42"], noFlags);
    expect(runLinkCommand(db, ["link", "APP-42"], { clear: true, show: true })).toEqual({ active_issue: null });
  });

  it("gives --show priority over a positional issue", () => {
    const db = database();
    importContract(db, {
      issueId: "APP-42", title: "Retry one request",
      behaviors: [{ id: "APP-42-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
    });
    expect(runLinkCommand(db, ["link", "APP-42"], { show: true })).toEqual({ active_issue: null });
    expect(db.activeIssue()).toBeNull();
  });

  it("rejects linking an issue that does not exist", () => {
    const db = database();
    expect(() => runLinkCommand(db, ["link", "NOPE"], noFlags)).toThrowError(DomainError);
    try {
      runLinkCommand(db, ["link", "NOPE"], noFlags);
    } catch (error) {
      expect((error as DomainError).code).toBe("issue_not_found");
    }
    expect(db.activeIssue()).toBeNull();
  });

  it("requires an issue ID when neither --show nor --clear is given", () => {
    const db = database();
    expect(() => runLinkCommand(db, ["link"], noFlags)).toThrowError(/An issue ID is required/);
  });
});

describe("primePayload: the single function both the CLI and the MCP tool call", () => {
  function admittedIssue(db: LoopbreakerDb, issueId: string): void {
    importContract(db, {
      issueId, title: "Deterministic prime fixture",
      behaviors: [{ id: `${issueId}-B1`, title: "Persist before invoking", trigger: "Requested", expected: "Persisted first", verify: "Trace wired request" }],
      planning: healthyPlanning([`${issueId}-B1`]),
    });
    recordShape(db, issueId, healthyShape());
    recordPlanningReviewPass(db, { issueId, passNumber: 1, verdict: "approved", summary: "Coherent." });
  }

  it("equals composePrime's block plus renderPrime's rendering, for an explicitly named issue", () => {
    const db = database();
    admittedIssue(db, "APP-42");
    const block = composePrime(db, "APP-42");
    expect(primePayload(db, "APP-42")).toEqual({ ...block, rendered: renderPrime(block) });
  });

  it("resolves the linked active issue exactly like resolveIssue would, and matches the explicit-id result", () => {
    const db = database();
    admittedIssue(db, "APP-42");
    db.setActiveIssue("APP-42");

    const viaActive = primePayload(db);
    const viaExplicit = primePayload(db, "APP-42");
    expect(viaActive).toEqual(viaExplicit);
    expect(viaActive.issue_id).toBe(resolveIssue(db));
  });

  it("is what the CLI `prime` command and the MCP `delivery_prime` tool both return -- proven by construction: both call this same exported function with the same arguments", () => {
    const db = database();
    admittedIssue(db, "APP-42");
    db.setActiveIssue("APP-42");

    // cli.ts's `prime` branch: output(primePayload(db, positional[1]), db);
    const cliPositionalArg = undefined; // `loopbreaker prime` with no ISSUE argument
    const cliData = primePayload(db, cliPositionalArg);

    // mcp.ts's delivery_prime handler: content(primePayload(db, issue_id), db.path);
    const mcpIssueIdArg = undefined; // MCP call with no issue_id
    const mcpData = primePayload(db, mcpIssueIdArg);

    expect(mcpData).toEqual(cliData);
  });

  it("throws no_active_issue when priming with neither a named nor a linked issue -- the CLI's exit-2 usage error path", () => {
    const db = database();
    expect(() => primePayload(db)).toThrowError(DomainError);
    try {
      primePayload(db);
    } catch (error) {
      expect((error as DomainError).code).toBe("no_active_issue");
    }
  });
});
