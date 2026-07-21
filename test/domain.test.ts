import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoopbreakerDb } from "../src/db.js";
import { createWaiver, DomainError, importContract, planningHealth, recordEvidence, recordPass, recordPlanning, substrate, upsertFinding, verifyBehavior } from "../src/domain.js";
import type { PlanningProfile } from "../src/types.js";
import { DEMO_ISSUE, seedDemo } from "../src/seed.js";

const databases: LoopbreakerDb[] = [];

function database(): LoopbreakerDb {
  const db = new LoopbreakerDb(join(mkdtempSync(join(tmpdir(), "loopbreaker-")), "test.db"));
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

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("bounded review and shipping authority", () => {
  it("migrates existing behavior tables to the executable contract shape", () => {
    const db = new LoopbreakerDb(join(mkdtempSync(join(tmpdir(), "loopbreaker-legacy-")), "legacy.db"));
    databases.push(db);
    db.raw.exec(`
      CREATE TABLE issues (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE behaviors (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        enforced INTEGER NOT NULL DEFAULT 1,
        ordinal INTEGER NOT NULL,
        UNIQUE(issue_id, ordinal)
      );
    `);
    db.migrate();
    seedDemo(db);
    const behavior = substrate(db, DEMO_ISSUE).behaviors.find((item) => item.id === "DEMO-B3");
    expect(behavior?.trigger).toContain("replayed");
    expect(behavior?.expected).toContain("exactly once");
    expect(behavior?.verify).toContain("wired worker");
  });

  it("seeds an enforced-by-default contract held by one unverified behavior", () => {
    const state = seedDemo(database());
    expect(state.contract.enforced_by_default).toBe(true);
    expect(state.review.pass_count).toBe(1);
    expect(state.review.next_action).toBe("repair_verification");
    expect(state.shipping.disposition).toBe("hold");
    expect(state.shipping.unresolved_behavior_ids).toEqual(["DEMO-B3"]);
    expect(state.behaviors.find((item) => item.id === "DEMO-B4")?.enforced).toBe(0);
  });

  it("can complete review while shipping remains held", () => {
    const db = database();
    seedDemo(db);
    const state = recordPass(db, { issueId: DEMO_ISSUE, passNumber: 2, verdict: "pass", summary: "Repairs verified." });
    expect(state.review.complete).toBe(true);
    expect(state.review.next_action).toBe("none");
    expect(state.shipping.disposition).toBe("hold");
  });

  it("rejects pass four", () => {
    const db = database();
    seedDemo(db);
    expect(() => recordPass(db, { issueId: DEMO_ISSUE, passNumber: 4, verdict: "fail", summary: "Again." }))
      .toThrowError(DomainError);
  });

  it("ships after proportionate wired proof verifies the remaining behavior", () => {
    const db = database();
    seedDemo(db);
    const withEvidence = recordEvidence(db, { issueId: DEMO_ISSUE, behaviorId: "DEMO-B3", tier: "wired", verdict: "pass", summary: "Replay is exact once." });
    const evidence = withEvidence.evidence.at(-1);
    expect(evidence).toBeDefined();
    const state = verifyBehavior(db, "DEMO-B3", evidence!.id);
    expect(state.shipping.disposition).toBe("ship");
  });

  it("does not let unit evidence alone verify an enforced behavior", () => {
    const db = database();
    seedDemo(db);
    expect(() => verifyBehavior(db, "DEMO-B3", "DEMO-E3")).toThrowError(/Unit evidence alone/);
    expect(substrate(db, DEMO_ISSUE).shipping.disposition).toBe("hold");
  });

  it("ships with debt only after an explicit named waiver", () => {
    const db = database();
    seedDemo(db);
    const state = createWaiver(db, { issueId: DEMO_ISSUE, behaviorId: "DEMO-B3", rationale: "Cold rollback is safe.", approvedBy: "human@example.com" });
    expect(state.shipping.disposition).toBe("ship_with_debt");
    expect(state.shipping.waived_total).toBe(1);
  });

  it("keeps demo seeding idempotent", () => {
    const db = database();
    seedDemo(db);
    const state = seedDemo(db);
    expect(state.review_passes).toHaveLength(1);
    expect(state.evidence).toHaveLength(3);
  });

  it("enforces imported behaviors by default and freezes them once review starts", () => {
    const db = database();
    const contract = importContract(db, {
      issueId: "APP-42",
      title: "Retry one request",
      behaviors: [
        {
          id: "APP-B1",
          title: "Perform one effect",
          trigger: "A request arrives.",
          expected: "One effect occurs.",
          verify: "Run one wired request and observe one effect.",
        },
        {
          id: "APP-B2",
          title: "Show diagnostics",
          trigger: "An operator inspects the request.",
          expected: "Diagnostics are visible.",
          verify: "Inspect one structured log.",
          advisory: true,
        },
      ],
      planning: healthyPlanning(["APP-B1"]),
    });
    expect(contract.behaviors.map((item) => item.enforced)).toEqual([1, 0]);
    recordPass(db, { issueId: "APP-42", passNumber: 1, verdict: "fail", summary: "One finding." });
    expect(() => importContract(db, {
      issueId: "APP-42",
      title: "Retry one request",
      behaviors: [{
        id: "APP-B3",
        title: "A new silent requirement",
        trigger: "A hidden condition occurs.",
        expected: "A hidden result occurs.",
        verify: "Observe the hidden result.",
      }],
    })).toThrowError(/cannot be changed silently/);
  });

  it("scores incomplete planning deterministically and names hard blockers", () => {
    const db = database();
    importContract(db, {
      issueId: "PLAN-1",
      title: "Plan one behavior",
      description: "A contract without a planning profile.",
      behaviors: [{ id: "PLAN-B1", title: "Do it", trigger: "A request arrives.", expected: "It completes.", verify: "Exercise the wired request." }],
    });
    const first = planningHealth(db, "PLAN-1");
    const second = planningHealth(db, "PLAN-1");
    expect(first).toEqual(second);
    expect(first.score).toBe(20);
    expect(first.ready).toBe(false);
    expect(first.blockers.map((blocker) => blocker.code)).toEqual([
      "missing_plan",
      "unmapped_behavior",
      "missing_proof",
      "missing_production_wiring",
      "missing_rollback",
      "score_below_threshold",
    ]);
  });

  it("holds pass one and shipping until planning is healthy, then releases only the planning gate", () => {
    const db = database();
    importContract(db, {
      issueId: "PLAN-2",
      title: "Gate one behavior",
      description: "Planning and verification are ordered gates.",
      behaviors: [{ id: "PLAN-B2", title: "Do it", trigger: "A request arrives.", expected: "It completes.", verify: "Exercise the wired request." }],
    });
    expect(() => recordPass(db, { issueId: "PLAN-2", passNumber: 1, verdict: "pass", summary: "Looks good." })).toThrowError(/planning health/i);
    const evidence = recordEvidence(db, { issueId: "PLAN-2", behaviorId: "PLAN-B2", tier: "wired", verdict: "pass", summary: "Wired proof." }).evidence.at(-1)!;
    expect(verifyBehavior(db, "PLAN-B2", evidence.id).shipping.gate).toBe("planning");

    const health = recordPlanning(db, "PLAN-2", healthyPlanning(["PLAN-B2"]));
    expect(health.score).toBe(100);
    expect(health.ready).toBe(true);
    expect(substrate(db, "PLAN-2").shipping).toMatchObject({ disposition: "ship", gate: "ready", planning_score: 100 });
  });

  it("freezes the planning profile when review begins", () => {
    const db = database();
    importContract(db, {
      issueId: "PLAN-3",
      title: "Freeze one plan",
      description: "The profile cannot drift during review.",
      behaviors: [{ id: "PLAN-B3", title: "Do it", trigger: "A request arrives.", expected: "It completes.", verify: "Exercise the wired request." }],
      planning: healthyPlanning(["PLAN-B3"]),
    });
    recordPass(db, { issueId: "PLAN-3", passNumber: 1, verdict: "pass", summary: "Plan and implementation align." });
    expect(recordPlanning(db, "PLAN-3", healthyPlanning(["PLAN-B3"]))).toMatchObject({ ready: true, score: 100 });
    expect(() => recordPlanning(db, "PLAN-3", { ...healthyPlanning(["PLAN-B3"]), appetite: "Expanded scope." })).toThrowError(/cannot change silently/);
  });

  it("does not let a high score average away a hard planning blocker", () => {
    const db = database();
    const plan = healthyPlanning(["PLAN-B4"]);
    delete plan.rollback;
    const state = importContract(db, {
      issueId: "PLAN-4",
      title: "Keep blockers conjunctive",
      description: "One missing safety fact must still hold planning.",
      behaviors: [{ id: "PLAN-B4", title: "Do it safely", trigger: "A request arrives.", expected: "It completes safely.", verify: "Exercise the wired request." }],
      planning: plan,
    });
    expect(state.planning).toMatchObject({ score: 95, ready: false, grade: "at_risk" });
    expect(state.planning.blockers.map((blocker) => blocker.code)).toEqual(["missing_rollback"]);
    expect(state.shipping.gate).toBe("planning");
  });

  it("allows one legacy planning backfill after review and freezes it afterward", () => {
    const db = database();
    db.raw.exec(`
      INSERT INTO issues (id, title, description) VALUES ('LEGACY-1', 'Legacy issue', 'Reviewed before planning health.');
      INSERT INTO behaviors (id, issue_id, title, trigger, expected, verify, status, enforced, ordinal)
      VALUES ('LEGACY-B1', 'LEGACY-1', 'Legacy behavior', 'A request arrives.', 'It completes.', 'Run the wired request.', 'pending', 1, 1);
      INSERT INTO review_passes (id, issue_id, pass_number, kind, verdict, summary)
      VALUES ('LEGACY-P1', 'LEGACY-1', 1, 'comprehensive', 'pass', 'Legacy review completed.');
    `);
    expect(substrate(db, "LEGACY-1").shipping.gate).toBe("planning");
    expect(recordPass(db, { issueId: "LEGACY-1", passNumber: 1, verdict: "pass", summary: "Legacy review completed." }).review.pass_count).toBe(1);
    expect(recordPlanning(db, "LEGACY-1", healthyPlanning(["LEGACY-B1"])).ready).toBe(true);
    expect(() => recordPlanning(db, "LEGACY-1", { ...healthyPlanning(["LEGACY-B1"]), appetite: "Changed." })).toThrowError(/cannot change silently/);
  });

  it("keeps one stable row per root-cause finding", () => {
    const db = database();
    seedDemo(db);
    upsertFinding(db, {
      issueId: DEMO_ISSUE,
      findingId: "B3:duplicate-effect:sdk-boundary",
      behaviorId: "DEMO-B3",
      reviewPassNumber: 1,
      severity: "P1",
      status: "open",
      title: "Replay can duplicate the effect",
      reachability: "Restart after persistence.",
      impact: "Two external effects.",
      rollback: "Use the cold path.",
      smallestFix: "Add an idempotency key.",
    });
    const state = upsertFinding(db, {
      issueId: DEMO_ISSUE,
      findingId: "B3:duplicate-effect:sdk-boundary",
      behaviorId: "DEMO-B3",
      reviewPassNumber: 1,
      severity: "P1",
      status: "repaired",
      title: "Replay can duplicate the effect",
    });
    expect(state.findings.filter((item) => item.id === "B3:duplicate-effect:sdk-boundary")).toHaveLength(1);
    expect(state.findings.find((item) => item.id === "B3:duplicate-effect:sdk-boundary")?.status).toBe("repaired");
  });

  it("rejects a vague open P1 that fails the blocker test", () => {
    const db = database();
    seedDemo(db);
    expect(() => upsertFinding(db, {
      issueId: DEMO_ISSUE,
      findingId: "vague-p1",
      severity: "P1",
      status: "open",
      title: "This might be risky",
    })).toThrowError(/requires behavior attribution/);
  });
});
