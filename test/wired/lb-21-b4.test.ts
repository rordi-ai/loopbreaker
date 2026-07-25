/**
 * LB-21-B4 — No mutation path bypasses provenance.
 *
 * verify: "Invoke the DEMO-1 finding action over HTTP, assert provenance on the
 * row, and source-scan for any remaining raw domain-row write."
 *
 * The HTTP leg drives a spawned `loopbreaker serve`, not an in-process server,
 * so the write is produced by a real ingress exactly as a browser would.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DOMAIN_TABLES, ROOT, cliOk, makeWorkspace, missingProvenanceColumns, requireBuild,
  rowsOf, withServeProcess, type ServeHandle, type Workspace,
} from "./harness.js";

describe("LB-21-B4 · no mutation path bypasses provenance", () => {
  let workspace: Workspace;
  let serve: ServeHandle;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("b4");
    await cliOk(["demo"], { db: workspace.db });
    serve = await withServeProcess(workspace.db);

    // The demo `prove` action is the path that today reaches `findings` through
    // a raw UPDATE at src/server.ts:72, bypassing src/domain.ts entirely.
    // The action is a path segment (`parts[4]` in src/server.ts), not a body field.
    const response = await fetch(new URL("/api/issues/DEMO-1/actions/prove", serve.url), { method: "POST" });
    if (!response.ok) throw new Error(`demo action failed: ${response.status} ${await response.text()}`);
  });

  afterAll(async () => {
    await serve?.stop();
    workspace?.dispose();
  });

  it("stamps provenance on the finding row the demo action updated", () => {
    expect(missingProvenanceColumns(workspace.db, "findings"), "findings has no provenance columns yet").toEqual([]);
    const repaired = rowsOf(workspace.db, "findings").filter((row) => row.status === "repaired");
    expect(repaired.length, "the demo action did not repair a finding").toBeGreaterThan(0);
    for (const row of repaired) {
      expect(row.trigger_type, "the demo finding UPDATE left provenance unstamped").toBeTruthy();
      expect(row.triggered_by, "the demo finding UPDATE left triggered_by null").toBeTruthy();
    }
  });

  it("stamps provenance on the evidence the demo action recorded", () => {
    expect(missingProvenanceColumns(workspace.db, "evidence"), "evidence has no provenance columns yet").toEqual([]);
    const unstamped = rowsOf(workspace.db, "evidence").filter((row) => !row.trigger_type);
    expect(unstamped.length, `${unstamped.length} unstamped evidence rows`).toBe(0);
  });

  it("leaves no raw domain-row write outside src/domain.ts and the db.ts setters (source scan)", () => {
    const SCANNED = ["src/server.ts", "src/cli.ts", "src/mcp.ts", "src/hooks.ts", "src/plugin-hook.ts", "src/seed.ts", "src/prime.ts"];
    const rawWrite = new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+\`?(${DOMAIN_TABLES.join("|")})\\b`, "i");
    const violations = SCANNED.flatMap((relative) => {
      const lines = readFileSync(join(ROOT, relative), "utf8").split("\n");
      return lines
        .map((line, index) => ({ line, number: index + 1 }))
        // Skip comment lines: prose describing a removed raw write is not a
        // raw write. Without this the scan flags its own documentation.
        .filter((entry) => !/^\s*(\/\/|\*|\/\*)/.test(entry.line))
        .filter((entry) => rawWrite.test(entry.line))
        .map((entry) => `${relative}:${entry.number} ${entry.line.trim()}`);
    });
    expect(violations, `raw domain-row writes must be routed through the domain layer:\n${violations.join("\n")}`).toEqual([]);
  });
});
