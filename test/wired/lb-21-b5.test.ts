/**
 * LB-21-B5 — The substrate readout exposes the provenance triple.
 *
 * verify: "Seed a disposable database through all ten writers and assert the
 * triple on every record type in a live substrate response over CLI and MCP."
 *
 * Asserts the READ MODEL, not storage: a stamped row that substrate() drops on
 * the floor satisfies B1 while still failing the readout the contract requires.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeWorkspace, mcpText, requireBuild, runCli, withMcp, type Workspace } from "./harness.js";
import { driveAllWriters, FIXTURE_ISSUE, type DrivenFixture } from "./fixture.js";

/** Record types that carry provenance and therefore must expose it in the read model. */
const READOUT_SECTIONS = [
  "behaviors", "evidence", "findings", "waivers",
  "review_passes", "planning_findings", "planning_review_passes",
] as const;

describe("LB-21-B5 · substrate exposes provenance per record type", () => {
  let workspace: Workspace;
  let fixture: DrivenFixture;
  let cliSubstrate: string;
  let mcpSubstrate: string;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("b5");
    fixture = await driveAllWriters(workspace);

    const result = await runCli(["substrate", FIXTURE_ISSUE], { db: workspace.db });
    expect(result.code, `substrate exited ${result.code}: ${result.stderr}`).toBe(0);
    cliSubstrate = result.stdout;

    mcpSubstrate = await withMcp(workspace.db, async (client) =>
      mcpText(await client.callTool({ name: "review_substrate", arguments: { issue_id: FIXTURE_ISSUE } }) as never),
    );
  });

  afterAll(() => workspace?.dispose());

  it("returns a substrate over both ingresses", () => {
    expect(cliSubstrate, "empty CLI substrate").toContain(FIXTURE_ISSUE);
    expect(mcpSubstrate, "empty MCP substrate").toContain(FIXTURE_ISSUE);
  });

  it("exposes trigger_type in the CLI substrate readout", () => {
    expect(cliSubstrate, "CLI substrate never mentions trigger_type").toContain("trigger_type");
  });

  it("exposes trigger_type in the MCP substrate readout", () => {
    expect(mcpSubstrate, "MCP substrate never mentions trigger_type").toContain("trigger_type");
  });

  it("exposes triggered_by in both readouts", () => {
    expect(cliSubstrate, "CLI substrate never mentions triggered_by").toContain("triggered_by");
    expect(mcpSubstrate, "MCP substrate never mentions triggered_by").toContain("triggered_by");
  });

  it.each(READOUT_SECTIONS)("carries provenance alongside the %s section", (section) => {
    // Each TOON section header is followed by its rows; the provenance field
    // must appear within the emitted block for that record type.
    const index = cliSubstrate.indexOf(`${section}[`);
    expect(index, `substrate has no ${section} section`).toBeGreaterThan(-1);
    const block = cliSubstrate.slice(index, cliSubstrate.indexOf("\n\n", index) === -1 ? undefined : cliSubstrate.indexOf("\n\n", index));
    expect(block, `${section} block exposes no provenance`).toContain("trigger_type");
  });

  it("attributes the verified behavior's progression in the readout", () => {
    expect(cliSubstrate).toContain(fixture.verifiedBehaviorId);
    expect(cliSubstrate, "the verified behavior row exposes no provenance").toContain("trigger_type");
  });
});
