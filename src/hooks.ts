import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { LoopbreakerDb } from "./db.js";
import { substrate } from "./domain.js";
import { composePrime, renderPrime } from "./prime.js";

/**
 * The subset of a Claude Code hook event this module reads. Hosts send more
 * fields than this; everything else is ignored.
 */
export interface HookEvent {
  hook_event_name?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: {
    file_path?: unknown;
    notebook_path?: unknown;
    [key: string]: unknown;
  };
}

export interface PreToolUseDecision {
  decision: "allow" | "deny";
  reason?: string;
}

const MUTATING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * True when `child` is `parent` itself or a path nested under it. Both
 * arguments must already be absolute, normalized paths.
 */
function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Compose the single deterministic prime block for the linked active issue
 * as SessionStart hook output. Pure aside from reading the database; never
 * throws. Returns the empty string when there is no active issue, the issue
 * is unknown, or anything else goes wrong -- signaling "emit no context" to
 * the thin CLI wrapper.
 */
export function runSessionStartHook(db: LoopbreakerDb, _event: unknown): string {
  try {
    const activeIssue = db.activeIssue();
    if (!activeIssue) return "";
    if (!db.issue(activeIssue)) return "";
    const block = composePrime(db, activeIssue);
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: renderPrime(block),
      },
    });
  } catch {
    return "";
  }
}

/**
 * Decide whether a PreToolUse event editing source should be allowed.
 *
 * Pure function: reads only `db` (no writes) and its arguments, never
 * throws. `repoRoot` is the absolute directory that contains this
 * repository's `.loopbreaker` state directory; the caller resolves it
 * (typically from the database path) and passes it in so this function stays
 * fully unit-testable without touching the filesystem.
 *
 * Policy: only tool_name in {Edit, Write, MultiEdit, NotebookEdit} is a
 * candidate; every other tool (including Bash) allows immediately. Targets
 * come from tool_input.file_path and tool_input.notebook_path -- either,
 * both, or neither may be present; missing or non-string values contribute
 * no target. Each present target resolves to an absolute path against
 * event.cwd. The event is deniable when at least one resolved target is
 * inside repoRoot and outside repoRoot/.loopbreaker; a multi-target event
 * denies if any one target is deniable. A deniable event is actually denied
 * only when the active issue exists and is not implementation-admitted; the
 * denial reason is that issue's exact active shipping gate reason. Every
 * other combination -- no candidate targets, no active issue, an admitted
 * issue, or any internal error -- allows.
 */
export function evaluatePreToolUse(db: LoopbreakerDb, event: HookEvent, repoRoot: string): PreToolUseDecision {
  try {
    const toolName = event.tool_name;
    if (typeof toolName !== "string" || !MUTATING_TOOLS.has(toolName)) return { decision: "allow" };

    const rawTargets = [event.tool_input?.file_path, event.tool_input?.notebook_path].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (rawTargets.length === 0) return { decision: "allow" };

    const cwd = typeof event.cwd === "string" && event.cwd.length > 0 ? event.cwd : repoRoot;
    const absoluteRepoRoot = resolve(repoRoot);
    const loopbreakerDir = resolve(absoluteRepoRoot, ".loopbreaker");
    const targets = rawTargets.map((target) => resolve(cwd, target));
    const deniableTarget = targets.some((target) => isWithin(absoluteRepoRoot, target) && !isWithin(loopbreakerDir, target));
    if (!deniableTarget) return { decision: "allow" };

    const activeIssue = db.activeIssue();
    if (!activeIssue) return { decision: "allow" };

    const state = substrate(db, activeIssue);
    const admitted = state.shape.ready && state.planning.ready && state.planning_review.approved;
    if (admitted) return { decision: "allow" };

    return { decision: "deny", reason: state.shipping.reason };
  } catch {
    return { decision: "allow" };
  }
}

const PRE_TOOL_USE_ALLOW = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
});

/**
 * The single source of truth for dispatching one hook invocation: parse raw
 * stdin, resolve it against the named hook, and return exactly what should
 * be written to stdout ("" for no output). Never throws. Both the CLI's
 * `loopbreaker hook <name>` entry point (src/cli.ts) and the standalone
 * bundled plugin hook entry point (src/plugin-hook.ts) call this instead of
 * each re-implementing the same glue, so there is exactly one place that
 * decides what "unparseable stdin" means for each hook.
 *
 * Unparseable stdin (JSON.parse throws) fails open to each hook's documented
 * safe default WITHOUT ever calling the underlying handler:
 *   - session-start: "" (no context). This is deliberate, not incidental --
 *     runSessionStartHook ignores its event argument entirely, so if
 *     unparseable stdin were papered over as `{}` and still dispatched, it
 *     would emit the prime block whenever an issue happens to be linked,
 *     violating B3's frozen contract ("without ... parseable stdin it emits
 *     no context").
 *   - pre-tool-use: the fixed allow payload (fail-open), matching
 *     evaluatePreToolUse's own behavior on an event with no recognizable
 *     tool_name.
 *   - any other/unknown hook name: "".
 *
 * Empty stdin (no bytes piped at all) is treated as the valid empty event
 * `{}`, not a parse failure -- session-start ignores event contents anyway,
 * and pre-tool-use's `{}` already allows (no tool_name), so this only
 * matters for readability: a host that pipes literally nothing still gets
 * each hook's ordinary db-driven behavior instead of an unconditional
 * fail-open.
 */
export function dispatchHook(db: LoopbreakerDb, name: string, stdin: string): string {
  try {
    let event: HookEvent;
    try {
      event = stdin.trim().length > 0 ? (JSON.parse(stdin) as HookEvent) : {};
    } catch {
      if (name === "pre-tool-use") return PRE_TOOL_USE_ALLOW;
      return "";
    }

    if (name === "session-start") return runSessionStartHook(db, event);

    if (name === "pre-tool-use") {
      const repoRoot = resolve(dirname(db.path), "..");
      const decision = evaluatePreToolUse(db, event, repoRoot);
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: decision.decision,
          ...(decision.reason ? { permissionDecisionReason: decision.reason } : {}),
        },
      });
    }

    return ""; // Unknown hook name: no output, still exit 0.
  } catch {
    return ""; // Fail open: no output, exit 0.
  }
}
