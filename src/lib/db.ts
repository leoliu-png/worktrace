import Database from 'better-sqlite3';
import { builtInAdminEmails, isAdminEmail, isBuiltInAdminEmail } from './access';
import { decryptApiKey, verifyApiKey } from './api-keys';
import { workLogMarkdownContent } from './markdown-work-log';
import { resolveReportDate, workTraceReportDate } from './report-date';
import type { MobiusSyncResult, MobiusSyncRun, MobiusSyncSource } from './mobius-sync-result';
import { feedbackInputSchema, feedbackReviewSchema, type Feedback, type FeedbackInput, type FeedbackReview, type FeedbackStatus } from './feedback';

type LocalDatabase = Database.Database;
export type LocalUser = { id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER' };
export type WorkLogInput = { reportDate?: string; title: string; completed: string[]; inProgress?: string; blockers?: string; nextPlan?: string; markdownContent?: string };
export type LocalWorkLog = { id: string; authorId: string; reportDate: string; title: string; completed: string[]; inProgress: string; blockers: string; nextPlan: string; markdownContent: string; createdAt: string; updatedAt: string };
export type LocalWorkLogAttachment = { id: string; workLogId: string; filename: string; storageKey: string; mimeType: string; size: number; createdAt: string };
export type NewWorkLogAttachment = Pick<LocalWorkLogAttachment, 'filename' | 'storageKey' | 'mimeType' | 'size'>;
export type LocalApiKey = { id: string; userId: string; name: string; prefix: string; status: 'ACTIVE' | 'DISABLED' | 'REVOKED'; createdAt: string; lastUsedAt: string | null };
export type AuditEvent = { id: string; actorId: string; type: string; targetType: string; targetId: string; createdAt: string };
export type WorkLogQuery = { authorId?: string; query?: string; reportDate?: string; from?: string; to?: string; cursor?: string | null; limit?: number };

type NewApiKey = { name: string; prefix: string; lookupPrefix: string; hash: string; encryptedSecret: string };

export function createDatabase(filename = process.env.LOCAL_DATABASE_PATH ?? 'worktrace-local.db') {
  const sqlite: LocalDatabase = new Database(filename);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS work_logs (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, report_date TEXT NOT NULL, title TEXT NOT NULL, completed TEXT NOT NULL, in_progress TEXT NOT NULL DEFAULT '', blockers TEXT NOT NULL DEFAULT '', next_plan TEXT NOT NULL DEFAULT '', markdown_content TEXT NOT NULL DEFAULT '', idempotency_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS work_log_requests (author_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, work_log_id TEXT NOT NULL REFERENCES work_logs(id) ON DELETE CASCADE, PRIMARY KEY (author_id, idempotency_key));
    CREATE TABLE IF NOT EXISTS mobius_comment_claims (issue_identifier TEXT NOT NULL, local_date TEXT NOT NULL, work_log_id TEXT NOT NULL REFERENCES work_logs(id) ON DELETE CASCADE, claim_id TEXT NOT NULL, claimed_at TEXT NOT NULL, posted_at TEXT, PRIMARY KEY (issue_identifier, local_date));
    CREATE TABLE IF NOT EXISTS mobius_sync_runs (id TEXT PRIMARY KEY, work_log_id TEXT NOT NULL REFERENCES work_logs(id) ON DELETE CASCADE, log_title TEXT NOT NULL, report_date TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, result_json TEXT);
    CREATE TABLE IF NOT EXISTS work_log_attachments (id TEXT PRIMARY KEY, work_log_id TEXT NOT NULL REFERENCES work_logs(id) ON DELETE CASCADE, filename TEXT NOT NULL, storage_key TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL, lookup_prefix TEXT, hash TEXT NOT NULL, encrypted_secret TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT);
    CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, type TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', reply TEXT NOT NULL DEFAULT '', reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const workLogColumns = new Set((sqlite.prepare('PRAGMA table_info(work_logs)').all() as { name: string }[]).map((column) => column.name));
  if (!workLogColumns.has('report_date')) {
    sqlite.exec('ALTER TABLE work_logs ADD COLUMN report_date TEXT');
    sqlite.exec("UPDATE work_logs SET report_date = date(created_at, '+8 hours') WHERE report_date IS NULL OR report_date = ''");
  }
  for (const [name, definition] of [['in_progress', "TEXT NOT NULL DEFAULT ''"], ['blockers', "TEXT NOT NULL DEFAULT ''"], ['next_plan', "TEXT NOT NULL DEFAULT ''"], ['markdown_content', "TEXT NOT NULL DEFAULT ''"], ['idempotency_key', 'TEXT'], ['updated_at', 'TEXT']] as const) {
    if (!workLogColumns.has(name)) sqlite.exec(`ALTER TABLE work_logs ADD COLUMN ${name} ${definition}`);
  }
  sqlite.prepare('UPDATE work_logs SET updated_at = created_at WHERE updated_at IS NULL').run();
  const apiKeyColumns = new Set((sqlite.prepare('PRAGMA table_info(api_keys)').all() as { name: string }[]).map((column) => column.name));
  if (!apiKeyColumns.has('lookup_prefix')) sqlite.exec('ALTER TABLE api_keys ADD COLUMN lookup_prefix TEXT');
  sqlite.prepare("UPDATE api_keys SET lookup_prefix = substr(prefix, 1, 12) WHERE lookup_prefix IS NULL").run();
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_work_logs_author_created ON work_logs(author_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_work_logs_author_report_date ON work_logs(author_id, report_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_work_logs_created ON work_logs(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_work_logs_updated ON work_logs(updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_mobius_sync_runs_created ON mobius_sync_runs(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_mobius_sync_runs_log ON mobius_sync_runs(work_log_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_log_attachments_log ON work_log_attachments(work_log_id, created_at ASC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_logs_idempotency ON work_logs(author_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_api_keys_lookup_prefix ON api_keys(lookup_prefix);
    CREATE INDEX IF NOT EXISTS idx_feedback_author_created ON feedback(author_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_status_created ON feedback(status, created_at DESC, id DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS work_logs_fts USING fts5(title, completed, in_progress, blockers, next_plan, content='work_logs', content_rowid='rowid');
    CREATE TRIGGER IF NOT EXISTS work_logs_fts_insert AFTER INSERT ON work_logs BEGIN
      INSERT INTO work_logs_fts(rowid, title, completed, in_progress, blockers, next_plan) VALUES (new.rowid, new.title, new.completed, new.in_progress, new.blockers, new.next_plan);
    END;
    CREATE TRIGGER IF NOT EXISTS work_logs_fts_delete AFTER DELETE ON work_logs BEGIN
      INSERT INTO work_logs_fts(work_logs_fts, rowid, title, completed, in_progress, blockers, next_plan) VALUES ('delete', old.rowid, old.title, old.completed, old.in_progress, old.blockers, old.next_plan);
    END;
    CREATE TRIGGER IF NOT EXISTS work_logs_fts_update AFTER UPDATE ON work_logs BEGIN
      INSERT INTO work_logs_fts(work_logs_fts, rowid, title, completed, in_progress, blockers, next_plan) VALUES ('delete', old.rowid, old.title, old.completed, old.in_progress, old.blockers, old.next_plan);
      INSERT INTO work_logs_fts(rowid, title, completed, in_progress, blockers, next_plan) VALUES (new.rowid, new.title, new.completed, new.in_progress, new.blockers, new.next_plan);
    END;
  `);

  function asWorkLog(row: any): LocalWorkLog {
    const log = { id: row.id, authorId: row.author_id, reportDate: row.report_date ?? workTraceReportDate(new Date(row.created_at)), title: row.title, completed: JSON.parse(row.completed), inProgress: row.in_progress ?? '', blockers: row.blockers ?? '', nextPlan: row.next_plan ?? '', markdownContent: row.markdown_content ?? '', createdAt: row.created_at, updatedAt: row.updated_at ?? row.created_at };
    return { ...log, markdownContent: workLogMarkdownContent(log) };
  }

  function asFeedback(row: any): Feedback {
    return { id: row.id, authorId: row.author_id, authorName: row.author_name, authorEmail: row.author_email,
      category: row.category, title: row.title, description: row.description, status: row.status,
      reply: row.reply, reviewedBy: row.reviewed_by, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  function feedbackViewer(viewerId: string, all = false): LocalUser {
    const viewer = sqlite.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(viewerId) as LocalUser | undefined;
    if (!viewer) throw new Error('User was not found');
    if (all && viewer.role !== 'ADMIN') throw new Error('Administrator access is required');
    return viewer;
  }

  function parseCursor(cursor?: string | null): { createdAt: string; id: string } | undefined {
    if (!cursor) return undefined;
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      return typeof decoded.createdAt === 'string' && typeof decoded.id === 'string' ? decoded : undefined;
    } catch { return undefined; }
  }

  function searchQuery(value: string): string {
    return value.trim().split(/\s+/).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"`).join(' ');
  }

  function writeAuditEvent(actorId: string, type: string, targetType: string, targetId: string): AuditEvent {
    const event: AuditEvent = { id: crypto.randomUUID(), actorId, type, targetType, targetId, createdAt: new Date().toISOString() };
    sqlite.prepare('INSERT INTO audit_events (id, actor_id, type, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(event.id, event.actorId, event.type, event.targetType, event.targetId, event.createdAt);
    return event;
  }

  // Apply the built-in administrator policy to accounts already stored before deployment.
  sqlite.transaction(() => {
    const findMembers = sqlite.prepare("SELECT id FROM users WHERE lower(trim(email)) = ? AND role <> 'ADMIN'");
    const promoteMember = sqlite.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?");
    for (const email of builtInAdminEmails) {
      const members = findMembers.all(email) as { id: string }[];
      for (const member of members) {
        promoteMember.run(member.id);
        writeAuditEvent(member.id, 'USER_ROLE_CHANGED', 'USER', member.id);
      }
    }
  })();

  function saveDailyWorkLog(authorId: string, input: WorkLogInput, now: Date) {
    const reportDate = resolveReportDate(input.reportDate, now);
    const existing = sqlite.prepare('SELECT * FROM work_logs WHERE author_id = ? AND report_date = ? ORDER BY updated_at DESC, id DESC LIMIT 1').get(authorId, reportDate) as any;
    if (existing) {
      const current = asWorkLog(existing);
      const log: LocalWorkLog = { ...current, reportDate, title: input.title, completed: input.completed, inProgress: input.inProgress ?? '', blockers: input.blockers ?? '', nextPlan: input.nextPlan ?? '', markdownContent: workLogMarkdownContent(input), updatedAt: now.toISOString() };
      sqlite.prepare('UPDATE work_logs SET title = ?, completed = ?, in_progress = ?, blockers = ?, next_plan = ?, markdown_content = ?, updated_at = ? WHERE id = ?').run(log.title, JSON.stringify(log.completed), log.inProgress, log.blockers, log.nextPlan, log.markdownContent, log.updatedAt, log.id);
      writeAuditEvent(authorId, 'WORK_LOG_UPDATED', 'WORK_LOG', log.id);
      return { log, created: false };
    }
    const submittedAt = now.toISOString();
    const log: LocalWorkLog = { id: crypto.randomUUID(), authorId, reportDate, title: input.title, completed: input.completed, inProgress: input.inProgress ?? '', blockers: input.blockers ?? '', nextPlan: input.nextPlan ?? '', markdownContent: workLogMarkdownContent(input), createdAt: submittedAt, updatedAt: submittedAt };
    sqlite.prepare('INSERT INTO work_logs (id, author_id, report_date, title, completed, in_progress, blockers, next_plan, markdown_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(log.id, log.authorId, log.reportDate, log.title, JSON.stringify(log.completed), log.inProgress, log.blockers, log.nextPlan, log.markdownContent, log.createdAt, log.updatedAt);
    writeAuditEvent(authorId, 'WORK_LOG_CREATED', 'WORK_LOG', log.id);
    return { log, created: true };
  }

  return {
    transaction<T>(callback: () => T): T { return sqlite.transaction(callback)(); },
    createFeedback(authorId: string, input: FeedbackInput): Feedback {
      const parsed = feedbackInputSchema.parse(input);
      return sqlite.transaction(() => {
        const author = feedbackViewer(authorId);
        const now = new Date().toISOString();
        const feedback: Feedback = { ...parsed, id: crypto.randomUUID(), authorId, authorName: author.name, authorEmail: author.email, status: 'OPEN', reply: '', reviewedBy: null, createdAt: now, updatedAt: now };
        sqlite.prepare('INSERT INTO feedback (id, author_id, category, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(feedback.id, authorId, feedback.category, feedback.title, feedback.description, feedback.status, now, now);
        writeAuditEvent(authorId, 'FEEDBACK_CREATED', 'FEEDBACK', feedback.id);
        return feedback;
      })();
    },
    getFeedback(id: string, viewerId: string): Feedback | undefined {
      const viewer = feedbackViewer(viewerId);
      const row = sqlite.prepare('SELECT feedback.*, users.name AS author_name, users.email AS author_email FROM feedback JOIN users ON users.id = feedback.author_id WHERE feedback.id = ?').get(id) as any;
      return row && (row.author_id === viewerId || viewer.role === 'ADMIN') ? asFeedback(row) : undefined;
    },
    listFeedback(viewerId: string, options: { all?: boolean; status?: FeedbackStatus; limit?: number; cursor?: string } = {}) {
      feedbackViewer(viewerId, options.all);
      const where: string[] = [];
      const values: unknown[] = [];
      if (!options.all) { where.push('feedback.author_id = ?'); values.push(viewerId); }
      if (options.status) { where.push('feedback.status = ?'); values.push(options.status); }
      const cursor = parseCursor(options.cursor);
      if (cursor) { where.push('(feedback.created_at < ? OR (feedback.created_at = ? AND feedback.id < ?))'); values.push(cursor.createdAt, cursor.createdAt, cursor.id); }
      const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
      const rows = sqlite.prepare(`SELECT feedback.*, users.name AS author_name, users.email AS author_email FROM feedback JOIN users ON users.id = feedback.author_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY feedback.created_at DESC, feedback.id DESC LIMIT ?`)
        .all(...values, limit + 1);
      const items = rows.slice(0, limit).map(asFeedback);
      const last = items.at(-1);
      return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null };
    },
    reviewFeedback(id: string, actorId: string, input: FeedbackReview): Feedback {
      const parsed = feedbackReviewSchema.parse(input);
      return sqlite.transaction(() => {
        feedbackViewer(actorId, true);
        const current = this.getFeedback(id, actorId);
        if (!current) throw new Error('Feedback was not found');
        const updatedAt = new Date().toISOString();
        sqlite.prepare('UPDATE feedback SET status = ?, reply = ?, reviewed_by = ?, updated_at = ? WHERE id = ?')
          .run(parsed.status, parsed.reply, actorId, updatedAt, id);
        writeAuditEvent(actorId, 'FEEDBACK_REVIEWED', 'FEEDBACK', id);
        return { ...current, ...parsed, reviewedBy: actorId, updatedAt };
      })();
    },
    startMobiusSyncRun(log: Pick<LocalWorkLog, 'id' | 'title' | 'reportDate'>, source: MobiusSyncSource, now = new Date()): string {
      const id = crypto.randomUUID();
      sqlite.prepare("INSERT INTO mobius_sync_runs (id, work_log_id, log_title, report_date, source, status, created_at) VALUES (?, ?, ?, ?, ?, 'matching', ?)")
        .run(id, log.id, log.title, log.reportDate, source, now.toISOString());
      return id;
    },
    finishMobiusSyncRun(id: string, result: MobiusSyncResult): void {
      sqlite.prepare('UPDATE mobius_sync_runs SET status = ?, finished_at = ?, result_json = ? WHERE id = ?')
        .run(result.status, new Date().toISOString(), JSON.stringify(result), id);
    },
    listMobiusSyncRuns(authorId: string, options: { limit?: number; cursor?: string; workLogId?: string } = {}) {
      const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
      const cursor = parseCursor(options.cursor);
      const where = ['work_logs.author_id = ?'];
      const values: unknown[] = [authorId];
      if (options.workLogId) { where.push('runs.work_log_id = ?'); values.push(options.workLogId); }
      if (cursor) { where.push('(runs.created_at < ? OR (runs.created_at = ? AND runs.id < ?))'); values.push(cursor.createdAt, cursor.createdAt, cursor.id); }
      const rows = sqlite.prepare(`SELECT runs.* FROM mobius_sync_runs runs JOIN work_logs ON work_logs.id = runs.work_log_id WHERE ${where.join(' AND ')} ORDER BY runs.created_at DESC, runs.id DESC LIMIT ?`)
        .all(...values, limit + 1) as Array<{ id: string; work_log_id: string; log_title: string; report_date: string; source: MobiusSyncSource; status: MobiusSyncRun['status']; created_at: string; finished_at: string | null; result_json: string | null }>;
      const items: MobiusSyncRun[] = rows.slice(0, limit).map((row) => ({ id: row.id, workLogId: row.work_log_id, logTitle: row.log_title, reportDate: row.report_date, source: row.source, status: row.status, createdAt: row.created_at, finishedAt: row.finished_at, result: row.result_json ? JSON.parse(row.result_json) as MobiusSyncResult : null }));
      const last = items.at(-1);
      return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null };
    },
    claimMobiusComment(issueIdentifier: string, localDate: string, workLogId: string, now = new Date()): string | null {
      return sqlite.transaction(() => {
        const current = sqlite.prepare('SELECT claim_id, claimed_at, posted_at FROM mobius_comment_claims WHERE issue_identifier = ? AND local_date = ?')
          .get(issueIdentifier, localDate) as { claim_id: string; claimed_at: string; posted_at: string | null } | undefined;
        if (current?.posted_at || (current && now.getTime() - new Date(current.claimed_at).getTime() < 10 * 60_000)) return null;
        const claimId = crypto.randomUUID();
        if (current) {
          const result = sqlite.prepare('UPDATE mobius_comment_claims SET work_log_id = ?, claim_id = ?, claimed_at = ? WHERE issue_identifier = ? AND local_date = ? AND claim_id = ? AND posted_at IS NULL')
            .run(workLogId, claimId, now.toISOString(), issueIdentifier, localDate, current.claim_id);
          return result.changes ? claimId : null;
        }
        const result = sqlite.prepare('INSERT OR IGNORE INTO mobius_comment_claims (issue_identifier, local_date, work_log_id, claim_id, claimed_at) VALUES (?, ?, ?, ?, ?)')
          .run(issueIdentifier, localDate, workLogId, claimId, now.toISOString());
        return result.changes ? claimId : null;
      })();
    },
    markMobiusCommentPosted(claimId: string): void {
      sqlite.prepare('UPDATE mobius_comment_claims SET posted_at = ? WHERE claim_id = ? AND posted_at IS NULL').run(new Date().toISOString(), claimId);
    },
    releaseMobiusCommentClaim(claimId: string): void {
      sqlite.prepare('DELETE FROM mobius_comment_claims WHERE claim_id = ? AND posted_at IS NULL').run(claimId);
    },
    diagnostics() {
      return {
        foreignKeys: sqlite.pragma('foreign_keys', { simple: true }) as number,
        busyTimeout: sqlite.pragma('busy_timeout', { simple: true }) as number,
      };
    },
    findOrCreateUser(email: string, name: string): LocalUser {
      const found = sqlite.prepare('SELECT id, email, name, role FROM users WHERE email = ?').get(email) as LocalUser | undefined;
      if (found) return found;
      const user: LocalUser = { id: crypto.randomUUID(), email, name, role: isAdminEmail(email) ? 'ADMIN' : 'MEMBER' };
      sqlite.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)').run(user.id, user.email, user.name, user.role);
      return user;
    },
    listUsers(): LocalUser[] {
      return sqlite.prepare('SELECT id, email, name, role FROM users ORDER BY email').all() as LocalUser[];
    },
    setUserRole(userId: string, role: 'ADMIN' | 'MEMBER', actorId = userId): LocalUser {
      const current = sqlite.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(userId) as LocalUser | undefined;
      if (!current) throw new Error('User was not found');
      if (role === 'MEMBER' && isBuiltInAdminEmail(current.email)) {
        throw new Error('Cannot demote a built-in administrator');
      }
      if (current.role === 'ADMIN' && role === 'MEMBER') {
        const administrators = sqlite.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'ADMIN'").get() as { total: number };
        if (administrators.total <= 1) throw new Error('Cannot remove the last administrator');
      }
      sqlite.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
      writeAuditEvent(actorId, 'USER_ROLE_CHANGED', 'USER', userId);
      return { ...current, role };
    },
    deleteUser(userId: string, actorId: string): void {
      const current = sqlite.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(userId) as LocalUser | undefined;
      if (!current) throw new Error('User was not found');
      if (current.id === actorId) throw new Error('You cannot delete your own account');
      if (current.role === 'ADMIN') {
        const administrators = sqlite.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'ADMIN'").get() as { total: number };
        if (administrators.total <= 1) throw new Error('Cannot remove the last administrator');
      }
      sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM api_keys WHERE user_id = ?').run(userId);
        sqlite.prepare('DELETE FROM work_logs WHERE author_id = ?').run(userId);
        sqlite.prepare('DELETE FROM users WHERE id = ?').run(userId);
        writeAuditEvent(actorId, 'USER_DELETED', 'USER', userId);
      })();
    },
    createWorkLog(authorId: string, input: WorkLogInput): LocalWorkLog {
      const now = new Date().toISOString();
      const reportDate = resolveReportDate(input.reportDate, new Date(now));
      const log: LocalWorkLog = { id: crypto.randomUUID(), authorId, reportDate, title: input.title, completed: input.completed, inProgress: input.inProgress ?? '', blockers: input.blockers ?? '', nextPlan: input.nextPlan ?? '', markdownContent: workLogMarkdownContent(input), createdAt: now, updatedAt: now };
      sqlite.prepare('INSERT INTO work_logs (id, author_id, report_date, title, completed, in_progress, blockers, next_plan, markdown_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(log.id, log.authorId, log.reportDate, log.title, JSON.stringify(log.completed), log.inProgress, log.blockers, log.nextPlan, log.markdownContent, log.createdAt, log.updatedAt);
      writeAuditEvent(authorId, 'WORK_LOG_CREATED', 'WORK_LOG', log.id);
      return log;
    },
    createWorkLogIdempotent(authorId: string, input: WorkLogInput, idempotencyKey: string) {
      return sqlite.transaction(() => {
        const existing = sqlite.prepare('SELECT * FROM work_logs WHERE author_id = ? AND idempotency_key = ?').get(authorId, idempotencyKey) as any;
        if (existing) return { log: asWorkLog(existing), created: false };
        const now = new Date().toISOString();
        const reportDate = resolveReportDate(input.reportDate, new Date(now));
        const log: LocalWorkLog = { id: crypto.randomUUID(), authorId, reportDate, title: input.title, completed: input.completed, inProgress: input.inProgress ?? '', blockers: input.blockers ?? '', nextPlan: input.nextPlan ?? '', markdownContent: workLogMarkdownContent(input), createdAt: now, updatedAt: now };
        sqlite.prepare('INSERT INTO work_logs (id, author_id, report_date, title, completed, in_progress, blockers, next_plan, markdown_content, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(log.id, log.authorId, log.reportDate, log.title, JSON.stringify(log.completed), log.inProgress, log.blockers, log.nextPlan, log.markdownContent, idempotencyKey, log.createdAt, log.updatedAt);
        writeAuditEvent(authorId, 'WORK_LOG_CREATED', 'WORK_LOG', log.id);
        return { log, created: true };
      })();
    },
    upsertDailyWorkLog(authorId: string, input: WorkLogInput, now = new Date()) {
      return sqlite.transaction(() => saveDailyWorkLog(authorId, input, now))();
    },
    upsertDailyWorkLogIdempotent(authorId: string, input: WorkLogInput, idempotencyKey: string, now = new Date()) {
      return sqlite.transaction(() => {
        const request = sqlite.prepare('SELECT work_logs.* FROM work_log_requests JOIN work_logs ON work_logs.id = work_log_requests.work_log_id WHERE work_log_requests.author_id = ? AND work_log_requests.idempotency_key = ?').get(authorId, idempotencyKey) as any;
        if (request) return { log: asWorkLog(request), created: false };
        const result = saveDailyWorkLog(authorId, input, now);
        sqlite.prepare('INSERT INTO work_log_requests (author_id, idempotency_key, work_log_id) VALUES (?, ?, ?)').run(authorId, idempotencyKey, result.log.id);
        return result;
      })();
    },
    getWorkLog(id: string): LocalWorkLog | undefined {
      const row = sqlite.prepare('SELECT * FROM work_logs WHERE id = ?').get(id) as any;
      return row ? asWorkLog(row) : undefined;
    },
    setWorkLogMarkdown(id: string, markdownContent: string): void {
      sqlite.prepare('UPDATE work_logs SET markdown_content = ? WHERE id = ?').run(markdownContent, id);
    },
    addWorkLogAttachments(workLogId: string, attachments: NewWorkLogAttachment[]): LocalWorkLogAttachment[] {
      if (!attachments.length) return [];
      const createdAt = new Date().toISOString();
      const statement = sqlite.prepare('INSERT INTO work_log_attachments (id, work_log_id, filename, storage_key, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      return sqlite.transaction(() => attachments.map((attachment) => {
        const stored: LocalWorkLogAttachment = { id: crypto.randomUUID(), workLogId, ...attachment, createdAt };
        statement.run(stored.id, stored.workLogId, stored.filename, stored.storageKey, stored.mimeType, stored.size, stored.createdAt);
        return stored;
      }))();
    },
    listWorkLogAttachments(workLogId: string): LocalWorkLogAttachment[] {
      return (sqlite.prepare('SELECT * FROM work_log_attachments WHERE work_log_id = ? ORDER BY created_at ASC, id ASC').all(workLogId) as any[])
        .map((row) => ({ id: row.id, workLogId: row.work_log_id, filename: row.filename, storageKey: row.storage_key, mimeType: row.mime_type, size: row.size, createdAt: row.created_at }));
    },
    getWorkLogAttachment(workLogId: string, attachmentId: string): LocalWorkLogAttachment | undefined {
      const row = sqlite.prepare('SELECT * FROM work_log_attachments WHERE id = ? AND work_log_id = ?').get(attachmentId, workLogId) as any;
      return row ? { id: row.id, workLogId: row.work_log_id, filename: row.filename, storageKey: row.storage_key, mimeType: row.mime_type, size: row.size, createdAt: row.created_at } : undefined;
    },
    listWorkLogs(authorId?: string): LocalWorkLog[] {
      const rows = authorId ? sqlite.prepare('SELECT * FROM work_logs WHERE author_id = ? ORDER BY updated_at DESC').all(authorId) : sqlite.prepare('SELECT * FROM work_logs ORDER BY updated_at DESC').all();
      return rows.map(asWorkLog);
    },
    queryWorkLogs(options: WorkLogQuery = {}) {
      const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
      const cursor = parseCursor(options.cursor);
      const where: string[] = [];
      const values: unknown[] = [];
      const normalizedQuery = options.query?.trim();
      const from = options.from ? workTraceReportDate(new Date(options.from)) : undefined;
      const to = options.to ? workTraceReportDate(new Date(options.to)) : undefined;
      if (normalizedQuery) {
        where.push('(work_logs.rowid IN (SELECT rowid FROM work_logs_fts WHERE work_logs_fts MATCH ?) OR instr(lower(work_logs.markdown_content), lower(?)) > 0)');
        values.push(searchQuery(normalizedQuery), normalizedQuery);
      }
      if (options.authorId) { where.push('work_logs.author_id = ?'); values.push(options.authorId); }
      if (options.reportDate) { where.push('work_logs.report_date = ?'); values.push(options.reportDate); }
      if (from) { where.push('work_logs.report_date >= ?'); values.push(from); }
      if (to) { where.push('work_logs.report_date < ?'); values.push(to); }
      if (cursor) { where.push('(work_logs.updated_at < ? OR (work_logs.updated_at = ? AND work_logs.id < ?))'); values.push(cursor.createdAt, cursor.createdAt, cursor.id); }
      const rows = sqlite.prepare(`SELECT work_logs.* FROM work_logs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY work_logs.updated_at DESC, work_logs.id DESC LIMIT ?`).all(...values, limit + 1) as any[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(asWorkLog);
      const last = items.at(-1);
      return { items, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.updatedAt, id: last.id })).toString('base64url') : null };
    },
    updateWorkLog(id: string, actorId: string, actorRole: LocalUser['role'], input: WorkLogInput): LocalWorkLog {
      const current = this.getWorkLog(id);
      if (!current) throw new Error('Work log was not found');
      if (current.authorId !== actorId && actorRole !== 'ADMIN') throw new Error('You are not allowed to update this work log');
      const updated: LocalWorkLog = { ...current, title: input.title, completed: input.completed, inProgress: input.inProgress ?? '', blockers: input.blockers ?? '', nextPlan: input.nextPlan ?? '', markdownContent: workLogMarkdownContent(input), updatedAt: new Date().toISOString() };
      sqlite.prepare('UPDATE work_logs SET title = ?, completed = ?, in_progress = ?, blockers = ?, next_plan = ?, markdown_content = ?, updated_at = ? WHERE id = ?').run(updated.title, JSON.stringify(updated.completed), updated.inProgress, updated.blockers, updated.nextPlan, updated.markdownContent, updated.updatedAt, id);
      writeAuditEvent(actorId, 'WORK_LOG_UPDATED', 'WORK_LOG', id);
      return updated;
    },
    deleteWorkLog(id: string, actorId: string, actorRole: LocalUser['role']): void {
      const current = this.getWorkLog(id);
      if (!current) throw new Error('Work log was not found');
      if (current.authorId !== actorId && actorRole !== 'ADMIN') throw new Error('You are not allowed to delete this work log');
      sqlite.prepare('DELETE FROM work_logs WHERE id = ?').run(id);
      writeAuditEvent(actorId, 'WORK_LOG_DELETED', 'WORK_LOG', id);
    },
    createApiKey(userId: string, input: NewApiKey): LocalApiKey {
      const key: LocalApiKey = {
        id: crypto.randomUUID(), userId, name: input.name, prefix: input.prefix,
        status: 'ACTIVE', createdAt: new Date().toISOString(), lastUsedAt: null,
      };
      sqlite.prepare('INSERT INTO api_keys (id, user_id, name, prefix, lookup_prefix, hash, encrypted_secret, status, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(key.id, key.userId, key.name, key.prefix, input.lookupPrefix, input.hash, input.encryptedSecret, key.status, key.createdAt, key.lastUsedAt);
      writeAuditEvent(userId, 'API_KEY_CREATED', 'API_KEY', key.id);
      return key;
    },
    listApiKeys(userId: string): LocalApiKey[] {
      return (sqlite.prepare('SELECT id, user_id, name, prefix, status, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[])
        .map((row) => ({ id: row.id, userId: row.user_id, name: row.name, prefix: row.prefix, status: row.status, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
    },
    revealApiKey(userId: string, keyId: string): string {
      const row = sqlite.prepare('SELECT encrypted_secret FROM api_keys WHERE id = ? AND user_id = ? AND status != ?').get(keyId, userId, 'REVOKED') as { encrypted_secret: string } | undefined;
      if (!row) throw new Error('API key was not found or has been revoked');
      writeAuditEvent(userId, 'API_KEY_REVEALED', 'API_KEY', keyId);
      return decryptApiKey(row.encrypted_secret);
    },
    setApiKeyStatus(userId: string, keyId: string, status: 'ACTIVE' | 'DISABLED' | 'REVOKED'): LocalApiKey {
      const current = sqlite.prepare('SELECT id, user_id, name, prefix, status, created_at, last_used_at FROM api_keys WHERE id = ? AND user_id = ?').get(keyId, userId) as any;
      if (!current || current.status === 'REVOKED') throw new Error('API key was not found or has been revoked');
      sqlite.prepare('UPDATE api_keys SET status = ? WHERE id = ?').run(status, keyId);
      writeAuditEvent(userId, `API_KEY_${status}`, 'API_KEY', keyId);
      return { id: current.id, userId: current.user_id, name: current.name, prefix: current.prefix, status, createdAt: current.created_at, lastUsedAt: current.last_used_at };
    },
    authenticateApiKey(secret: string): LocalUser | undefined {
      const matching = sqlite.prepare("SELECT id, user_id, hash FROM api_keys WHERE status = 'ACTIVE' AND lookup_prefix = ?").get(secret.slice(0, 12)) as { id: string; user_id: string; hash: string } | undefined;
      if (!matching || !verifyApiKey(secret, matching.hash)) return undefined;
      const user = sqlite.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(matching.user_id) as LocalUser | undefined;
      if (!user) return undefined;
      sqlite.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), matching.id);
      return user;
    },
    listAuditEvents(actorId?: string): AuditEvent[] {
      const rows = actorId
        ? sqlite.prepare('SELECT * FROM audit_events WHERE actor_id = ? ORDER BY created_at DESC').all(actorId)
        : sqlite.prepare('SELECT * FROM audit_events ORDER BY created_at DESC').all();
      return (rows as any[]).map((row) => ({ id: row.id, actorId: row.actor_id, type: row.type, targetType: row.target_type, targetId: row.target_id, createdAt: row.created_at }));
    },
    close() { sqlite.close(); },
  };
}
