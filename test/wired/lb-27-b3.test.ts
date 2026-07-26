/**
 * LB-27-B3 — evidence records whether loopbreaker executed it, and a pass with
 * no red baseline is flagged rather than refused.
 *
 * Founder decision (2026-07-25): warn but record. A behavior whose code already
 * exists can never produce a red baseline retroactively, so refusing would
 * strand the existing backlog. The flag keeps the fact visible.
 */

import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, columnsOf, makeWorkspace, requireBuild, rowsOf, runCli, type Workspace } from "./harness.js";
import { importOneBehavior, scratchRegistry } from "./lb-27-fixture.js";

describe("LB-27-B3 · executed-ness and baseline state are recorded", () => {
  let workspace: Workspace;
  let registry: string;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb27b3");
    await cliOk(["init"], { db: workspace.db });

    const script = join(workspace.dir, "ok.sh");
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o755);
    registry = scratchRegistry(workspace, [
      { id: "scratch-ok", tier: "wired", runner: "script", target: script, purpose: "exits 0", proves: ["EXEC-1-B1", "EXEC-2-B1"] },
    ]);

    await importOneBehavior(workspace, { issueId: "EXEC-1", harnessRef: "scratch-ok" });
    await runCli(["prove", "EXEC-1-B1", "--registry", registry], { db: workspace.db });

    // A hand-asserted row, the pre-LB-27 path, for contrast.
    await importOneBehavior(workspace, { issueId: "EXEC-2", harnessRef: "scratch-ok" });
    await cliOk(
      ["evidence", "EXEC-2", "--behavior", "EXEC-2-B1", "--tier", "wired", "--verdict", "pass", "--summary", "Asserted by hand."],
      { db: workspace.db },
    );
  });

  afterAll(() => workspace?.dispose());

  it("carries an executed column on evidence", () => {
    expect(columnsOf(workspace.db, "evidence"), "evidence has no executed column").toContain("executed");
  });

  it("marks evidence produced by `prove` as executed", () => {
    const row = rowsOf(workspace.db, "evidence").filter((item) => item.behavior_id === "EXEC-1-B1").at(-1);
    expect(row, "prove recorded no evidence").toBeDefined();
    expect(Number(row?.executed), "prove-produced evidence is not marked executed").toBe(1);
  });

  it("marks hand-asserted evidence as NOT executed", () => {
    // Assert the column exists first: without it `row.executed` is undefined and
    // a `?? 0` default would make this pass while the feature is entirely absent.
    expect(columnsOf(workspace.db, "evidence"), "evidence has no executed column").toContain("executed");
    const row = rowsOf(workspace.db, "evidence").filter((item) => item.behavior_id === "EXEC-2-B1").at(-1);
    expect(row, "the asserted evidence was not recorded").toBeDefined();
    expect(Number(row?.executed), "hand-asserted evidence claims to have been executed").toBe(0);
  });

  it("captures what the run actually produced, not a caller's description", () => {
    const row = rowsOf(workspace.db, "evidence").filter((item) => item.behavior_id === "EXEC-1-B1").at(-1);
    expect(row?.exit_code, "prove recorded no exit code").toBe(0);
    expect(row?.harness_id, "prove did not record which registry entry ran").toBe("scratch-ok");
  });

  it("flags a pass recorded with no red baseline, without refusing it", async () => {
    const row = rowsOf(workspace.db, "evidence").filter((item) => item.behavior_id === "EXEC-1-B1").at(-1);
    expect(row?.verdict, "the pass was refused rather than flagged").toBe("pass");
    expect(columnsOf(workspace.db, "evidence"), "evidence cannot express baseline state").toContain("baselined");
    expect(Number(row?.baselined ?? 0), "a pass with no recorded red baseline should read unbaselined").toBe(0);
    const substrate = await runCli(["substrate", "EXEC-1"], { db: workspace.db });
    expect(substrate.stdout, "the read model does not surface baseline state").toContain("baselined");
  });
});
