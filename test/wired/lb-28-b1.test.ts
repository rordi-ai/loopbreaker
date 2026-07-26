/**
 * LB-28-B1 — a discovery record stores one answer per required shape field,
 * each with the question that produced it.
 *
 * Per-field, not a transcript: LB-25's stronger field-isomorphic binding then
 * builds on this storage instead of replacing it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, columnsOf, makeWorkspace, requireBuild, rowsOf, runCli, type Workspace } from "./harness.js";
import { REQUIRED_FIELDS, importAndShape, writeDiscovery } from "./lb-28-fixture.js";

describe("LB-28-B1 · a discovery record is per-field", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb28b1");
    await cliOk(["init"], { db: workspace.db });
    await importAndShape(workspace, "DISC-1");
  });

  afterAll(() => workspace?.dispose());

  it("stores discovery answers in their own table", async () => {
    const result = await runCli(["discover", "DISC-1", writeDiscovery(workspace, "DISC-1")], { db: workspace.db });
    expect(result.code, `discover exited ${result.code}: ${result.stderr}`).toBe(0);
    const columns = columnsOf(workspace.db, "discovery_answers");
    for (const column of ["issue_id", "field", "question", "answer"]) {
      expect(columns, `discovery_answers has no ${column} column`).toContain(column);
    }
  });

  it("records one row per required shape field", () => {
    const fields = rowsOf(workspace.db, "discovery_answers")
      .filter((row) => row.issue_id === "DISC-1")
      .map((row) => row.field);
    for (const field of REQUIRED_FIELDS) {
      expect(fields, `no discovery answer recorded for ${field}`).toContain(field);
    }
  });

  it("keeps the question that produced each answer", () => {
    const rows = rowsOf(workspace.db, "discovery_answers").filter((row) => row.issue_id === "DISC-1");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(String(row.question ?? ""), `${row.field} has no question`).not.toBe("");
      expect(String(row.answer ?? ""), `${row.field} has no answer`).not.toBe("");
    }
  });

  it("refuses a record that leaves a required field unanswered, by name", async () => {
    await importAndShape(workspace, "DISC-2");
    const partial = writeDiscovery(workspace, "DISC-2", ["problem", "appetite"]);
    const result = await runCli(["discover", "DISC-2", partial], { db: workspace.db });
    expect(result.code, "a partial discovery record was accepted").not.toBe(0);
    expect(`${result.stdout}${result.stderr}`, "the refusal does not name a missing field").toContain("success_signal");
  });

  it("reads the record back over the CLI", async () => {
    const result = await runCli(["discovery", "DISC-1"], { db: workspace.db });
    expect(result.code, `discovery exited ${result.code}: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("problem");
    expect(result.stdout, "the readout does not expose approval state").toMatch(/status|approved/);
  });
});
