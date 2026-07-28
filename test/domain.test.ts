import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoopbreakerDb } from "../src/db.js";
import { createWaiver, DomainError, importContract, openReviewRound, planningHealth, recordEvidence, recordPass, recordPlanning, recordPlanningReviewPass, recordShape, substrate, upsertFinding, upsertPlanningFinding, verifyBehavior, DISCOVERY_FIELDS, approveDiscovery, discoveryState, recordDiscovery } from "../src/domain.js";
import type { PlanningProfile, ShapeProfile } from "../src/types.js";
import { DEMO_ISSUE, seedDemo } from "../src/seed.js";

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

function healthyShape(disposition: ShapeProfile["disposition"] = "proceed"): ShapeProfile {
  return {
    problem: "A bounded user-visible problem exists.", appetite: "One focused slice.",
    smallest_slice: "Implement one observable behavior.", non_goals: ["Unrelated redesign"],
    success_signal: "The wired behavior passes.", reversibility: "Disable the new entry point.",
    decision_owner: "Issue owner", risks: [], disposition,
  };
}

function admitImplementation(db: LoopbreakerDb, issueId: string): void {
  satisfyDiscovery(db, issueId);
  recordShape(db, issueId, healthyShape());
  recordPlanningReviewPass(db, { issueId, passNumber: 1, verdict: "approved", summary: "Shape and plan cohere." });
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

  /**
   * LB-34 — a round that fails out is not the end of the work.
   *
   * The three-pass cap stays exactly as it was; what these cover is that
   * spending it names a next action instead of a dead end, and that entering
   * that next action costs an explicit human decision.
   */
  describe("review rounds", () => {
    function exhaustRoundOne(db: LoopbreakerDb): void {
      seedDemo(db);
      recordPass(db, { issueId: DEMO_ISSUE, passNumber: 2, verdict: "fail", summary: "Repairs incomplete." });
      recordPass(db, { issueId: DEMO_ISSUE, passNumber: 3, verdict: "fail", summary: "Terminal decision." });
    }

    it("names a new implementation round when three passes end without a pass", () => {
      const db = database();
      exhaustRoundOne(db);

      const state = substrate(db, DEMO_ISSUE);
      expect(state.review.pass_count).toBe(3);
      expect(state.review.round).toBe(1);
      expect(state.review.round_exhausted).toBe(true);
      expect(state.review.complete).toBe(true);
      expect(state.review.next_action).toBe("new_implementation_round");
      // The cap itself is untouched.
      expect(state.review.automatic_pass_four).toBe(false);
    });

    it("restarts pass numbering in the new round while keeping the whole history", () => {
      const db = database();
      exhaustRoundOne(db);

      const opened = openReviewRound(db, {
        issueId: DEMO_ISSUE,
        reason: "Two P1 findings repaired; the repairs need review.",
        authorizedBy: "founder@example.com",
      });

      expect(opened.review.round).toBe(2);
      expect(opened.review.pass_count).toBe(0);
      expect(opened.review.next_pass).toBe(1);
      expect(opened.review.next_action).toBe("comprehensive");
      expect(opened.review.complete).toBe(false);
      expect(opened.review.round_exhausted).toBe(false);
      // Nothing is erased: the failed round remains on the record.
      expect(opened.review.total_passes).toBe(3);
      expect(opened.review.rounds).toEqual([
        expect.objectContaining({ round: 2, authorized_by: "founder@example.com" }),
      ]);

      const reviewed = recordPass(db, { issueId: DEMO_ISSUE, passNumber: 1, verdict: "pass", summary: "Repairs verified." });
      expect(reviewed.review.pass_count).toBe(1);
      expect(reviewed.review.complete).toBe(true);
      expect(reviewed.review.total_passes).toBe(4);
    });

    it("refuses a new round while the current one still has a pass left", () => {
      const db = database();
      seedDemo(db);
      expect(() => openReviewRound(db, { issueId: DEMO_ISSUE, reason: "Impatient.", authorizedBy: "someone" }))
        .toThrowError(/still has pass/i);
    });

    it("refuses a new round after a round that passed", () => {
      const db = database();
      seedDemo(db);
      recordPass(db, { issueId: DEMO_ISSUE, passNumber: 2, verdict: "pass", summary: "Repairs verified." });
      expect(() => openReviewRound(db, { issueId: DEMO_ISSUE, reason: "One more look.", authorizedBy: "someone" }))
        .toThrowError(/nothing to re-open/i);
    });

    it("refuses to open a round without a human authorizing it", () => {
      const db = database();
      exhaustRoundOne(db);
      expect(() => openReviewRound(db, { issueId: DEMO_ISSUE, reason: "Findings repaired.", authorizedBy: "  " }))
        .toThrowError(/authorizing/i);
      expect(() => openReviewRound(db, { issueId: DEMO_ISSUE, reason: " ", authorizedBy: "founder@example.com" }))
        .toThrowError(/reason/i);
    });

    it("still rejects a fourth pass inside the new round", () => {
      const db = database();
      exhaustRoundOne(db);
      openReviewRound(db, { issueId: DEMO_ISSUE, reason: "Repairs landed.", authorizedBy: "founder@example.com" });

      recordPass(db, { issueId: DEMO_ISSUE, passNumber: 1, verdict: "fail", summary: "Still wrong." });
      recordPass(db, { issueId: DEMO_ISSUE, passNumber: 2, verdict: "fail", summary: "Still wrong." });
      recordPass(db, { issueId: DEMO_ISSUE, passNumber: 3, verdict: "fail", summary: "Terminal again." });

      expect(() => recordPass(db, { issueId: DEMO_ISSUE, passNumber: 4, verdict: "fail", summary: "Once more." }))
        .toThrowError(DomainError);
      expect(substrate(db, DEMO_ISSUE).review.next_action).toBe("new_implementation_round");
    });
  });

  it("ships after proportionate wired proof verifies the remaining behavior", () => {
    const db = database();
    seedDemo(db);
    const withEvidence = recordEvidence(db, { issueId: DEMO_ISSUE, behaviorId: "DEMO-B3", tier: "wired", verdict: "pass", summary: "Replay is exact once.", executed: true, harnessId: "fixture" });
    const evidence = withEvidence.evidence.at(-1);
    expect(evidence).toBeDefined();
    const state = verifyBehavior(db, "DEMO-B3", evidence!.id);
    expect(state.shipping.disposition).toBe("ship");
  });

  it("does not let unit evidence alone verify an enforced behavior", () => {
    const db = database();
    seedDemo(db);
    // LB-27: the executed-evidence gate now fires ahead of the tier rule, so
    // this must use an EXECUTED unit proof to still reach the rule it covers.
    // Complaining about the tier of asserted evidence would be incoherent
    // anyway — an unexecuted row's tier is a caller's claim, not a fact.
    const executedUnit = recordEvidence(db, {
      issueId: DEMO_ISSUE, behaviorId: "DEMO-B3", tier: "unit", verdict: "pass",
      summary: "A unit harness ran and passed.", executed: true, harnessId: "fixture-unit",
    }).evidence.at(-1)!;
    expect(() => verifyBehavior(db, "DEMO-B3", executedUnit.id)).toThrowError(/Unit evidence alone/);
    expect(substrate(db, DEMO_ISSUE).shipping.disposition).toBe("hold");
  });

  it("refuses to approve a premise through an agent-reachable ingress", () => {
    // Demonstrated live in a dry run: an agent offered "I'll approve on your
    // behalf", ran the CLI, and wrote the founder's name into approved_by. The
    // record read approved_by: "Ben (ben@rordi.ai)" while provenance read
    // cli/ubuntu -- its own shell. approved_by is caller-supplied and therefore
    // worthless as an authenticator; only the ingress is evidence.
    const db = database();
    importContract(db, {
      issueId: "APPROVE-1", title: "Ingress rule",
      behaviors: [{ id: "APPROVE-1-B1", title: "Do it", trigger: "t", expected: "e", verify: "v" }],
    });
    recordDiscovery(db, "APPROVE-1", DISCOVERY_FIELDS.map((field) => ({
      field, question: `What is the ${field}?`, answer: `Answer for ${field}.`,
    })));

    // `database()` opens a cli-ingress handle -- exactly what an agent holds.
    expect(() => approveDiscovery(db, "APPROVE-1", "Ben (ben@rordi.ai)"))
      .toThrowError(/only the browser may approve/);
    expect(discoveryState(db, "APPROVE-1").status).toBe("draft");

    const browser = new LoopbreakerDb(db.path, { trigger_type: "web", triggered_by: "browser", trigger_data: null });
    try {
      expect(approveDiscovery(browser, "APPROVE-1", "Ben").status).toBe("approved");
    } finally {
      browser.close();
    }
  });

  it("does not let asserted evidence verify an enforced behavior", () => {
    const db = database();
    seedDemo(db);
    // The seeded DEMO-E3 row was never executed by loopbreaker. Before LB-27 the
    // only thing standing between it and a ship decision was its `unit` tier —
    // a value the caller typed.
    expect(() => verifyBehavior(db, "DEMO-B3", "DEMO-E3")).toThrowError(/did not execute this proof/);
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
    admitImplementation(db, "APP-42");
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

  it("holds implementation at each ordered authority until independently approved", () => {
    const db = database();
    importContract(db, {
      issueId: "PLAN-2",
      title: "Gate one behavior",
      description: "Planning and verification are ordered gates.",
      behaviors: [{ id: "PLAN-B2", title: "Do it", trigger: "A request arrives.", expected: "It completes.", verify: "Exercise the wired request." }],
    });
    expect(() => recordPass(db, { issueId: "PLAN-2", passNumber: 1, verdict: "pass", summary: "Looks good." })).toThrowError(/shape disposition/i);
    satisfyDiscovery(db, "PLAN-2");
    recordShape(db, "PLAN-2", healthyShape());
    expect(() => recordPass(db, { issueId: "PLAN-2", passNumber: 1, verdict: "pass", summary: "Looks good." })).toThrowError(/planning health/i);
    const evidence = recordEvidence(db, { issueId: "PLAN-2", behaviorId: "PLAN-B2", tier: "wired", verdict: "pass", summary: "Wired proof.", executed: true, harnessId: "fixture" }).evidence.at(-1)!;
    expect(verifyBehavior(db, "PLAN-B2", evidence.id).shipping.gate).toBe("planning");

    const health = recordPlanning(db, "PLAN-2", healthyPlanning(["PLAN-B2"]));
    expect(health.score).toBe(100);
    expect(health.ready).toBe(true);
    expect(substrate(db, "PLAN-2").shipping.gate).toBe("planning_review");
    expect(() => recordPass(db, { issueId: "PLAN-2", passNumber: 1, verdict: "pass", summary: "Looks good." })).toThrowError(/independent planning review/i);
    recordPlanningReviewPass(db, { issueId: "PLAN-2", passNumber: 1, verdict: "approved", summary: "Coherent." });
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
    admitImplementation(db, "PLAN-3");
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
    // LB-28: discovery is the first ordered authority, so an issue with no
    // recorded premise is held there rather than at shape.
    expect(state.shipping.gate).toBe("discovery");
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
    expect(substrate(db, "LEGACY-1").shipping.gate).toBe("discovery");
    expect(recordPass(db, { issueId: "LEGACY-1", passNumber: 1, verdict: "pass", summary: "Legacy review completed." }).review.pass_count).toBe(1);
    expect(() => recordPass(db, { issueId: "LEGACY-1", passNumber: 2, verdict: "pass", summary: "Must not continue yet." })).toThrowError(/shape disposition/i);
    expect(recordPlanning(db, "LEGACY-1", healthyPlanning(["LEGACY-B1"])).ready).toBe(true);
    satisfyDiscovery(db, "LEGACY-1");
    recordShape(db, "LEGACY-1", healthyShape());
    expect(() => recordPass(db, { issueId: "LEGACY-1", passNumber: 2, verdict: "pass", summary: "Must not continue yet." })).toThrowError(/independent planning review/i);
    recordPlanningReviewPass(db, { issueId: "LEGACY-1", passNumber: 1, verdict: "approved", summary: "Legacy planning backfill approved." });
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
    expect(state.findings.find((item) => item.id === "B3:duplicate-effect:sdk-boundary")?.blocker_reachability).toBe("Restart after persistence.");
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

  it("persists explicit non-proceed shape decisions without releasing the gate", () => {
    const db = database();
    importContract(db, {
      issueId: "SHAPE-1", title: "Shape a slice",
      behaviors: [{ id: "SHAPE-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
      planning: healthyPlanning(["SHAPE-B1"]),
    });
    // Discovery is satisfied so the assertions below isolate the SHAPE
    // disposition rule rather than tripping over the gate above it.
    satisfyDiscovery(db, "SHAPE-1");
    for (const disposition of ["spike", "park", "reject"] as const) {
      expect(recordShape(db, "SHAPE-1", healthyShape(disposition))).toMatchObject({ ready: false, blockers: [{ code: `shape_${disposition}` }] });
    }
    expect(recordShape(db, "SHAPE-1", { ...healthyShape(), success_signal: "" })).toMatchObject({ ready: false, blockers: [{ code: "incomplete_shape" }] });
    expect(substrate(db, "SHAPE-1").shipping.gate).toBe("shape");
  });

  it("bounds independent planning review to comprehensive, repair, and decision", () => {
    const db = database();
    importContract(db, {
      issueId: "PREVIEW-1", title: "Review one plan",
      behaviors: [{ id: "PREVIEW-B1", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
      planning: healthyPlanning(["PREVIEW-B1"]),
    });
    satisfyDiscovery(db, "PREVIEW-1");
    recordShape(db, "PREVIEW-1", healthyShape());
    recordPlanningReviewPass(db, { issueId: "PREVIEW-1", passNumber: 1, verdict: "changes_required", summary: "One root cause." });
    upsertPlanningFinding(db, {
      issueId: "PREVIEW-1", findingId: "PREVIEW-F1", reviewPassNumber: 1, stage: "planning", severity: "P1", status: "open",
      title: "Wiring is ambiguous", reachability: "The work unit reaches production.", impact: "The behavior may exist only in tests.", smallestFix: "Name the production constructor.",
    });
    expect(() => recordPlanningReviewPass(db, { issueId: "PREVIEW-1", passNumber: 2, verdict: "approved", summary: "Fixed." })).toThrowError(/open P0\/P1/);
    upsertPlanningFinding(db, { issueId: "PREVIEW-1", findingId: "PREVIEW-F1", stage: "planning", severity: "P1", status: "repaired", title: "Wiring is ambiguous" });
    expect(substrate(db, "PREVIEW-1").planning_findings[0]?.reachability).toBe("The work unit reaches production.");
    recordPlanningReviewPass(db, { issueId: "PREVIEW-1", passNumber: 2, verdict: "changes_required", summary: "Repair did not close proof." });
    const state = recordPlanningReviewPass(db, { issueId: "PREVIEW-1", passNumber: 3, verdict: "rescope", summary: "Decision-only split." });
    expect(state.planning_review).toMatchObject({ complete: true, approved: false, disposition: "rescope", automatic_pass_four: false });
    expect(() => recordPlanningReviewPass(db, { issueId: "PREVIEW-1", passNumber: 4, verdict: "approved", summary: "Again." })).toThrowError(/limited to 1, 2, and 3/);
  });

  it("freezes shape and planning at planning-review pass one while allowing exact replay", () => {
    const db = database();
    importContract(db, {
      issueId: "PREVIEW-2", title: "Freeze planning",
      behaviors: [{ id: "PREVIEW-B2", title: "Do it", trigger: "Requested", expected: "Done", verify: "Run wired proof" }],
      planning: healthyPlanning(["PREVIEW-B2"]),
    });
    satisfyDiscovery(db, "PREVIEW-2");
    recordShape(db, "PREVIEW-2", healthyShape());
    recordPlanningReviewPass(db, { issueId: "PREVIEW-2", passNumber: 1, verdict: "approved", summary: "Coherent." });
    expect(recordShape(db, "PREVIEW-2", healthyShape()).ready).toBe(true);
    expect(() => recordShape(db, "PREVIEW-2", { ...healthyShape(), appetite: "Changed." })).toThrowError(/cannot change silently/);
    expect(() => recordPlanning(db, "PREVIEW-2", { ...healthyPlanning(["PREVIEW-B2"]), appetite: "Changed." })).toThrowError(/cannot change silently/);
  });
});
