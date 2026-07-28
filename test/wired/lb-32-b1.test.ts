/**
 * LB-32-B1 — the ship decision names behaviors verified on unbaselined proof.
 *
 * `baselined` already existed per evidence row, but nothing surfaced it where
 * the decision is made. The HEALTH-1 dry run shipped with all three behaviors
 * unbaselined while its own plan promised "observed red before implementation
 * and green after" — and finding that required opening SQLite.
 *
 * Warn-but-record is the chosen policy, so this does NOT block. It makes the
 * gap visible at the decision point instead of buried in a column.
 */

import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, readDb, requireBuild, runCli, type Workspace } from "./harness.js";
import { importOneBehavior, scratchRegistry } from "./lb-27-fixture.js";

function latestEvidenceId(dbPath: string, behaviorId: string): string {
  return readDb(dbPath, (db) =>
    (db.prepare("SELECT id FROM evidence WHERE behavior_id = ? ORDER BY rowid DESC LIMIT 1").get(behaviorId) as { id: string }).id,
  );
}

describe("LB-32-B1 · unbaselined proof is visible at the ship decision", () => {
  let workspace: Workspace;
  let passing: string;
  let flipping: string;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb32b1");
    await cliOk(["init"], { db: workspace.db });

    passing = join(workspace.dir, "always.sh");
    writeFileSync(passing, "#!/bin/sh\nexit 0\n");
    chmodSync(passing, 0o755);

    // Fails while a sentinel is absent, passes once it exists — so a genuine
    // red baseline can be recorded before the green run, like real work.
    flipping = join(workspace.dir, "flip.sh");
    writeFileSync(flipping, `#!/bin/sh\n[ -f "${join(workspace.dir, "built")}" ] || exit 1\nexit 0\n`);
    chmodSync(flipping, 0o755);
  });

  afterAll(() => workspace?.dispose());

  it("names a behavior whose passing proof was never observed failing", async () => {
    const registry = scratchRegistry(workspace, [
      { id: "always", tier: "wired", runner: "script", target: passing, purpose: "exits 0", proves: ["UNBASE-1-B1"] },
    ]);
    await importOneBehavior(workspace, { issueId: "UNBASE-1", harnessRef: "always" });
    await cliOk(["prove", "UNBASE-1-B1", "--registry", registry], { db: workspace.db });
    await cliOk(["verify", "UNBASE-1-B1", "--evidence", latestEvidenceId(workspace.db, "UNBASE-1-B1")], { db: workspace.db });

    const result = await runCli(["substrate", "UNBASE-1"], { db: workspace.db });
    expect(result.code).toBe(0);
    expect(result.stdout, "the ship decision hides that the proof was never seen failing")
      .toContain("unbaselined_behavior_ids");
    expect(result.stdout).toContain("UNBASE-1-B1");
  });

  it("does not block — warn-but-record, not enforcement", async () => {
    // The fixture never cleared discovery, so it is held there; what matters is
    // that baselining is NOT among the reasons and the behavior stayed verified.
    const result = await runCli(["substrate", "UNBASE-1"], { db: workspace.db });
    expect(result.stdout, "an unbaselined pass became a blocking reason").not.toMatch(/reason:.*baselin/i);
    expect(result.stdout).toContain("status: verified");
  });

  it("leaves the list empty when the harness was genuinely proven red first", async () => {
    const registry = scratchRegistry(workspace, [
      { id: "flip", tier: "wired", runner: "script", target: flipping, purpose: "red then green", proves: ["BASE-1-B1"] },
    ]);
    await importOneBehavior(workspace, { issueId: "BASE-1", harnessRef: "flip" });

    // Red first, through the gate, so the baseline is recorded.
    const red = await runCli(["prove", "BASE-1-B1", "--registry", registry], { db: workspace.db });
    expect(red.stdout, "the harness did not fail before the work existed").toContain("verdict: fail");

    writeFileSync(join(workspace.dir, "built"), "");
    await cliOk(["prove", "BASE-1-B1", "--registry", registry], { db: workspace.db });
    await cliOk(["verify", "BASE-1-B1", "--evidence", latestEvidenceId(workspace.db, "BASE-1-B1")], { db: workspace.db });

    const result = await runCli(["substrate", "BASE-1"], { db: workspace.db });
    const line = result.stdout.split("\n").find((row) => row.includes("unbaselined_behavior_ids")) ?? "";
    expect(line, "no unbaselined readout was emitted at all").not.toBe("");
    expect(line, "a properly baselined behavior was reported as unbaselined").not.toContain("BASE-1-B1");
  });
});
