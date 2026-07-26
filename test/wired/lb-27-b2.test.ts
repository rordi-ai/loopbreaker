/**
 * LB-27-B2 — `prove` derives the verdict from the runner's exit code, never
 * from a caller argument, and `not_run` is the fail-closed default.
 *
 * This is the behavior that closes the evidence-injection hole: today
 * `recordEvidence` accepts `verdict` from whoever calls it.
 */

import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, requireBuild, rowsOf, runCli, type Workspace } from "./harness.js";
import { importOneBehavior, scratchRegistry } from "./lb-27-fixture.js";

/** A script harness that exits with the code we choose — the cleanest way to pin verdict-from-exit-code. */
function writeScript(workspace: Workspace, name: string, exitCode: number): string {
  const path = join(workspace.dir, name);
  writeFileSync(path, `#!/bin/sh\necho "harness ${name} ran"\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("LB-27-B2 · the verdict comes from the run", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb27b2");
    await cliOk(["init"], { db: workspace.db });

    const passing = writeScript(workspace, "passing.sh", 0);
    const failing = writeScript(workspace, "failing.sh", 1);
    scratchRegistry(workspace, [
      { id: "scratch-pass", tier: "wired", runner: "script", target: passing, purpose: "exits 0", proves: ["PROVE-OK-B1"] },
      { id: "scratch-fail", tier: "wired", runner: "script", target: failing, purpose: "exits 1", proves: ["PROVE-BAD-B1"] },
    ]);

    await importOneBehavior(workspace, { issueId: "PROVE-OK", harnessRef: "scratch-pass" });
    await importOneBehavior(workspace, { issueId: "PROVE-BAD", harnessRef: "scratch-fail" });
  });

  afterAll(() => workspace?.dispose());

  it("records `pass` when the harness exits 0", async () => {
    const result = await runCli(["prove", "PROVE-OK-B1", "--registry", join(workspace.dir, "harnesses.json")], { db: workspace.db });
    expect(result.code, `prove exited ${result.code}: ${result.stderr}`).toBe(0);
    const evidence = rowsOf(workspace.db, "evidence").filter((row) => row.behavior_id === "PROVE-OK-B1");
    expect(evidence.length, "prove recorded no evidence").toBeGreaterThan(0);
    expect(evidence.at(-1)?.verdict).toBe("pass");
  });

  it("records `fail` when the harness exits non-zero, regardless of intent", async () => {
    await runCli(["prove", "PROVE-BAD-B1", "--registry", join(workspace.dir, "harnesses.json")], { db: workspace.db });
    const evidence = rowsOf(workspace.db, "evidence").filter((row) => row.behavior_id === "PROVE-BAD-B1");
    expect(evidence.length, "prove recorded no evidence for the failing harness").toBeGreaterThan(0);
    expect(evidence.at(-1)?.verdict).toBe("fail");
  });

  it("offers no way to hand `prove` a verdict", async () => {
    // The point of the gate: a caller may choose WHICH harness runs, never what
    // the run concluded. A --verdict flag on prove would reopen the hole.
    const result = await runCli(
      ["prove", "PROVE-BAD-B1", "--verdict", "pass", "--registry", join(workspace.dir, "harnesses.json")],
      { db: workspace.db },
    );
    expect(result.code, "prove should reject an unknown --verdict flag rather than honour it").not.toBe(0);
    // Precondition, so this cannot pass vacuously while `prove` is absent: the
    // failing harness must already have produced evidence via the plain call.
    const evidence = rowsOf(workspace.db, "evidence").filter((row) => row.behavior_id === "PROVE-BAD-B1");
    expect(evidence.length, "no evidence exists, so the override assertion proves nothing").toBeGreaterThan(0);
    expect(evidence.some((row) => row.verdict === "pass"), "a caller-supplied --verdict reached the evidence row").toBe(false);
  });

  it("records `not_run` rather than a decided verdict when the harness cannot execute", async () => {
    scratchRegistry(workspace, [
      { id: "scratch-missing", tier: "wired", runner: "script", target: join(workspace.dir, "does-not-exist.sh"), purpose: "absent", proves: ["PROVE-MISSING-B1"] },
    ]);
    await importOneBehavior(workspace, { issueId: "PROVE-MISSING", harnessRef: "scratch-missing" });
    await runCli(["prove", "PROVE-MISSING-B1", "--registry", join(workspace.dir, "harnesses.json")], { db: workspace.db });
    const evidence = rowsOf(workspace.db, "evidence").filter((row) => row.behavior_id === "PROVE-MISSING-B1");
    // No conditional guard: an unrunnable harness must still leave a row saying
    // so. Silence is the fail-open this behavior exists to prevent.
    expect(evidence.length, "an unrunnable harness recorded nothing at all").toBeGreaterThan(0);
    expect(evidence.at(-1)?.verdict, "an unrunnable harness must not record a decided verdict").toBe("not_run");
  });
});
