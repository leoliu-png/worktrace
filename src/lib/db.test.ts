import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createApiKey } from './api-keys';
import { createDatabase } from './db';

describe('local WorkTrace database', () => {
  it('configures SQLite for foreign keys, WAL reads, and busy retries', () => {
    const db = createDatabase(':memory:');

    expect(db.diagnostics()).toMatchObject({ foreignKeys: 1, busyTimeout: 5000 });
    db.close();
  });

  it('migrates existing logs by deriving their Shanghai report date from creation time', () => {
    const directory = mkdtempSync(join(tmpdir(), 'worktrace-report-date-'));
    const filename = join(directory, 'legacy.db');
    const legacy = new Database(filename);
    legacy.exec(`
      CREATE TABLE work_logs (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, title TEXT NOT NULL, completed TEXT NOT NULL, in_progress TEXT NOT NULL DEFAULT '', blockers TEXT NOT NULL DEFAULT '', next_plan TEXT NOT NULL DEFAULT '', idempotency_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO work_logs (id, author_id, title, completed, created_at, updated_at) VALUES ('legacy-log', 'member-1', 'Legacy', '["Done"]', '2026-09-04T16:30:00.000Z', '2026-09-04T16:30:00.000Z');
    `);
    legacy.close();

    try {
      const migrated = createDatabase(filename);
      expect(migrated.getWorkLog('legacy-log')).toMatchObject({ reportDate: '2026-09-05' });
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not rebuild the full-text index each time a database connection is opened', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/db.ts'), 'utf8');

    expect(source).not.toContain("INSERT INTO work_logs_fts(work_logs_fts) VALUES ('rebuild')");
  });

  it('creates the bootstrap administrator and persists a work log', () => {
    const db = createDatabase(':memory:');
    const admin = db.findOrCreateUser('linden@feedmob.com', 'Linden');
    expect(admin.role).toBe('ADMIN');
    const log = db.createWorkLog(admin.id, { title: 'First trace', completed: ['Defined the platform'] });
    expect(db.listWorkLogs(admin.id)).toEqual([expect.objectContaining({ id: log.id, title: 'First trace' })]);
    expect(db.listAuditEvents(admin.id)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'WORK_LOG_CREATED', targetId: log.id })]));
    db.close();
  });

  it('paginates work logs with a stable cursor', () => {
    const db = createDatabase(':memory:');
    const user = db.findOrCreateUser('member@feedmob.com', 'Member');
    db.createWorkLog(user.id, { title: 'One', completed: ['Done'] });
    db.createWorkLog(user.id, { title: 'Two', completed: ['Done'] });
    db.createWorkLog(user.id, { title: 'Three', completed: ['Done'] });

    const first = db.queryWorkLogs({ authorId: user.id, limit: 2 });
    const second = db.queryWorkLogs({ authorId: user.id, limit: 2, cursor: first.nextCursor! });

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.items).toHaveLength(1);
    expect(second.items.map((log) => log.id)).not.toContain(first.items[0].id);
    db.close();
  });

  it('combines author and text query filtering in SQLite', () => {
    const db = createDatabase(':memory:');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');
    const other = db.findOrCreateUser('other@feedmob.com', 'Other');
    db.createWorkLog(member.id, { title: 'Release checklist', completed: ['Published'], blockers: 'Waiting for vendor reply' });
    db.createWorkLog(other.id, { title: 'Vendor contract', completed: ['Reviewed'] });

    expect(db.queryWorkLogs({ authorId: member.id, query: 'vendor' }).items.map((log) => log.title)).toEqual(['Release checklist']);
    db.close();
  });

  it('applies date-range queries to the report date instead of the submission timestamp', () => {
    const db = createDatabase(':memory:');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');
    const catchUp = db.upsertDailyWorkLog(member.id, { reportDate: '2026-09-14', title: 'Catch-up', completed: ['Done'] }, new Date('2026-09-16T12:00:00+08:00'));

    const result = db.queryWorkLogs({
      from: '2026-09-13T16:00:00.000Z',
      to: '2026-09-14T16:00:00.000Z',
    });

    expect(result.items.map((log) => log.id)).toEqual([catchUp.log.id]);
    db.close();
  });

  it('returns an existing work log when an API upload is retried with the same idempotency key', () => {
    const db = createDatabase(':memory:');
    const user = db.findOrCreateUser('member@feedmob.com', 'Member');
    const first = db.createWorkLogIdempotent(user.id, { title: 'Upload', completed: ['Done'] }, 'upload-001');
    const retry = db.createWorkLogIdempotent(user.id, { title: 'Upload', completed: ['Done'] }, 'upload-001');

    expect(first.created).toBe(true);
    expect(retry).toMatchObject({ created: false, log: { id: first.log.id } });
    expect(db.listWorkLogs(user.id)).toHaveLength(1);
    db.close();
  });

  it('replaces only the same author\'s work log within one Shanghai calendar day', () => {
    const db = createDatabase(':memory:');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');
    const teammate = db.findOrCreateUser('teammate@feedmob.com', 'Teammate');

    const first = db.upsertDailyWorkLog(member.id, { title: 'Morning update', completed: ['Investigated'] }, new Date('2026-09-05T09:00:00+08:00'));
    const replacement = db.upsertDailyWorkLog(member.id, { title: 'Afternoon update', completed: ['Investigated', 'Fixed'], blockers: 'Waiting for review' }, new Date('2026-09-05T16:00:00+08:00'));
    const teammateLog = db.upsertDailyWorkLog(teammate.id, { title: 'Teammate update', completed: ['Shipped'] }, new Date('2026-09-05T16:00:00+08:00'));
    const nextDay = db.upsertDailyWorkLog(member.id, { title: 'Next day update', completed: ['Planned'] }, new Date('2026-09-06T09:00:00+08:00'));

    expect(first).toMatchObject({ created: true, log: { title: 'Morning update' } });
    expect(replacement).toMatchObject({ created: false, log: { id: first.log.id, title: 'Afternoon update', completed: ['Investigated', 'Fixed'], blockers: 'Waiting for review' } });
    expect(teammateLog).toMatchObject({ created: true, log: { authorId: teammate.id } });
    expect(nextDay).toMatchObject({ created: true, log: { authorId: member.id, title: 'Next day update' } });
    expect(db.listWorkLogs(member.id)).toHaveLength(2);
    expect(db.listAuditEvents(member.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'WORK_LOG_UPDATED', targetId: first.log.id }),
    ]));
    db.close();
  });

  it('stores a historical report date and replaces only that author/date pair', () => {
    const db = createDatabase(':memory:');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');

    const historical = db.upsertDailyWorkLog(member.id, {
      reportDate: '2026-09-14',
      title: '补交周一日报',
      completed: ['完成历史数据核对'],
    }, new Date('2026-09-16T10:00:00+08:00'));
    const replacement = db.upsertDailyWorkLog(member.id, {
      reportDate: '2026-09-14',
      title: '更新周一日报',
      completed: ['完成历史数据核对', '补充结论'],
    }, new Date('2026-09-16T20:00:00+08:00'));
    const anotherDate = db.upsertDailyWorkLog(member.id, {
      reportDate: '2026-09-15',
      title: '补交周二日报',
      completed: ['完成接口检查'],
    }, new Date('2026-09-16T20:05:00+08:00'));

    expect(historical).toMatchObject({
      created: true,
      log: { reportDate: '2026-09-14', createdAt: '2026-09-16T02:00:00.000Z' },
    });
    expect(replacement).toMatchObject({
      created: false,
      log: { id: historical.log.id, reportDate: '2026-09-14', title: '更新周一日报', updatedAt: '2026-09-16T12:00:00.000Z' },
    });
    expect(anotherDate).toMatchObject({ created: true, log: { reportDate: '2026-09-15' } });
    expect(db.listWorkLogs(member.id)).toHaveLength(2);
    db.close();
  });

  it('preserves the original creation time while refreshing the last submission time', () => {
    const db = createDatabase(':memory:');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');
    const first = db.upsertDailyWorkLog(member.id, { title: 'Morning update', completed: ['Investigated'] }, new Date('2026-09-05T09:10:00+08:00'));
    const replacement = db.upsertDailyWorkLog(member.id, { title: 'Evening update', completed: ['Investigated', 'Fixed'] }, new Date('2026-09-05T20:00:00+08:00'));

    expect(replacement.log).toMatchObject({
      id: first.log.id,
      createdAt: '2026-09-05T01:10:00.000Z',
      updatedAt: '2026-09-05T12:00:00.000Z',
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T21:30:00+08:00'));
    const edited = db.updateWorkLog(first.log.id, member.id, 'MEMBER', { title: 'Final update', completed: ['Reviewed'] });
    vi.useRealTimers();

    expect(edited).toMatchObject({
      createdAt: '2026-09-05T01:10:00.000Z',
      updatedAt: '2026-09-05T13:30:00.000Z',
    });
    db.close();
  });

  it('keeps an idempotent daily-upload retry from replacing a later submission', () => {
    const db = createDatabase(':memory:');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');
    const first = db.upsertDailyWorkLogIdempotent(member.id, { title: 'First upload', completed: ['Done'] }, 'request-1', new Date('2026-09-05T09:00:00+08:00'));
    const replacement = db.upsertDailyWorkLogIdempotent(member.id, { title: 'Latest upload', completed: ['Done', 'Reviewed'] }, 'request-2', new Date('2026-09-05T15:00:00+08:00'));
    const retry = db.upsertDailyWorkLogIdempotent(member.id, { title: 'First upload', completed: ['Done'] }, 'request-1', new Date('2026-09-05T16:00:00+08:00'));

    expect(first).toMatchObject({ created: true, log: { title: 'First upload' } });
    expect(replacement).toMatchObject({ created: false, log: { id: first.log.id, title: 'Latest upload' } });
    expect(retry).toMatchObject({ created: false, log: { id: first.log.id, title: 'Latest upload' } });
    expect(db.listWorkLogs(member.id)).toHaveLength(1);
    db.close();
  });

  it('stores a personal key encrypted and writes audit events for sensitive actions', () => {
    const db = createDatabase(':memory:');
    const user = db.findOrCreateUser('member@feedmob.com', 'Member');
    const generated = createApiKey('Codex');

    const key = db.createApiKey(user.id, generated);

    expect(db.revealApiKey(user.id, key.id)).toBe(generated.secret);
    expect(db.listAuditEvents(user.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'API_KEY_CREATED' }), expect.objectContaining({ type: 'API_KEY_REVEALED' })]),
    );
    db.close();
  });

  it('attributes uploads from every API key to that key owner across multiple users', () => {
    const db = createDatabase(':memory:');
    const owners = [
      db.findOrCreateUser('qa@feedmob.com', 'QA'),
      db.findOrCreateUser('product@feedmob.com', 'Product'),
      db.findOrCreateUser('engineering@feedmob.com', 'Engineering'),
    ];

    for (const owner of owners) {
      for (const label of ['agent', 'automation']) {
        const key = db.createApiKey(owner.id, createApiKey(`${owner.name} ${label}`));
        const authenticatedOwner = db.authenticateApiKey(db.revealApiKey(owner.id, key.id));
        const log = db.createWorkLog(authenticatedOwner!.id, { title: `${owner.name} upload`, completed: ['Done'] });

        expect(authenticatedOwner).toMatchObject({ id: owner.id, name: owner.name });
        expect(log.authorId).toBe(owner.id);
      }
    }
    db.close();
  });

  it('rejects disabled and revoked keys during API authentication', () => {
    const db = createDatabase(':memory:');
    const user = db.findOrCreateUser('member@feedmob.com', 'Member');
    const generated = createApiKey('Automation');
    const key = db.createApiKey(user.id, generated);

    expect(db.authenticateApiKey(generated.secret)).toEqual(expect.objectContaining({ id: user.id }));
    db.setApiKeyStatus(user.id, key.id, 'DISABLED');
    expect(db.authenticateApiKey(generated.secret)).toBeUndefined();
    db.setApiKeyStatus(user.id, key.id, 'REVOKED');
    expect(db.listAuditEvents(user.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'API_KEY_DISABLED' }),
      expect.objectContaining({ type: 'API_KEY_REVOKED' }),
    ]));
    db.close();
  });

  it('prevents removal of the final administrator', () => {
    const db = createDatabase(':memory:');
    const linden = db.findOrCreateUser('linden@feedmob.com', 'Linden');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');

    expect(() => db.setUserRole(linden.id, 'MEMBER')).toThrow('last administrator');
    db.setUserRole(member.id, 'ADMIN');
    expect(db.setUserRole(linden.id, 'MEMBER')).toEqual(expect.objectContaining({ role: 'MEMBER' }));
    db.close();
  });

  it('records the administrator as the actor of a role change', () => {
    const db = createDatabase(':memory:');
    const admin = db.findOrCreateUser('linden@feedmob.com', 'Linden');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');

    db.setUserRole(member.id, 'ADMIN', admin.id);

    expect(db.listAuditEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: admin.id, targetId: member.id, type: 'USER_ROLE_CHANGED' })]));
    db.close();
  });

  it('lets an administrator remove another member while protecting their own account and the final administrator', () => {
    const db = createDatabase(':memory:');
    const admin = db.findOrCreateUser('linden@feedmob.com', 'Linden');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');
    db.createWorkLog(member.id, { title: 'Member log', completed: ['Done'] });

    expect(() => db.deleteUser(member.id, admin.id)).not.toThrow();
    expect(db.listUsers()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: member.id })]));
    expect(db.listWorkLogs(member.id)).toEqual([]);
    expect(db.listAuditEvents(admin.id)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'USER_DELETED', targetId: member.id })]));
    expect(() => db.deleteUser(admin.id, admin.id)).toThrow('own account');
    db.close();
  });

  it('persists every structured daily-log section and lets only the owner update it', () => {
    const db = createDatabase(':memory:');
    const owner = db.findOrCreateUser('member@feedmob.com', 'Member');
    const other = db.findOrCreateUser('other@feedmob.com', 'Other');
    const log = db.createWorkLog(owner.id, {
      title: 'Daily trace', completed: ['Completed item'], inProgress: 'In progress item', blockers: 'Blocked item', nextPlan: 'Next plan item',
    });

    expect(db.getWorkLog(log.id)).toEqual(expect.objectContaining({ inProgress: 'In progress item', blockers: 'Blocked item', nextPlan: 'Next plan item' }));
    expect(() => db.updateWorkLog(log.id, other.id, 'MEMBER', { title: 'No access', completed: ['No access'], inProgress: '', blockers: '', nextPlan: '' })).toThrow('not allowed');
    expect(db.updateWorkLog(log.id, owner.id, 'MEMBER', { title: 'Updated trace', completed: ['Updated'], inProgress: '', blockers: '', nextPlan: '' })).toEqual(expect.objectContaining({ title: 'Updated trace' }));
    db.close();
  });

  it('associates image attachment metadata with a work log', () => {
    const db = createDatabase(':memory:');
    const owner = db.findOrCreateUser('member@feedmob.com', 'Member');
    const log = db.createWorkLog(owner.id, { title: 'Attached trace', completed: ['Done'] });

    db.addWorkLogAttachments(log.id, [{
      filename: 'progress.png', storageKey: 'work-log-images/progress.png', mimeType: 'image/png', size: 1024,
    }]);

    expect(db.listWorkLogAttachments(log.id)).toEqual([
      expect.objectContaining({ workLogId: log.id, filename: 'progress.png', mimeType: 'image/png', size: 1024 }),
    ]);
    db.close();
  });

  it('allows an administrator but not another member to delete a work log', () => {
    const db = createDatabase(':memory:');
    const owner = db.findOrCreateUser('member@feedmob.com', 'Member');
    const admin = db.findOrCreateUser('linden@feedmob.com', 'Linden');
    const log = db.createWorkLog(owner.id, { title: 'Delete me', completed: ['Done'], inProgress: '', blockers: '', nextPlan: '' });

    expect(() => db.deleteWorkLog(log.id, owner.id, 'MEMBER')).not.toThrow();
    const adminLog = db.createWorkLog(owner.id, { title: 'Admin delete', completed: ['Done'], inProgress: '', blockers: '', nextPlan: '' });
    expect(() => db.deleteWorkLog(adminLog.id, admin.id, 'ADMIN')).not.toThrow();
    expect(db.getWorkLog(adminLog.id)).toBeUndefined();
    db.close();
  });
});
