/**
 * LB-27-B1 — harness_ref resolves to a registry entry, and an unknown id is refused by name.
 *
 * The registry is what keeps `prove` from being arbitrary execution: a behavior
 * names an id, never a command. Adding a harness is a reviewable code change;
 * pointing a behavior at one is a data change.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOT, cliOk, makeWorkspace, requireBuild, runCli, type Workspace } from "./harness.js";
import { importOneBehavior } from "./lb-27-fixture.js";

describe("LB-27-B1 · harness_ref resolves through the registry", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb27b1");
    await cliOk(["init"], { db: workspace.db });
  });

  afterAll(() => workspace?.dispose());

  it("ships a registry with tier and runner declared per entry", () => {
    const registry = JSON.parse(readFileSync(join(ROOT, "harnesses.json"), "utf8"));
    expect(Array.isArray(registry.harnesses), "harnesses.json has no harnesses array").toBe(true);
    expect(registry.harnesses.length).toBeGreaterThan(0);
    for (const entry of registry.harnesses) {
      expect(entry.id, "a registry entry has no id").toBeTruthy();
      expect(["unit", "wired", "live"], `${entry.id} declares an unknown tier`).toContain(entry.tier);
      expect(entry.runner, `${entry.id} declares no runner`).toBeTruthy();
      expect(entry.target, `${entry.id} declares no target`).toBeTruthy();
    }
  });

  it("lists the registry over the CLI", async () => {
    const result = await runCli(["harnesses"], { db: workspace.db });
    expect(result.code, `harnesses exited ${result.code}: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("lb-21-b1");
    expect(result.stdout, "the listing does not expose the tier").toContain("wired");
  });

  it("refuses an unknown harness id by name", async () => {
    await importOneBehavior(workspace, { issueId: "REG-1", harnessRef: "no-such-harness" });
    const result = await runCli(["prove", "REG-1-B1"], { db: workspace.db });
    expect(result.code, "proving an unknown harness id must fail").not.toBe(0);
    expect(`${result.stdout}${result.stderr}`, "the refusal does not name the missing id").toContain("no-such-harness");
  });

  it("refuses a behavior that declares no harness_ref at all", async () => {
    await importOneBehavior(workspace, { issueId: "REG-2", harnessRef: undefined });
    const result = await runCli(["prove", "REG-2-B1"], { db: workspace.db });
    expect(result.code, "proving a behavior with no harness must fail").not.toBe(0);
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).toMatch(/harness/);
  });
});
