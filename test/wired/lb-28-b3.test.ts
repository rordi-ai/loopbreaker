/**
 * LB-28-B3 — approval is a distinct, attributable, durable act.
 *
 * The interview itself can run in-session; it is recorded and re-readable. The
 * approval cannot, because it is the one act an agent must not be able to issue
 * on its own behalf. Until the `web` ingress exists, cli and web are
 * indistinguishable in provenance — a NAMED residual risk, so what this proves
 * is attribution, not prevention.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, columnsOf, makeWorkspace, requireBuild, rowsOf, runCli, type Workspace } from "./harness.js";
import { importAndShape, writeDiscovery } from "./lb-28-fixture.js";

function record(dbPath: string, issueId: string): Record<string, unknown> | undefined {
  return rowsOf(dbPath, "discovery_records").find((row) => row.issue_id === issueId);
}

describe("LB-28-B3 · approval is a separate attributable act", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb28b3");
    await cliOk(["init"], { db: workspace.db });
    await importAndShape(workspace, "APPR-1");
    // Tolerant: `discover` does not exist until LB-28 lands, and a throwing
    // beforeAll would SKIP every assertion below. A skipped test records no red.
    await runCli(["discover", "APPR-1", writeDiscovery(workspace, "APPR-1")], { db: workspace.db });
  });

  afterAll(() => workspace?.dispose());

  it("starts a recorded discovery as a draft, never pre-approved", () => {
    expect(columnsOf(workspace.db, "discovery_records")).toContain("status");
    expect(record(workspace.db, "APPR-1")?.status, "a fresh record was not a draft").toBe("draft");
  });

  it("requires a named approver", async () => {
    const result = await runCli(["discover", "APPR-1", "--approve"], { db: workspace.db });
    expect(result.code, "approval succeeded with no approver named").not.toBe(0);
    // Assert it failed FOR THAT REASON. Without this, an unknown-command exit
    // satisfies the test while `discover` does not exist.
    expect(`${result.stdout}${result.stderr}`, "the refusal is not about the missing approver")
      .toMatch(/--by|approver|approved_by/);
  });

  it("records who approved it and when", async () => {
    const approved = await runCli(["discover", "APPR-1", "--approve", "--by", "ben@rordi.ai"], { db: workspace.db });
    expect(approved.code, `approve exited ${approved.code}: ${approved.stderr}`).toBe(0);
    const row = record(workspace.db, "APPR-1");
    expect(row?.status).toBe("approved");
    expect(row?.approved_by).toBe("ben@rordi.ai");
    expect(String(row?.approved_at ?? ""), "no approval timestamp").not.toBe("");
  });

  it("stamps the ingress that issued the approval", () => {
    const row = record(workspace.db, "APPR-1");
    expect(columnsOf(workspace.db, "discovery_records"), "discovery_records carries no provenance").toContain("trigger_type");
    expect(row?.trigger_type, "the approval is unattributed").toBeTruthy();
    expect(row?.triggered_by).toBeTruthy();
  });

  it("returns a record to draft when its answers change after approval", async () => {
    // An approved premise that is silently edited afterwards is the same defect
    // one layer up: the gate would vouch for text the approver never saw.
    expect(record(workspace.db, "APPR-1")?.status, "the record was not approved to begin with").toBe("approved");
    await cliOk(["discover", "APPR-1", writeDiscovery(workspace, "APPR-1")], { db: workspace.db });
    expect(record(workspace.db, "APPR-1")?.status, "edited answers kept a stale approval").toBe("draft");
  });
});
