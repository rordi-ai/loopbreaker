import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_DB, cliActor, openDb, type LoopbreakerDb } from "./db.js";
import { bootstrapNudgeOutput } from "./hooks.js";
import { dispatchHook } from "./hooks.js";

/**
 * Read the entirety of stdin as a UTF-8 string. Resolves to "" when stdin is
 * a TTY (nothing piped in) rather than hanging waiting for input.
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

/*
 * Hook dispatch itself lives in src/hooks.ts's `dispatchHook` -- the single
 * source of truth shared with src/cli.ts's `loopbreaker hook <name>`
 * subcommand. This file imports it rather than src/cli.ts directly because
 * src/cli.ts (a) transitively imports src/server.ts, whose `ws` dependency
 * cannot be bundled standalone into ESM by esbuild (it hits `Dynamic
 * require of "events" is not supported`), and (b) has a top-level
 * `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()`
 * guard that, once bundled into this file, sees *this* file as "the script
 * being run" and fires the full CLI dispatch a second time against this
 * process's own argv (`session-start` / `pre-tool-use`, parsed as unknown
 * CLI commands) as an unwanted side effect. hooks.ts has no such import
 * chain or top-level side effects, so it bundles cleanly.
 */

/**
 * Committed-bundle entry point for the Claude plugin's SessionStart and
 * PreToolUse hooks (`mcp/hook.bundle.mjs`, built by `pnpm build:hook`).
 * Mirrors src/plugin-mcp.ts: a thin process wrapper around pure,
 * already-tested dispatch logic.
 *
 * Guard: hosts install this plugin into repositories that may never have
 * run `loopbreaker init` or `loopbreaker demo`. Unlike the real `loopbreaker
 * hook` CLI subcommand, this entry point must never create a database file
 * just because the plugin happened to be installed and a hook happened to
 * fire -- that would silently seed an empty `.loopbreaker/loopbreaker.db` in
 * every repo a user has this plugin enabled in. So: if the resolved db path
 * does not already exist on disk, emit the safe default (no output) and
 * exit 0 without ever opening it. This is consistent with B3/B4's
 * documented behavior for "no database": no context on session-start,
 * allow on pre-tool-use -- both of which are exactly what an empty return
 * value produces downstream.
 */
async function main(): Promise<void> {
  const name = process.argv[2];
  const dbPath = resolve(process.env.LOOPBREAKER_DB ?? DEFAULT_DB);

  if (!existsSync(dbPath)) {
    // No database yet. Still never CREATE one -- that would seed an empty
    // `.loopbreaker/` in every repo the plugin is enabled in. But silence here
    // is what made the plugin inert and invisible: a fresh repo is exactly when
    // an agent most needs to learn the pipeline exists, and it was told
    // nothing. So session-start orients without touching disk; pre-tool-use
    // still allows silently, because with no database there is nothing to gate.
    if (name === "session-start") process.stdout.write(`${bootstrapNudgeOutput()}\n`);
    return;
  }

  let db: LoopbreakerDb | undefined;
  try {
    const raw = await readStdin();
    if (name === undefined) return;
    // LB-21 ingress: the bundled plugin hook. Reachable as a trigger_type
    // value, but writes no rows in this slice — hooks are read-only.
    db = openDb(dbPath, { trigger_type: "plugin_hook", triggered_by: cliActor(), trigger_data: null });
    const result = dispatchHook(db, name, raw);
    if (result) process.stdout.write(`${result}\n`);
  } catch {
    // Fail open: no output, exit 0.
  } finally {
    db?.close();
  }
}

main()
  .catch(() => {
    // Fail open: no output, exit 0.
  })
  .finally(() => {
    process.exit(0);
  });
