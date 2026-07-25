import { mkdirSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Provenance,
  BehaviorRow,
  EvidenceRow,
  FindingRow,
  IssueRow,
  PlanningProfile,
  PlanningFindingRow,
  PlanningReviewPassRow,
  ReviewPassRow,
  ShapeProfile,
  WaiverRow,
} from "./types.js";

export const DEFAULT_DB = ".loopbreaker/loopbreaker.db";

/**
 * LB-21 — the ten domain tables that carry the provenance triple. `workspace`
 * is excluded: it holds one singleton binding row, not a state progression.
 */
export const PROVENANCE_TABLES = [
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

/**
 * The provenance used when a caller opens a handle without declaring an
 * ingress. Defaults to `cli`/`unknown` rather than null so `triggered_by` is
 * never null, per LB-21-B3.
 */
export const DEFAULT_PROVENANCE: Provenance = { trigger_type: "cli", triggered_by: "unknown", trigger_data: null };

export class LoopbreakerDb {
  readonly path: string;
  readonly raw: DatabaseSync;
  /** LB-21 — the ingress that opened this handle. Stamped on every write. */
  readonly provenance: Provenance;

  constructor(path = process.env.LOOPBREAKER_DB ?? DEFAULT_DB, provenance: Provenance = DEFAULT_PROVENANCE) {
    this.path = resolve(path);
    this.provenance = provenance;
    mkdirSync(dirname(this.path), { recursive: true });
    this.raw = new DatabaseSync(this.path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  /**
   * LB-21 — refine the actor once the ingress learns it. The only caller is the
   * MCP server, which cannot know the client name until `initialize` has
   * completed, after the handle is already open.
   *
   * This is instance-level and set once, NOT per-call ambient state: the shared
   * MCP handle is closed over by interleaving async handlers, and mutating
   * provenance per tool call on that instance would be unsafe. Per-tool
   * granularity is a named non-goal of this slice.
   */
  setTriggeredBy(actor: string): void {
    const trimmed = actor.trim();
    if (trimmed) this.provenance.triggered_by = trimmed;
  }

  /** The triple as positional bind values, in `trigger_type, triggered_by, trigger_data` order. */
  provenanceValues(): [string, string, string | null] {
    return [
      this.provenance.trigger_type,
      this.provenance.triggered_by,
      this.provenance.trigger_data === null ? null : JSON.stringify(this.provenance.trigger_data),
    ];
  }

  close(): void {
    this.raw.close();
  }

  migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS behaviors (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT '',
        expected TEXT NOT NULL DEFAULT '',
        verify TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'verified', 'failed', 'waived')),
        enforced INTEGER NOT NULL DEFAULT 1 CHECK (enforced IN (0, 1)),
        ordinal INTEGER NOT NULL,
        UNIQUE(issue_id, ordinal)
      );

      CREATE TABLE IF NOT EXISTS review_passes (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        pass_number INTEGER NOT NULL CHECK (pass_number BETWEEN 1 AND 3),
        kind TEXT NOT NULL CHECK (kind IN ('comprehensive', 'repair_verification', 'decision')),
        verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail')),
        summary TEXT NOT NULL,
        legacy_pass_count INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(issue_id, pass_number)
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        behavior_id TEXT REFERENCES behaviors(id) ON DELETE CASCADE,
        tier TEXT NOT NULL CHECK (tier IN ('unit', 'wired', 'live')),
        verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail')),
        summary TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        review_pass_id TEXT REFERENCES review_passes(id) ON DELETE SET NULL,
        behavior_id TEXT REFERENCES behaviors(id) ON DELETE SET NULL,
        severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'repaired', 'accepted_debt')),
        title TEXT NOT NULL,
        blocker_reachability TEXT,
        blocker_impact TEXT,
        blocker_rollback TEXT,
        smallest_fix TEXT
      );

      CREATE TABLE IF NOT EXISTS waivers (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        behavior_id TEXT NOT NULL UNIQUE REFERENCES behaviors(id) ON DELETE CASCADE,
        rationale TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS planning_profiles (
        issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS shape_assessments (
        issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS planning_review_passes (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        pass_number INTEGER NOT NULL CHECK (pass_number BETWEEN 1 AND 3),
        kind TEXT NOT NULL CHECK (kind IN ('comprehensive', 'repair_verification', 'decision')),
        verdict TEXT NOT NULL CHECK (verdict IN ('approved', 'changes_required', 'rescope', 'return_to_shaping')),
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(issue_id, pass_number)
      );

      CREATE TABLE IF NOT EXISTS planning_findings (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        planning_review_pass_id TEXT REFERENCES planning_review_passes(id) ON DELETE SET NULL,
        stage TEXT NOT NULL CHECK (stage IN ('shape', 'planning')),
        severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'repaired', 'accepted_debt')),
        title TEXT NOT NULL,
        reachability TEXT,
        impact TEXT,
        smallest_fix TEXT
      );

      CREATE TABLE IF NOT EXISTS workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_issue TEXT REFERENCES issues(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_behaviors_issue ON behaviors(issue_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_issue ON evidence(issue_id);
      CREATE INDEX IF NOT EXISTS idx_findings_issue ON findings(issue_id);
      CREATE INDEX IF NOT EXISTS idx_review_passes_issue ON review_passes(issue_id);
      CREATE INDEX IF NOT EXISTS idx_planning_review_passes_issue ON planning_review_passes(issue_id);
      CREATE INDEX IF NOT EXISTS idx_planning_findings_issue ON planning_findings(issue_id);
    `);

    const behaviorColumns = new Set(
      (this.raw.prepare("PRAGMA table_info(behaviors)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    for (const column of ["trigger", "expected", "verify"]) {
      if (!behaviorColumns.has(column)) this.raw.exec(`ALTER TABLE behaviors ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    }

    // LB-21 — additive, nullable provenance columns on every written table.
    // Existing rows stay null and read as the legacy source: the causing
    // ingress is unknowable retroactively, so no backfill is attempted.
    // Re-running changes nothing.
    for (const table of PROVENANCE_TABLES) {
      const existing = new Set(
        (this.raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
      );
      for (const column of ["trigger_type", "triggered_by", "trigger_data"]) {
        if (!existing.has(column)) this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
      }
    }
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  listIssues(): IssueRow[] {
    return this.raw.prepare("SELECT * FROM issues ORDER BY created_at, id").all() as unknown as IssueRow[];
  }

  issue(id: string): IssueRow | undefined {
    return this.raw.prepare("SELECT * FROM issues WHERE id = ?").get(id) as unknown as IssueRow | undefined;
  }

  behaviors(issueId: string): BehaviorRow[] {
    return this.raw.prepare("SELECT * FROM behaviors WHERE issue_id = ? ORDER BY ordinal").all(issueId) as unknown as BehaviorRow[];
  }

  evidence(issueId: string): EvidenceRow[] {
    return this.raw.prepare("SELECT * FROM evidence WHERE issue_id = ? ORDER BY rowid").all(issueId) as unknown as EvidenceRow[];
  }

  findings(issueId: string): FindingRow[] {
    return this.raw.prepare("SELECT * FROM findings WHERE issue_id = ? ORDER BY severity, id").all(issueId) as unknown as FindingRow[];
  }

  reviewPasses(issueId: string): ReviewPassRow[] {
    return this.raw.prepare("SELECT * FROM review_passes WHERE issue_id = ? ORDER BY pass_number").all(issueId) as unknown as ReviewPassRow[];
  }

  planningReviewPasses(issueId: string): PlanningReviewPassRow[] {
    return this.raw.prepare("SELECT * FROM planning_review_passes WHERE issue_id = ? ORDER BY pass_number").all(issueId) as unknown as PlanningReviewPassRow[];
  }

  planningFindings(issueId: string): PlanningFindingRow[] {
    return this.raw.prepare("SELECT * FROM planning_findings WHERE issue_id = ? ORDER BY severity, id").all(issueId) as unknown as PlanningFindingRow[];
  }

  waivers(issueId: string): WaiverRow[] {
    return this.raw.prepare("SELECT * FROM waivers WHERE issue_id = ? ORDER BY created_at, id").all(issueId) as unknown as WaiverRow[];
  }

  planningProfile(issueId: string): PlanningProfile | null {
    const row = this.raw.prepare("SELECT profile_json FROM planning_profiles WHERE issue_id = ?").get(issueId) as { profile_json: string } | undefined;
    return row ? JSON.parse(row.profile_json) as PlanningProfile : null;
  }

  setPlanningProfile(issueId: string, profile: PlanningProfile): void {
    // LB-21 write site: a profile setter, not a direct INSERT in domain.ts.
    // The ON CONFLICT branch re-stamps, because an updated profile is a new row
    // version and must carry the ingress that produced it.
    this.raw.prepare(`
      INSERT INTO planning_profiles (issue_id, profile_json, trigger_type, triggered_by, trigger_data) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        profile_json = excluded.profile_json,
        updated_at = CURRENT_TIMESTAMP,
        trigger_type = excluded.trigger_type,
        triggered_by = excluded.triggered_by,
        trigger_data = excluded.trigger_data
    `).run(issueId, JSON.stringify(profile), ...this.provenanceValues());
  }

  shapeProfile(issueId: string): ShapeProfile | null {
    const row = this.raw.prepare("SELECT profile_json FROM shape_assessments WHERE issue_id = ?").get(issueId) as { profile_json: string } | undefined;
    return row ? JSON.parse(row.profile_json) as ShapeProfile : null;
  }

  setShapeProfile(issueId: string, profile: ShapeProfile): void {
    // LB-21 write site: the second profile setter. Same re-stamp rule as
    // setPlanningProfile — a replaced shape is a new row version.
    this.raw.prepare(`
      INSERT INTO shape_assessments (issue_id, profile_json, trigger_type, triggered_by, trigger_data) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        profile_json = excluded.profile_json,
        updated_at = CURRENT_TIMESTAMP,
        trigger_type = excluded.trigger_type,
        triggered_by = excluded.triggered_by,
        trigger_data = excluded.trigger_data
    `).run(issueId, JSON.stringify(profile), ...this.provenanceValues());
  }

  activeIssue(): string | null {
    const row = this.raw.prepare("SELECT active_issue FROM workspace WHERE id = 1").get() as { active_issue: string | null } | undefined;
    return row?.active_issue ?? null;
  }

  setActiveIssue(issueId: string): void {
    this.raw.prepare(`
      INSERT INTO workspace (id, active_issue) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET active_issue = excluded.active_issue
    `).run(issueId);
  }

  clearActiveIssue(): void {
    this.raw.prepare(`
      INSERT INTO workspace (id, active_issue) VALUES (1, NULL)
      ON CONFLICT(id) DO UPDATE SET active_issue = NULL
    `).run();
  }
}

/**
 * LB-21 — every ingress declares itself here. A caller that omits `provenance`
 * gets {@link DEFAULT_PROVENANCE} (`cli`/`unknown`) rather than nulls, so
 * `triggered_by` is never null on any written row.
 */
export function openDb(path?: string, provenance?: Provenance): LoopbreakerDb {
  const db = new LoopbreakerDb(path, provenance);
  db.migrate();
  return db;
}

/** Resolve the `cli` ingress actor: LOOPBREAKER_ACTOR, else the OS username, else `unknown`. */
export function cliActor(): string {
  const declared = process.env.LOOPBREAKER_ACTOR?.trim();
  if (declared) return declared;
  try {
    const name = userInfo().username?.trim();
    if (name) return name;
  } catch {
    // userInfo() throws on some sandboxes with no passwd entry; fall through.
  }
  return "unknown";
}
