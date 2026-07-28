/**
 * LB-33-B1 — the inbox serves everything needed to judge an approval.
 *
 * The approval affordance was a bare button at the top of the graph page with no
 * record attached: you could approve a premise without being able to read it.
 * That is the rubber-stamping the gate exists to prevent — a human clicking
 * "approve" on text they never saw is not materially different from an agent
 * approving on their behalf.
 *
 * So the inbox must carry the QUESTIONS and ANSWERS, not just a title and a
 * button.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, requireBuild, withServeProcess, type ServeHandle, type Workspace } from "./harness.js";
import { importAndShape, writeDiscovery } from "./lb-28-fixture.js";

describe("LB-33-B1 · the approval inbox carries its context", () => {
  let workspace: Workspace;
  let serve: ServeHandle;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb33b1");
    await cliOk(["init"], { db: workspace.db });
    // Needs the founder: a recorded but unapproved premise.
    await importAndShape(workspace, "INBOX-1");
    await cliOk(["discover", "INBOX-1", writeDiscovery(workspace, "INBOX-1")], { db: workspace.db });
    // Does NOT need the founder yet: no record at all.
    await importAndShape(workspace, "INBOX-2");
    serve = await withServeProcess(workspace.db);
  });

  afterAll(async () => {
    await serve?.stop();
    workspace?.dispose();
  });

  async function inbox(): Promise<Array<Record<string, unknown>>> {
    const response = await fetch(new URL("/api/inbox", serve.url));
    expect(response.ok, `inbox failed: ${response.status}`).toBe(true);
    return await response.json() as Array<Record<string, unknown>>;
  }

  it("lists a premise that is waiting on the founder", async () => {
    const items = await inbox();
    expect(items.map((item) => item.issue_id)).toContain("INBOX-1");
  });

  it("carries every question and answer, not just a title", async () => {
    const item = (await inbox()).find((entry) => entry.issue_id === "INBOX-1");
    const answers = item?.answers as Array<{ field: string; question: string; answer: string }> | undefined;
    expect(answers, "the inbox entry carries no answers").toBeDefined();
    expect(answers!.length, "not every required field is present to read").toBe(8);
    for (const answer of answers!) {
      expect(answer.question, `${answer.field} has no question to judge the answer against`).toBeTruthy();
      expect(answer.answer, `${answer.field} has no answer`).toBeTruthy();
    }
  });

  it("says what is being asked of the reader", async () => {
    const item = (await inbox()).find((entry) => entry.issue_id === "INBOX-1");
    expect(item?.status).toBe("draft");
    expect(item?.title, "no human-readable issue title").toBeTruthy();
  });

  it("omits issues with no recorded premise, which need an interview not an approval", async () => {
    const items = await inbox();
    expect(items.map((item) => item.issue_id), "an un-interviewed issue was offered for approval")
      .not.toContain("INBOX-2");
  });

  it("drops an item once approved", async () => {
    const response = await fetch(new URL("/api/issues/INBOX-1/discovery/approve", serve.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved_by: "ben@rordi.ai" }),
    });
    expect(response.ok).toBe(true);
    expect((await inbox()).map((item) => item.issue_id), "an approved premise stayed in the inbox")
      .not.toContain("INBOX-1");
  });
});
