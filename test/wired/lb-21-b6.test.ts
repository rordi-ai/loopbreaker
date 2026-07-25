/**
 * LB-21-B6 — The visualizer renders provenance in the node footer.
 *
 * verify: "Render a node and observe the provenance footer."
 *
 * HONEST LIMITATION, to be read before this harness is treated as proof:
 * the repository has no DOM test stack (no jsdom, no testing-library), so this
 * does not mount React. It drives the real HTTP surface a browser would call,
 * then runs the substrate through `buildReviewGraph` — the exact mapping the
 * canvas renders from — and asserts provenance reaches the node footer.
 *
 * That covers the data path end-to-end and the mapping, but NOT the painted
 * pixels. If B6 is meant to include the rendered component, this harness must
 * be upgraded before its evidence counts; recording it as-is would overstate
 * what was observed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReviewGraph } from "../../web/src/graph.js";
import { cliOk, makeWorkspace, requireBuild, withServeProcess, type ServeHandle, type Workspace } from "./harness.js";

describe("LB-21-B6 · the visualizer exposes provenance on nodes", () => {
  let workspace: Workspace;
  let serve: ServeHandle;
  let substrate: Record<string, unknown>;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("b6");
    await cliOk(["demo"], { db: workspace.db });
    serve = await withServeProcess(workspace.db);

    const response = await fetch(new URL("/api/issues/DEMO-1/substrate", serve.url));
    if (!response.ok) throw new Error(`substrate fetch failed: ${response.status}`);
    substrate = await response.json();
  });

  afterAll(async () => {
    await serve?.stop();
    workspace?.dispose();
  });

  it("serves a substrate the canvas can build from", () => {
    expect(substrate).toBeTruthy();
    const graph = buildReviewGraph(substrate as never);
    expect(graph.nodes.length, "the graph produced no nodes").toBeGreaterThan(0);
  });

  it("carries provenance through the HTTP substrate the browser receives", () => {
    const serialized = JSON.stringify(substrate);
    expect(serialized, "the HTTP substrate never mentions trigger_type").toContain("trigger_type");
    expect(serialized, "the HTTP substrate never mentions triggered_by").toContain("triggered_by");
  });

  it("renders provenance into a behavior node footer", () => {
    const graph = buildReviewGraph(substrate as never);
    const behaviorNodes = graph.nodes.filter((node) => String(node.id).startsWith("behavior"));
    expect(behaviorNodes.length, "no behavior nodes were produced").toBeGreaterThan(0);
    const withProvenance = behaviorNodes.filter((node) => {
      const footer = String((node.data as { footer?: unknown })?.footer ?? "");
      return /cli|mcp|hook|plugin_hook/.test(footer);
    });
    expect(withProvenance.length, "no behavior node footer renders its provenance").toBeGreaterThan(0);
  });

  it("renders provenance into an evidence node footer", () => {
    const graph = buildReviewGraph(substrate as never);
    const evidenceNodes = graph.nodes.filter((node) => String(node.id).startsWith("evidence"));
    expect(evidenceNodes.length, "no evidence nodes were produced").toBeGreaterThan(0);
    const withProvenance = evidenceNodes.filter((node) => {
      const footer = String((node.data as { footer?: unknown })?.footer ?? "");
      return /cli|mcp|hook|plugin_hook/.test(footer);
    });
    expect(withProvenance.length, "no evidence node footer renders its provenance").toBeGreaterThan(0);
  });
});
