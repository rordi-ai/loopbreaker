/**
 * LB-29-B1 — the HTTP server is its own ingress, stamped `web`.
 *
 * Supersedes LB-21-B2's enumeration, which fixed trigger_type to exactly
 * cli | mcp | hook | plugin_hook. That was correct when written: the server
 * inherited the CLI's handle, so a browser write and a terminal write were
 * indistinguishable. This adds the fifth value and the distinction.
 *
 * ATTRIBUTION, NOT PREVENTION. An agent with a shell can `curl` this endpoint
 * as easily as it can run the CLI, so `web` says which channel a write came
 * through — not that a human was behind it. Closing that needs the one-time
 * token LB-25's shape specifies.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, requireBuild, rowsOf, withServeProcess, type ServeHandle, type Workspace } from "./harness.js";
import { importAndShape, writeDiscovery } from "./lb-28-fixture.js";

describe("LB-29-B1 · the browser is a distinct ingress", () => {
  let workspace: Workspace;
  let serve: ServeHandle;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb29b1");
    await cliOk(["init"], { db: workspace.db });
    await importAndShape(workspace, "WEB-1");
    await cliOk(["discover", "WEB-1", writeDiscovery(workspace, "WEB-1")], { db: workspace.db });
    serve = await withServeProcess(workspace.db);
  });

  afterAll(async () => {
    await serve?.stop();
    workspace?.dispose();
  });

  it("approves a discovery record over HTTP", async () => {
    const response = await fetch(new URL("/api/issues/WEB-1/discovery/approve", serve.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved_by: "ben@rordi.ai" }),
    });
    expect(response.ok, `approve failed: ${response.status} ${await response.text()}`).toBe(true);
    const row = rowsOf(workspace.db, "discovery_records").find((item) => item.issue_id === "WEB-1");
    expect(row?.status).toBe("approved");
    expect(row?.approved_by).toBe("ben@rordi.ai");
  });

  it("stamps that approval `web`, not `cli`", () => {
    const row = rowsOf(workspace.db, "discovery_records").find((item) => item.issue_id === "WEB-1");
    expect(row?.trigger_type, "the browser approval is indistinguishable from a terminal one").toBe("web");
  });

  it("requires a named approver over HTTP too", async () => {
    await importAndShape(workspace, "WEB-2");
    await cliOk(["discover", "WEB-2", writeDiscovery(workspace, "WEB-2")], { db: workspace.db });
    const response = await fetch(new URL("/api/issues/WEB-2/discovery/approve", serve.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.ok, "an unnamed approval was accepted").toBe(false);
    // A 404 would satisfy the assertion above while the route does not exist at
    // all. Require a REJECTION (4xx that is not 404), so this cannot pass
    // vacuously before the endpoint is built.
    expect(response.status, "the route is missing rather than rejecting the request").not.toBe(404);
    expect(response.status).toBe(400);
    const row = rowsOf(workspace.db, "discovery_records").find((item) => item.issue_id === "WEB-2");
    expect(row?.status, "the record was approved without an approver").toBe("draft");
  });

  it("opens the shape gate once approved from the browser", async () => {
    const response = await fetch(new URL("/api/issues/WEB-1/substrate", serve.url));
    const substrate = await response.json() as { shipping: { gate: string } };
    expect(substrate.shipping.gate, "discovery still holds after a browser approval").not.toBe("discovery");
  });

  it("still stamps `cli` on terminal writes, so the two remain distinguishable", () => {
    const issue = rowsOf(workspace.db, "issues").find((row) => row.id === "WEB-1");
    expect(issue?.trigger_type, "a CLI import was not stamped cli").toBe("cli");
  });
});
