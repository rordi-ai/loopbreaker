import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  BehaviorRow,
  EvidenceRow,
  FindingRow,
  IssueRow,
  ReviewPassRow,
  WaiverRow,
} from "./types.js";

export const DEFAULT_DB = ".loopbreaker/loopbreaker.db";

export class LoopbreakerDb {
  readonly path: string;
  readonly raw: DatabaseSync;

  constructor(path = process.env.LOOPBREAKER_DB ?? DEFAULT_DB) {
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.raw = new DatabaseSync(this.path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
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

      CREATE INDEX IF NOT EXISTS idx_behaviors_issue ON behaviors(issue_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_issue ON evidence(issue_id);
      CREATE INDEX IF NOT EXISTS idx_findings_issue ON findings(issue_id);
      CREATE INDEX IF NOT EXISTS idx_review_passes_issue ON review_passes(issue_id);
    `);
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

  waivers(issueId: string): WaiverRow[] {
    return this.raw.prepare("SELECT * FROM waivers WHERE issue_id = ? ORDER BY created_at, id").all(issueId) as unknown as WaiverRow[];
  }
}

export function openDb(path?: string): LoopbreakerDb {
  const db = new LoopbreakerDb(path);
  db.migrate();
  return db;
}
