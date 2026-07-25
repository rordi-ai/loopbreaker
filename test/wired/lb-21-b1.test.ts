/**
 * LB-21-B1 — All twelve write sites across the ten written tables stamp provenance.
 *
 * verify: "Drive all ten writers through real CLI and MCP ingresses against a
 * disposable database and read back every one of the ten tables, asserting
 * non-null trigger_type and triggered_by on each written row version, with the
 * two profile-setter rows and both behaviour-status progressions asserted
 * explicitly."
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOMAIN_TABLES, makeWorkspace, missingProvenanceColumns, requireBuild, rowsOf, type Workspace } from "./harness.js";
import { driveAllWriters, type DrivenFixture } from "./fixture.js";

describe("LB-21-B1 · every write site stamps provenance", () => {
  let workspace: Workspace;
  let fixture: DrivenFixture;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("b1");
    fixture = await driveAllWriters(workspace);
  });

  afterAll(() => workspace?.dispose());

  it("carries the provenance columns on all ten domain tables", () => {
    const gaps = DOMAIN_TABLES.map((table) => ({ table, missing: missingProvenanceColumns(workspace.db, table) }))
      .filter((entry) => entry.missing.length > 0);
    expect(gaps, `tables missing provenance columns: ${gaps.map((g) => `${g.table}(${g.missing.join(",")})`).join(" ")}`).toEqual([]);
  });

  it("wrote at least one row version into every one of the ten tables", () => {
    const empty = DOMAIN_TABLES.filter((table) => rowsOf(workspace.db, table).length === 0);
    expect(empty, `the fixture failed to reach: ${empty.join(", ")}`).toEqual([]);
  });

  it.each(DOMAIN_TABLES)("stamps non-null trigger_type and triggered_by on every %s row", (table) => {
    expect(missingProvenanceColumns(workspace.db, table), `${table} has no provenance columns yet`).toEqual([]);
    const unstamped = rowsOf(workspace.db, table).filter(
      (row) => row.trigger_type === null || row.trigger_type === undefined || row.triggered_by === null || row.triggered_by === undefined,
    );
    expect(unstamped.length, `${unstamped.length} unstamped rows in ${table}`).toBe(0);
  });

  it("stamps the two db.ts profile-setter rows, not only the direct INSERTs", () => {
    for (const table of ["shape_assessments", "planning_profiles"] as const) {
      expect(missingProvenanceColumns(workspace.db, table), `${table} has no provenance columns yet`).toEqual([]);
      const rows = rowsOf(workspace.db, table);
      expect(rows.length, `no ${table} row was written`).toBeGreaterThan(0);
      for (const row of rows) expect(row.trigger_type, `${table} row is unstamped`).toBeTruthy();
    }
  });

  it("stamps both behaviour-status progressions (verify and waive)", () => {
    expect(missingProvenanceColumns(workspace.db, "behaviors"), "behaviors has no provenance columns yet").toEqual([]);
    const behaviors = rowsOf(workspace.db, "behaviors");
    const verified = behaviors.find((row) => row.id === fixture.verifiedBehaviorId);
    const waived = behaviors.find((row) => row.id === fixture.waivedBehaviorId);
    expect(verified?.status).toBe("verified");
    expect(waived?.status).toBe("waived");
    expect(verified?.trigger_type, "the verifyBehavior status UPDATE left provenance unstamped").toBeTruthy();
    expect(waived?.trigger_type, "the createWaiver status UPDATE left provenance unstamped").toBeTruthy();
  });
});
