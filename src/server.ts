import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type { LoopbreakerDb } from "./db.js";
import { createWaiver, DomainError, recordEvidence, recordPass, substrate, verifyBehavior } from "./domain.js";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../web-dist");
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function routeParts(request: IncomingMessage): string[] {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname.split("/").filter(Boolean);
}

function serveWeb(request: IncomingMessage, response: ServerResponse): void {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const candidate = pathname.startsWith("/assets/") ? resolve(WEB_ROOT, `.${pathname}`) : resolve(WEB_ROOT, "index.html");
  if (!candidate.startsWith(`${WEB_ROOT}/`) && candidate !== resolve(WEB_ROOT, "index.html")) {
    send(response, 404, { error: { code: "not_found", message: "Asset not found." } });
    return;
  }
  try {
    const content = readFileSync(candidate);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(candidate)] ?? "application/octet-stream",
      "cache-control": candidate.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    });
    response.end(content);
  } catch {
    send(response, 503, {
      error: {
        code: "web_build_missing",
        message: "The visualizer build is missing. Run pnpm build:web.",
      },
    });
  }
}

function sqliteDataVersion(db: LoopbreakerDb): number {
  const row = db.raw.prepare("PRAGMA data_version").get() as Record<string, number>;
  return Number(row.data_version ?? Object.values(row)[0] ?? 0);
}

function demoAction(db: LoopbreakerDb, issueId: string, action: string): unknown {
  if (issueId !== "DEMO-1") {
    throw new DomainError("demo_action_forbidden", "Browser demo actions are only available for the seeded DEMO-1 issue.");
  }
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
  const sockets = new WebSocketServer({ noServer: true });
  let lastDataVersion = sqliteDataVersion(db);
  let eventSequence = 0;

  const broadcast = (issueId: string | null, source: "browser" | "sqlite") => {
    eventSequence += 1;
    const message = JSON.stringify({
      type: "substrate_changed",
      issue_id: issueId,
      source,
      sequence: eventSequence,
      observed_at: new Date().toISOString(),
    });
    for (const client of sockets.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  };

  const server = createServer((request, response) => {
    try {
      const parts = routeParts(request);
      if (request.method === "GET" && parts.length === 0) {
        serveWeb(request, response);
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
        const issueId = decodeURIComponent(parts[2] ?? "");
        const result = demoAction(db, issueId, parts[4] ?? "");
        send(response, 200, result);
        broadcast(issueId, "browser");
        return;
      }
      if (request.method === "GET" && parts[0] === "assets") {
        serveWeb(request, response);
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

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/events") {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      sockets.emit("connection", client, request);
    });
  });

  sockets.on("connection", (client) => {
    client.send(JSON.stringify({
      type: "connected",
      sequence: eventSequence,
      data_version: lastDataVersion,
      observed_at: new Date().toISOString(),
    }));
  });

  const dataVersionPoll = setInterval(() => {
    try {
      const nextVersion = sqliteDataVersion(db);
      if (nextVersion !== lastDataVersion) {
        lastDataVersion = nextVersion;
        broadcast(null, "sqlite");
      }
    } catch {
      // The HTTP request path will surface database failures. Keep the live channel best-effort.
    }
  }, 500);
  dataVersionPoll.unref();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: async () => {
          clearInterval(dataVersionPoll);
          for (const client of sockets.clients) client.terminate();
          await new Promise<void>((done) => sockets.close(() => done()));
          await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
        },
      });
    });
  });
}
