/**
 * LB-27-B4 — an enforced behavior cannot be verified on non-executed evidence.
 *
 * The mirror of `verifyBehavior`'s existing enforced+unit refusal, and the
 * assertion that actually closes the hole demonstrated on DEMO-1: declaring
 * `tier: wired, verdict: pass` for a harness that was never run.
 */

import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, readDb, requireBuild, rowsOf, runCli, type Workspace } from "./harness.js";
import { importOneBehavior, scratchRegistry } from "./lb-27-fixture.js";

function latestEvidenceId(dbPath: string, behaviorId: string): string {
  return readDb(dbPath, (db) =>
    (db.prepare("SELECT id FROM evidence WHERE behavior_id = ? ORDER BY rowid DESC LIMIT 1").get(behaviorId) as { id: string }).id,
  );
}

describe("LB-27-B4 · asserted evidence cannot verify an enforced behavior", () => {
  let workspace: Workspace;
  let registry: string;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb27b4");
    await cliOk(["init"], { db: workspace.db });
    const script = join(workspace.dir, "ok.sh");
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o755);
    registry = scratchRegistry(workspace, [
      { id: "scratch-ok", tier: "wired", runner: "script", target: script, purpose: "exits 0" },
    ]);
  });

  afterAll(() => workspace?.dispose());

  it("refuses to verify an enforced behavior on hand-asserted evidence, by name", async () => {
    await importOneBehavior(workspace, { issueId: "GATE-1", harnessRef: "scratch-ok" });
    await cliOk(
      ["evidence", "GATE-1", "--behavior", "GATE-1-B1", "--tier", "wired", "--verdict", "pass",
        "--summary", "A wired replay harness passes end to end.", "--source", "tests/replay/does-not-exist.test.ts"],
      { db: workspace.db },
    );
    const evidenceId = latestEvidenceId(workspace.db, "GATE-1-B1");
    const result = await runCli(["verify", "GATE-1-B1", "--evidence", evidenceId], { db: workspace.db });

    expect(result.code, "asserted evidence verified an enforced behavior").not.toBe(0);
    expect(`${result.stdout}${result.stderr}`.toLowerCase(), "the refusal does not explain itself")
      .toMatch(/execut|not run|prove/);

    const behavior = rowsOf(workspace.db, "behaviors").find((row) => row.id === "GATE-1-B1");
    expect(behavior?.status, "the behavior was verified anyway").toBe("pending");
  });

  it("verifies an enforced behavior on evidence loopbreaker executed", async () => {
    await importOneBehavior(workspace, { issueId: "GATE-2", harnessRef: "scratch-ok" });
    await cliOk(["prove", "GATE-2-B1", "--registry", registry], { db: workspace.db });
    const evidenceId = latestEvidenceId(workspace.db, "GATE-2-B1");
    const result = await runCli(["verify", "GATE-2-B1", "--evidence", evidenceId], { db: workspace.db });

    expect(result.code, `verify exited ${result.code}: ${result.stderr}`).toBe(0);
    const behavior = rowsOf(workspace.db, "behaviors").find((row) => row.id === "GATE-2-B1");
    expect(behavior?.status).toBe("verified");
  });

  it("never verifies on a not_run verdict", async () => {
    scratchRegistry(workspace, [
      { id: "scratch-absent", tier: "wired", runner: "script", target: join(workspace.dir, "absent.sh"), purpose: "missing" },
    ]);
    await importOneBehavior(workspace, { issueId: "GATE-3", harnessRef: "scratch-absent" });
    await runCli(["prove", "GATE-3-B1", "--registry", join(workspace.dir, "harnesses.json")], { db: workspace.db });
    const rows = rowsOf(workspace.db, "evidence").filter((row) => row.behavior_id === "GATE-3-B1");
    // No conditional guard: without a recorded not_run row there is nothing to
    // assert against, and the test would pass simply because nothing happened.
    expect(rows.length, "the unrunnable harness recorded no not_run evidence to test against").toBeGreaterThan(0);
    expect(rows.at(-1)?.verdict).toBe("not_run");
    const result = await runCli(["verify", "GATE-3-B1", "--evidence", String(rows.at(-1)?.id)], { db: workspace.db });
    expect(result.code, "not_run evidence verified a behavior").not.toBe(0);
    const behavior = rowsOf(workspace.db, "behaviors").find((row) => row.id === "GATE-3-B1");
    expect(behavior?.status).toBe("pending");
  });
});
