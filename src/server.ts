import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { LoopbreakerDb } from "./db.js";
import { createWaiver, DomainError, recordEvidence, recordPass, substrate, verifyBehavior } from "./domain.js";
import { renderApp } from "./ui.js";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function routeParts(request: IncomingMessage): string[] {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname.split("/").filter(Boolean);
}

function demoAction(db: LoopbreakerDb, issueId: string, action: string): unknown {
  const state = substrate(db, issueId);
  if (action === "pass2") return recordPass(db, { issueId, passNumber: 2, verdict: "pass", summary: "Admitted repairs are correct and introduced no repair regressions. Review stops here." });
  if (action === "pass3") return recordPass(db, { issueId, passNumber: 3, verdict: "fail", summary: "Decision pass: hold for the named exact-once risk. No additional review pass is authorized." });
  const behaviorId = state.shipping.unresolved_behavior_ids[0];
  if (!behaviorId) return state;
  if (action === "prove") {
    recordEvidence(db, { issueId, behaviorId, tier: "wired", verdict: "pass", summary: "A real wired replay produced the external effect exactly once.", source: "demo://wired-replay" });
    const latest = db.evidence(issueId).filter((item) => item.behavior_id === behaviorId).at(-1);
    if (!latest) throw new DomainError("evidence_missing", "Could not find the newly recorded evidence.");
    db.raw.prepare("UPDATE findings SET status = 'repaired' WHERE issue_id = ? AND behavior_id = ?").run(issueId, behaviorId);
    return verifyBehavior(db, behaviorId, latest.id);
  }
  if (action === "waive") return createWaiver(db, { issueId, behaviorId, rationale: "Demo operator accepts the named retry debt with cold-path rollback available.", approvedBy: "demo-human" });
  throw new DomainError("action_not_found", `Unknown demo action: ${action}`);
}

export function startServer(db: LoopbreakerDb, port = 7331): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    try {
      const parts = routeParts(request);
      if (request.method === "GET" && parts.length === 0) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(renderApp());
        return;
      }
      if (request.method === "GET" && parts.join("/") === "api/issues") {
        send(response, 200, db.listIssues());
        return;
      }
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "issues" && parts[3] === "substrate") {
        send(response, 200, substrate(db, decodeURIComponent(parts[2] ?? "")));
        return;
      }
      if (request.method === "POST" && parts[0] === "api" && parts[1] === "issues" && parts[3] === "actions") {
        send(response, 200, demoAction(db, decodeURIComponent(parts[2] ?? ""), parts[4] ?? ""));
        return;
      }
      send(response, 404, { error: { code: "not_found", message: "Route not found." } });
    } catch (error) {
      const known = error instanceof DomainError;
      send(response, known ? 400 : 500, {
        error: { code: known ? error.code : "internal_error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done())),
    }));
  });
}
