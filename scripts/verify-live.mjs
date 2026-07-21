import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { openDb, seedDemo } from "../dist/index.js";
import { startServer } from "../dist/server.js";

const workspace = mkdtempSync(join(tmpdir(), "loopbreaker-live-"));
const dbPath = join(workspace, "live.db");
const db = openDb(dbPath);
seedDemo(db);
const server = await startServer(db, 0);

function runCli(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args, "--db", dbPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`CLI exited ${code}: ${stderr || stdout}`));
    });
  });
}

function nextMessage(socket, predicate, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`No matching WebSocket event within ${timeoutMs}ms.`));
    }, timeoutMs);
    const onMessage = (data) => {
      const message = JSON.parse(String(data));
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

let socket;
try {
  const html = await fetch(server.url).then((response) => response.text());
  assert.match(html, /<div id="root"><\/div>/, "server should serve the React application");

  socket = new WebSocket(server.url.replace("http:", "ws:") + "/events");
  const connected = nextMessage(socket, (message) => message.type === "connected");
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  await connected;

  const changed = nextMessage(
    socket,
    (message) => message.type === "substrate_changed" && message.source === "sqlite",
  );
  await runCli("pass", "DEMO-1", "--pass", "2", "--verdict", "pass", "--summary", "External process repair verification.");
  const event = await changed;
  assert.equal(event.issue_id, null, "cross-process SQLite events intentionally invalidate all issues");

  const state = await fetch(`${server.url}/api/issues/DEMO-1/substrate`).then((response) => response.json());
  assert.equal(state.review.pass_count, 2);
  assert.equal(state.review.complete, true);
  assert.equal(state.planning.score, 100);
  assert.equal(state.planning.ready, true);
  assert.equal(state.shape.ready, true);
  assert.equal(state.planning_review.approved, true);
  assert.equal(state.shipping.gate, "verification");
  assert.equal(state.shipping.disposition, "hold", "review completion must not silently authorize shipping");

  process.stdout.write(`Live surface verified: React served; shape and planning review are approved; planning is 100/100; external CLI change reached WebSocket in <=2s; code review is complete while verification still holds shipping.\n`);
} finally {
  socket?.terminate();
  await server.close();
  db.close();
  rmSync(workspace, { recursive: true, force: true });
}
