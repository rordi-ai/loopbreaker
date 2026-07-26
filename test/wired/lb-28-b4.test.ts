/**
 * LB-28-B4 — pre-gate issues are grandfathered, and discovery is the first
 * ordered authority in `delivery_readiness`.
 *
 * The grandfather cohort is recorded as data at migration time rather than
 * derived from a date comparison, so who was exempted is inspectable rather
 * than implicit.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, readDb, requireBuild, rowsOf, runCli, type Workspace } from "./harness.js";
import { importAndShape, writeDiscovery } from "./lb-28-fixture.js";

describe("LB-28-B4 · grandfathering and ordered authority", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb28b4");
    await cliOk(["init"], { db: workspace.db });
    await cliOk(["demo"], { db: workspace.db });
    // Simulate a PRE-GATE database: an issue that was shaped before discovery
    // existed. Dropping the tables puts the schema back where it was, so the
    // next command's migrate() is genuinely the introducing one and the
    // grandfather sweep runs against real prior state.
    await importAndShape(workspace, "LEGACY-1");
    readDb(workspace.db, (db) => {
      db.exec("DROP TABLE discovery_answers");
      db.exec("DROP TABLE discovery_records");
    });
    await cliOk(["readiness", "LEGACY-1"], { db: workspace.db });
  });

  afterAll(() => workspace?.dispose());

  it("exempts issues that were already shaped when the gate arrived", async () => {
    // DEMO-1 is seeded with a complete `proceed` shape and no discovery record.
    // It must not be retroactively blocked.
    // Precondition: without a recorded grandfather row, "DEMO-1 is not blocked"
    // is true merely because the gate does not exist yet.
    const cohort = rowsOf(workspace.db, "discovery_records").filter((row) => row.status === "grandfathered");
    expect(cohort.some((row) => row.issue_id === "LEGACY-1"), "the pre-gate issue was never grandfathered").toBe(true);
    const result = await runCli(["readiness", "LEGACY-1"], { db: workspace.db });
    expect(result.code, `readiness exited ${result.code}: ${result.stderr}`).toBe(0);
    expect(result.stdout, "a pre-gate issue was retroactively blocked").not.toContain("missing_discovery");
  });

  it("records the grandfathered cohort as inspectable data", () => {
    const rows = rowsOf(workspace.db, "discovery_records").filter((row) => row.status === "grandfathered");
    expect(rows.length, "no grandfather rows were recorded").toBeGreaterThan(0);
    expect(rows.some((row) => row.issue_id === "LEGACY-1"), "the pre-gate issue is not in the cohort").toBe(true);
    // The sweep is for PRIOR state only: an issue shaped after the gate must not
    // be swept in, or grandfathering silently becomes a permanent bypass.
    expect(rows.some((row) => row.issue_id === "POST-1"), "a post-gate issue was grandfathered").toBe(false);
  });

  it("still blocks an issue created after the gate", async () => {
    await importAndShape(workspace, "POST-1");
    const result = await runCli(["readiness", "POST-1"], { db: workspace.db });
    expect(result.stdout, "a post-gate issue was silently grandfathered").toContain("missing_discovery");
  });

  it("exposes discovery as the first ordered authority", async () => {
    const result = await runCli(["readiness", "POST-1"], { db: workspace.db });
    expect(result.stdout, "readiness exposes no discovery authority").toContain("discovery");
    // Discovery must gate ahead of shape: an issue held at discovery reports
    // that, not a downstream stage.
    expect(result.stdout).toMatch(/gate: discovery/);
  });

  it("hands the gate to shape once discovery is approved", async () => {
    await cliOk(["discover", "POST-1", writeDiscovery(workspace, "POST-1")], { db: workspace.db });
    await cliOk(["discover", "POST-1", "--approve", "--by", "ben@rordi.ai"], { db: workspace.db });
    const result = await runCli(["readiness", "POST-1"], { db: workspace.db });
    expect(result.stdout, "discovery still holds after approval").not.toMatch(/gate: discovery/);
  });
});
