/**
 * Shared drivers for the LB-21 wired harnesses.
 *
 * Rule for this directory: a harness may only *drive* loopbreaker through a
 * real ingress — a spawned `dist/cli.js`, a real MCP stdio client against
 * `mcp/server.bundle.mjs`, or HTTP against a spawned `loopbreaker serve`.
 * Importing `src/` or `dist/index.js` to perform a mutation is forbidden here;
 * that would prove the domain works in-process and prove nothing about the
 * ingress, which is the entire subject of LB-21.
 *
 * Reading the database directly to *assert* is fine — the constraint is on how
 * writes are produced, not on how storage is inspected.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const CLI = join(ROOT, "dist", "cli.js");
export const MCP_SERVER = join(ROOT, "mcp", "server.bundle.mjs");

/** The ten domain tables LB-21's contract enumerates. `workspace` is not a domain row table. */
export const DOMAIN_TABLES = [
  "issues",
  "behaviors",
  "review_passes",
  "evidence",
  "findings",
  "waivers",
  "planning_profiles",
  "shape_assessments",
  "planning_review_passes",
  "planning_findings",
] as const;

/** The provenance triple LB-21 requires on every written row version. */
export const PROVENANCE_COLUMNS = ["trigger_type", "triggered_by", "trigger_data"] as const;

export function requireBuild(): void {
  const missing = [CLI, MCP_SERVER].filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(`Wired harnesses need a current build. Missing: ${missing.join(", ")}. Run \`pnpm build\`.`);
  }
}

export interface Workspace {
  dir: string;
  db: string;
  dispose: () => void;
}

export function makeWorkspace(label: string): Workspace {
  const dir = mkdtempSync(join(tmpdir(), `lb21-${label}-`));
  return {
    dir,
    db: join(dir, "wired.db"),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Drive the real CLI ingress as a child process. Never throws on a non-zero exit; the caller asserts. */
export function runCli(args: string[], options: { db: string; env?: Record<string, string | undefined> } ): Promise<CliResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args, "--db", options.db], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

/** Same as {@link runCli} but fails loudly, for setup steps whose success is a precondition rather than the assertion. */
export async function cliOk(args: string[], options: { db: string; env?: Record<string, string | undefined> }): Promise<string> {
  const result = await runCli(args, options);
  if (result.code !== 0) {
    throw new Error(`CLI \`${args.join(" ")}\` exited ${result.code}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/** Drive the real MCP ingress over stdio against the bundled plugin server. */
export async function withMcp<T>(dbPath: string, fn: (client: Client) => Promise<T>, clientName = "loopbreaker-wired-harness"): Promise<T> {
  const client = new Client({ name: clientName, version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), LOOPBREAKER_DB: dbPath },
    stderr: "ignore",
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/** Extract the TOON text payload from an MCP tool result. */
export function mcpText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

export interface ServeHandle {
  url: string;
  stop: () => Promise<void>;
}

/**
 * Reserve a free TCP port by binding and immediately releasing it.
 *
 * `loopbreaker serve --port 0` is rejected (`invalid_port`: the flag requires
 * 1-65535), so the harness has to choose the port rather than let the OS assign
 * one. There is a small race between release and re-bind; acceptable for a
 * local harness, and a bind failure surfaces as a clear startup error.
 */
export function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("could not resolve an ephemeral port"));
        return;
      }
      const { port } = address;
      server.close(() => resolvePromise(port));
    });
  });
}

/** Spawn the real `loopbreaker serve` ingress on a free port and wait for its URL. */
export async function withServeProcess(dbPath: string): Promise<ServeHandle> {
  const port = await freePort();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, "serve", "--db", dbPath, "--port", String(port)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`\`loopbreaker serve\` did not report a URL within 10s. stdout: ${stdout}`));
    }, 10_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const match = stdout.match(/https?:\/\/[^\s"]+/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        url: match[0],
        stop: () =>
          new Promise<void>((done) => {
            child.once("exit", () => done());
            child.kill("SIGTERM");
            setTimeout(() => { child.kill("SIGKILL"); done(); }, 3_000).unref();
          }),
      });
    });
    child.once("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
  });
}

/** Open the database read-only for assertions. */
export function readDb<T>(dbPath: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Column names actually present on a table, via PRAGMA. */
export function columnsOf(dbPath: string, table: string): string[] {
  return readDb(dbPath, (db) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name),
  );
}

export function rowsOf(dbPath: string, table: string): Array<Record<string, unknown>> {
  return readDb(dbPath, (db) => db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>);
}

/**
 * Assert the provenance columns exist on a table before asserting their values.
 *
 * This exists so a red harness fails with a readable contract message rather
 * than an opaque `no such column` SQLite error. The distinction matters: the
 * red baseline is evidence, so it has to say what is missing.
 */
export function missingProvenanceColumns(dbPath: string, table: string): string[] {
  const present = new Set(columnsOf(dbPath, table));
  return PROVENANCE_COLUMNS.filter((column) => !present.has(column));
}
