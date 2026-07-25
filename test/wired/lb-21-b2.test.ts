/**
 * LB-21-B2 — trigger_type is the ingress that opened the database.
 *
 * verify: "Perform the identical mutation once through the CLI and once through
 * the MCP server against a disposable database and observe exactly cli and mcp
 * on the two persisted rows, and assert by source scan that no hook path
 * invokes a writer."
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOT, cliOk, makeWorkspace, missingProvenanceColumns, requireBuild, rowsOf, withMcp, type Workspace } from "./harness.js";

const ISSUE_CLI = "INGRESS-CLI";
const ISSUE_MCP = "INGRESS-MCP";

/** The identical mutation, expressed once per ingress: import a one-behavior contract. */
function contractFor(issueId: string) {
  return {
    issue_id: issueId,
    title: "Ingress attribution fixture",
    description: "Identical mutation driven through two ingresses.",
    behaviors: [{
      id: `${issueId}-B1`,
      title: "Fixture behavior",
      trigger: "A mutation runs.",
      expected: "Provenance is stamped.",
      verify: "Read the row back.",
    }],
  };
}

describe("LB-21-B2 · trigger_type is the ingress", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("b2");
    await cliOk(["init"], { db: workspace.db });

    const cliContract = join(workspace.dir, "cli-contract.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(cliContract, JSON.stringify(contractFor(ISSUE_CLI)));
    await cliOk(["import", cliContract], { db: workspace.db });

    await withMcp(workspace.db, async (client) => {
      await client.callTool({ name: "review_import_contract", arguments: contractFor(ISSUE_MCP) });
    });
  });

  afterAll(() => workspace?.dispose());

  it("stamps exactly `cli` on the CLI-driven row", () => {
    expect(missingProvenanceColumns(workspace.db, "issues"), "issues has no provenance columns yet").toEqual([]);
    const row = rowsOf(workspace.db, "issues").find((entry) => entry.id === ISSUE_CLI);
    expect(row, "the CLI import did not persist an issue").toBeDefined();
    expect(row?.trigger_type).toBe("cli");
  });

  it("stamps exactly `mcp` on the MCP-driven row", () => {
    expect(missingProvenanceColumns(workspace.db, "issues"), "issues has no provenance columns yet").toEqual([]);
    const row = rowsOf(workspace.db, "issues").find((entry) => entry.id === ISSUE_MCP);
    expect(row, "the MCP import did not persist an issue").toBeDefined();
    expect(row?.trigger_type).toBe("mcp");
  });

  it("admits only the four declared ingress values", () => {
    expect(missingProvenanceColumns(workspace.db, "issues"), "issues has no provenance columns yet").toEqual([]);
    const seen = new Set(rowsOf(workspace.db, "issues").map((row) => row.trigger_type));
    for (const value of seen) {
      expect(["cli", "mcp", "hook", "plugin_hook"]).toContain(value);
    }
  });

  it("has no hook path that invokes a writer (source scan)", () => {
    // B2's contract states hook and plugin_hook are reachable ingress values but
    // write no rows in this slice, because hooks are read-only. That claim is
    // only true while no hook source imports a mutating domain function.
    const WRITERS = [
      "importContract", "recordShape", "recordPlanning", "upsertPlanningFinding",
      "recordPlanningReviewPass", "recordPass", "upsertFinding", "recordEvidence",
      "verifyBehavior", "createWaiver",
    ];
    const hookSources = ["src/hooks.ts", "src/plugin-hook.ts"].map((relative) => ({
      relative,
      text: readFileSync(join(ROOT, relative), "utf8"),
    }));
    const violations = hookSources.flatMap(({ relative, text }) =>
      WRITERS.filter((writer) => new RegExp(`\\b${writer}\\s*\\(`).test(text)).map((writer) => `${relative} calls ${writer}()`),
    );
    expect(violations, `hook sources must not invoke writers: ${violations.join("; ")}`).toEqual([]);
  });
});
