import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoopbreakerDb } from "../src/db.js";
import { createWaiver, DomainError, importContract, recordEvidence, recordPass, substrate, verifyBehavior } from "../src/domain.js";
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
        { id: "APP-B1", title: "Perform one effect" },
        { id: "APP-B2", title: "Show diagnostics", advisory: true },
      ],
    });
    expect(contract.behaviors.map((item) => item.enforced)).toEqual([1, 0]);
    recordPass(db, { issueId: "APP-42", passNumber: 1, verdict: "fail", summary: "One finding." });
    expect(() => importContract(db, {
      issueId: "APP-42",
      title: "Retry one request",
      behaviors: [{ id: "APP-B3", title: "A new silent requirement" }],
    })).toThrowError(/cannot be changed silently/);
  });
});
