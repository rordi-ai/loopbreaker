import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoopbreakerDb } from "../src/db.js";
import { createWaiver, DomainError, importContract, recordEvidence, recordPass, substrate, upsertFinding, verifyBehavior } from "../src/domain.js";
import { DEMO_ISSUE, seedDemo } from "../src/seed.js";

const databases: LoopbreakerDb[] = [];

function database(): LoopbreakerDb {
  const db = new LoopbreakerDb(join(mkdtempSync(join(tmpdir(), "loopbreaker-")), "test.db"));
  db.migrate();
  databases.push(db);
  return db;
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
