/**
 * LB-28-B2 — shape cannot reach `proceed` without an APPROVED discovery record,
 * and a draft record does not satisfy the gate.
 *
 * Drafting a shape stays legal — deriving one from an approved record is exactly
 * what a shaping agent should do. What is refused is `proceed` on a premise no
 * human ever approved.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, requireBuild, runCli, type Workspace } from "./harness.js";
import { importAndShape, writeDiscovery } from "./lb-28-fixture.js";

describe("LB-28-B2 · the gate holds shape until discovery is approved", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb28b2");
    await cliOk(["init"], { db: workspace.db });
  });

  afterAll(() => workspace?.dispose());

  it("holds a complete `proceed` shape when no discovery record exists", async () => {
    await importAndShape(workspace, "GATE-A");
    const result = await runCli(["readiness", "GATE-A"], { db: workspace.db });
    expect(result.code, `readiness exited ${result.code}: ${result.stderr}`).toBe(0);
    expect(result.stdout, "the shape gate opened with no discovery record").toContain("missing_discovery");
  });

  it("still holds while the discovery record is only a draft", async () => {
    await cliOk(["discover", "GATE-A", writeDiscovery(workspace, "GATE-A")], { db: workspace.db });
    const result = await runCli(["readiness", "GATE-A"], { db: workspace.db });
    expect(result.stdout, "an unapproved draft satisfied the gate").toContain("discovery");
    expect(result.stdout).toMatch(/unapproved_discovery|missing_discovery/);
  });

  it("opens once the record is approved", async () => {
    await cliOk(["discover", "GATE-A", "--approve", "--by", "ben@rordi.ai"], { db: workspace.db });
    const result = await runCli(["readiness", "GATE-A"], { db: workspace.db });
    expect(result.code).toBe(0);
    expect(result.stdout, "an approved record did not open the shape gate").not.toMatch(/missing_discovery|unapproved_discovery/);
  });

  it("still records the shape while the gate holds — drafting stays legal", async () => {
    await importAndShape(workspace, "GATE-B");
    const substrate = await runCli(["substrate", "GATE-B"], { db: workspace.db });
    expect(substrate.code).toBe(0);
    expect(substrate.stdout, "the shape was not persisted while discovery was missing").toContain("disposition: proceed");
    expect(substrate.stdout, "the shape reported ready without discovery").toContain("missing_discovery");
  });
});
