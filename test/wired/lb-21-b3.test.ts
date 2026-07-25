/**
 * LB-21-B3 — triggered_by and trigger_data have defined values.
 *
 * verify: "Against a disposable database, write once through the CLI with
 * LOOPBREAKER_ACTOR set and once unset, and once through MCP, asserting the
 * exact triggered_by value in each case and the expected trigger_data
 * subcommand object for the CLI writes and null for the MCP write."
 */

import { userInfo } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, missingProvenanceColumns, requireBuild, rowsOf, withMcp, type Workspace } from "./harness.js";

const ACTOR = "harness-actor@example.com";
const WITH_ACTOR = "ACTOR-SET";
const WITHOUT_ACTOR = "ACTOR-UNSET";
const VIA_MCP = "ACTOR-MCP";
const MCP_CLIENT_NAME = "lb21-b3-client";

function contractFor(issueId: string) {
  return {
    issue_id: issueId,
    title: "Actor attribution fixture",
    description: "Drives one import per actor condition.",
    behaviors: [{ id: `${issueId}-B1`, title: "Fixture", trigger: "t", expected: "e", verify: "v" }],
  };
}

function issueRow(dbPath: string, id: string): Record<string, unknown> | undefined {
  return rowsOf(dbPath, "issues").find((row) => row.id === id);
}

describe("LB-21-B3 · triggered_by and trigger_data have defined values", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("b3");
    await cliOk(["init"], { db: workspace.db });

    for (const [issueId, env] of [
      [WITH_ACTOR, { LOOPBREAKER_ACTOR: ACTOR }],
      [WITHOUT_ACTOR, { LOOPBREAKER_ACTOR: undefined }],
    ] as const) {
      const path = join(workspace.dir, `${issueId}.json`);
      writeFileSync(path, JSON.stringify(contractFor(issueId)));
      await cliOk(["import", path], { db: workspace.db, env });
    }

    await withMcp(workspace.db, async (client) => {
      await client.callTool({ name: "review_import_contract", arguments: contractFor(VIA_MCP) });
    }, MCP_CLIENT_NAME);
  });

  afterAll(() => workspace?.dispose());

  it("uses LOOPBREAKER_ACTOR as triggered_by when it is set", () => {
    expect(missingProvenanceColumns(workspace.db, "issues"), "issues has no provenance columns yet").toEqual([]);
    expect(issueRow(workspace.db, WITH_ACTOR)?.triggered_by).toBe(ACTOR);
  });

  it("falls back to the OS username when LOOPBREAKER_ACTOR is unset, and is never null", () => {
    expect(missingProvenanceColumns(workspace.db, "issues"), "issues has no provenance columns yet").toEqual([]);
    const value = issueRow(workspace.db, WITHOUT_ACTOR)?.triggered_by;
    expect(value, "triggered_by must never be null").toBeTruthy();
    expect([userInfo().username, "unknown"]).toContain(value);
  });

  it("records the parsed subcommand as trigger_data for CLI writes", () => {
    expect(missingProvenanceColumns(workspace.db, "issues"), "issues has no provenance columns yet").toEqual([]);
    const raw = issueRow(workspace.db, WITH_ACTOR)?.trigger_data;
    expect(raw, "CLI trigger_data must carry the subcommand").toBeTruthy();
    expect(JSON.parse(String(raw))).toMatchObject({ subcommand: "import" });
  });

  it("uses the MCP client name as triggered_by, with trigger_data null", () => {
    expect(missingProvenanceColumns(workspace.db, "issues"), "issues has no provenance columns yet").toEqual([]);
    const row = issueRow(workspace.db, VIA_MCP);
    expect([MCP_CLIENT_NAME, "mcp-client"]).toContain(row?.triggered_by);
    expect(row?.trigger_data ?? null).toBeNull();
  });
});
