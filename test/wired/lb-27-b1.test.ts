/**
 * LB-27-B1 — harness_ref resolves to a registry entry, and an unknown id is refused by name.
 *
 * The registry is what keeps `prove` from being arbitrary execution: a behavior
 * names an id, never a command. Adding a harness is a reviewable code change;
 * pointing a behavior at one is a data change.
 */

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOT, cliOk, makeWorkspace, requireBuild, runCli, type Workspace } from "./harness.js";
import { importOneBehavior, scratchRegistry } from "./lb-27-fixture.js";

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

  it("refuses a harness that does not consent to prove this behavior", async () => {
    // The binding hole: `harness_ref` is a data change an agent can make, so
    // without consent an agent could point any behavior at a harness that
    // cannot fail — `exit 0` — and verify it. The registry entry must name the
    // behavior back, which is a reviewed code change.
    const script = join(workspace.dir, "always-passes.sh");
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o755);
    const registry = scratchRegistry(workspace, [
      { id: "unconsenting", tier: "wired", runner: "script", target: script, purpose: "exits 0", proves: ["SOMEONE-ELSE-B1"] },
    ]);
    await importOneBehavior(workspace, { issueId: "REG-3", harnessRef: "unconsenting" });
    const result = await runCli(["prove", "REG-3-B1", "--registry", registry], { db: workspace.db });
    expect(result.code, "a non-consenting harness proved a behavior").not.toBe(0);
    expect(`${result.stdout}${result.stderr}`, "the refusal does not name the behavior").toContain("REG-3-B1");
  });

  it("binds a harness outside the frozen acceptance contract", async () => {
    // A behavior's contract freezes on planning-review approval, but the harness
    // ref is not part of that contract: it says which runner proves the `verify`
    // prose, not what must be true. Freezing it would leave an approved issue
    // permanently unprovable — exactly where LB-21 ended up.
    const script = join(workspace.dir, "bindable.sh");
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o755);
    const registry = scratchRegistry(workspace, [
      { id: "bindable", tier: "wired", runner: "script", target: script, purpose: "exits 0", proves: ["REG-4-B1"] },
    ]);
    await importOneBehavior(workspace, { issueId: "REG-4", harnessRef: undefined });
    const bound = await runCli(["bind", "REG-4-B1", "--harness", "bindable"], { db: workspace.db });
    expect(bound.code, `bind exited ${bound.code}: ${bound.stderr}`).toBe(0);
    const proved = await runCli(["prove", "REG-4-B1", "--registry", registry], { db: workspace.db });
    expect(proved.code, `prove after bind exited ${proved.code}: ${proved.stderr}`).toBe(0);
  });
});
