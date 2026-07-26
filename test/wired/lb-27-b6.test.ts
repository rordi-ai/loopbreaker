/**
 * LB-27-B6 — `demote --dry-run` reports exactly which behaviors would lose
 * verified status and why, changing nothing; `--apply` applies that same set.
 *
 * Founder decision (2026-07-25): report first, apply on command. The count is
 * the honest measure of how much of the substrate was verified by assertion.
 */

import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, readDb, requireBuild, rowsOf, runCli, type Workspace } from "./harness.js";
import { importOneBehavior, scratchRegistry } from "./lb-27-fixture.js";

function statusOf(dbPath: string, behaviorId: string): string | undefined {
  return rowsOf(dbPath, "behaviors").find((row) => row.id === behaviorId)?.status as string | undefined;
}

describe("LB-27-B6 · demote reports before it acts", () => {
  let workspace: Workspace;
  let registry: string;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb27b6");
    await cliOk(["init"], { db: workspace.db });
    const script = join(workspace.dir, "ok.sh");
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o755);
    registry = scratchRegistry(workspace, [
      { id: "scratch-ok", tier: "wired", runner: "script", target: script, purpose: "exits 0" },
    ]);

    // One behavior verified the honest way, one verified by assertion. The
    // asserted row is written before the gate exists in this fixture's history,
    // mirroring LB-16/LB-18/LB-21's real situation.
    // Deliberately tolerant: `prove` does not exist until LB-27 lands, and a
    // throwing beforeAll would SKIP every assertion below. A skipped test is not
    // a recorded red — it is an absence of evidence either way.
    await importOneBehavior(workspace, { issueId: "DEM-OK", harnessRef: "scratch-ok" });
    await runCli(["prove", "DEM-OK-B1", "--registry", registry], { db: workspace.db });
    const proved = readDb(workspace.db, (db) =>
      (db.prepare("SELECT id FROM evidence WHERE behavior_id = ? ORDER BY rowid DESC LIMIT 1").get("DEM-OK-B1") as { id: string } | undefined)?.id);
    if (proved) await runCli(["verify", "DEM-OK-B1", "--evidence", proved], { db: workspace.db });

    await importOneBehavior(workspace, { issueId: "DEM-BAD", harnessRef: "scratch-ok" });
    await cliOk(["evidence", "DEM-BAD", "--behavior", "DEM-BAD-B1", "--tier", "wired", "--verdict", "pass",
      "--summary", "Asserted, never executed."], { db: workspace.db });
    readDb(workspace.db, (db) => db.prepare("UPDATE behaviors SET status = 'verified' WHERE id = ?").run("DEM-BAD-B1"));
  });

  afterAll(() => workspace?.dispose());

  it("names the assertion-verified behavior in the dry run", async () => {
    const result = await runCli(["demote", "--dry-run"], { db: workspace.db });
    expect(result.code, `demote --dry-run exited ${result.code}: ${result.stderr}`).toBe(0);
    expect(result.stdout, "the dry run does not name the assertion-verified behavior").toContain("DEM-BAD-B1");
  });

  it("leaves the honestly-verified behavior out of the dry run", async () => {
    const result = await runCli(["demote", "--dry-run"], { db: workspace.db });
    // Without this, an error payload trivially "does not contain DEM-OK-B1" and
    // the exclusion assertion passes while `demote` does not exist.
    expect(result.code, `demote --dry-run exited ${result.code}: ${result.stderr}`).toBe(0);
    expect(statusOf(workspace.db, "DEM-OK-B1"), "the honestly-verified fixture never reached verified").toBe("verified");
    expect(result.stdout, "the dry run would demote a behavior proved by execution").not.toContain("DEM-OK-B1");
  });

  it("changes nothing on a dry run", async () => {
    await runCli(["demote", "--dry-run"], { db: workspace.db });
    expect(statusOf(workspace.db, "DEM-BAD-B1"), "the dry run mutated the substrate").toBe("verified");
    expect(statusOf(workspace.db, "DEM-OK-B1")).toBe("verified");
  });

  it("demotes exactly the reported set on --apply", async () => {
    const result = await runCli(["demote", "--apply"], { db: workspace.db });
    expect(result.code, `demote --apply exited ${result.code}: ${result.stderr}`).toBe(0);
    expect(statusOf(workspace.db, "DEM-BAD-B1"), "the assertion-verified behavior was not demoted").toBe("pending");
    expect(statusOf(workspace.db, "DEM-OK-B1"), "an executed-proof behavior was demoted").toBe("verified");
  });

  it("is idempotent — a second apply demotes nothing further", async () => {
    const result = await runCli(["demote", "--apply"], { db: workspace.db });
    expect(result.code).toBe(0);
    expect(statusOf(workspace.db, "DEM-OK-B1")).toBe("verified");
  });
});
