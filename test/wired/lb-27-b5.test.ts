/**
 * LB-27-B5 — evidence tier is read from the registry entry, not from a caller
 * argument.
 *
 * Today `--tier wired` is typed by the caller, which is how the DEMO-1 injection
 * escaped the one mechanical defence (`enforced + unit` is refused). If the
 * registry declares the tier, typing `wired` no longer makes a proof wired.
 */

import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, requireBuild, rowsOf, runCli, type Workspace } from "./harness.js";
import { importOneBehavior, realRegistry, scratchRegistry } from "./lb-27-fixture.js";

describe("LB-27-B5 · tier is declared by the registry, not the caller", () => {
  let workspace: Workspace;
  let registry: string;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb27b5");
    await cliOk(["init"], { db: workspace.db });
    const script = join(workspace.dir, "ok.sh");
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o755);
    registry = scratchRegistry(workspace, [
      { id: "declared-unit", tier: "unit", runner: "script", target: script, purpose: "a unit-tier harness" },
      { id: "declared-live", tier: "live", runner: "script", target: script, purpose: "a live-tier harness" },
    ]);
  });

  afterAll(() => workspace?.dispose());

  it("stamps the registry's tier onto the evidence row", async () => {
    await importOneBehavior(workspace, { issueId: "TIER-1", harnessRef: "declared-unit" });
    await cliOk(["prove", "TIER-1-B1", "--registry", registry], { db: workspace.db });
    const row = rowsOf(workspace.db, "evidence").filter((item) => item.behavior_id === "TIER-1-B1").at(-1);
    expect(row?.tier, "the evidence tier did not come from the registry").toBe("unit");
  });

  it("ignores any caller attempt to override the tier", async () => {
    const result = await runCli(
      ["prove", "TIER-1-B1", "--tier", "live", "--registry", registry],
      { db: workspace.db },
    );
    expect(result.code, "prove should reject an unknown --tier flag rather than honour it").not.toBe(0);
    // Precondition: the earlier plain `prove` must already have left a row, or
    // "no live tier reached the DB" is true only because the DB is empty.
    const rows = rowsOf(workspace.db, "evidence").filter((item) => item.behavior_id === "TIER-1-B1");
    expect(rows.length, "no evidence exists, so the override assertion proves nothing").toBeGreaterThan(0);
    expect(rows.some((row) => row.tier === "live"), "a caller-supplied --tier reached the evidence row").toBe(false);
  });

  it("still refuses to verify an enforced behavior proved by a unit-tier harness", async () => {
    const row = rowsOf(workspace.db, "evidence").filter((item) => item.behavior_id === "TIER-1-B1").at(-1);
    // Without these preconditions the verify below fails for want of an evidence
    // row rather than because the tier was refused — a pass that proves nothing.
    expect(row, "no evidence exists to attempt verification with").toBeDefined();
    expect(row?.tier, "the evidence under test is not unit-tier").toBe("unit");
    const result = await runCli(["verify", "TIER-1-B1", "--evidence", String(row?.id)], { db: workspace.db });
    expect(result.code, "a unit-tier proof verified an enforced behavior").not.toBe(0);
  });

  it("requires an explicit live opt-in before running a live-tier harness", async () => {
    await importOneBehavior(workspace, { issueId: "TIER-2", harnessRef: "declared-live" });
    const guarded = await runCli(["prove", "TIER-2-B1", "--registry", registry], { db: workspace.db });
    expect(guarded.code, "a live harness ran without an explicit opt-in").not.toBe(0);
    expect(`${guarded.stdout}${guarded.stderr}`.toLowerCase()).toMatch(/live/);

    const allowed = await runCli(["prove", "TIER-2-B1", "--live", "--registry", registry], { db: workspace.db });
    expect(allowed.code, `prove --live exited ${allowed.code}: ${allowed.stderr}`).toBe(0);
  });

  it("declares a tier for every entry in the shipped registry", () => {
    for (const entry of realRegistry().harnesses) {
      expect(["unit", "wired", "live"], `${entry.id} has no valid tier`).toContain(entry.tier);
    }
  });
});
