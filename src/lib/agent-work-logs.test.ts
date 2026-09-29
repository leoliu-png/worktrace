import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from './db';
import { dailySubmissionStatus, shanghaiDate, validateAgentWorkLog } from './agent-work-logs';

const databases: ReturnType<typeof createDatabase>[] = [];
function database() { const db = createDatabase(':memory:'); databases.push(db); return db; }
afterEach(() => { vi.useRealTimers(); databases.splice(0).forEach((db) => db.close()); });

describe('agent work-log service', () => {
  it('requires a title and at least one completed item', () => {
    expect(validateAgentWorkLog({ title: '  ', completed: [] }).success).toBe(false);
    expect(validateAgentWorkLog({ title: 'Release', completed: [' shipped '] }).data).toEqual(expect.objectContaining({ title: 'Release', completed: ['shipped'] }));
  });

  it('normalizes structured and legacy optional sections into Markdown list entries', () => {
    const result = validateAgentWorkLog({
      title: 'Release',
      completed: ['Shipped'],
      inProgress: ['Run regression tests', 'Collect feedback'],
      blockers: 'Waiting for access；Confirm the rollout window',
      nextPlan: '- Publish notes\n- Notify the team',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      inProgress: '- Run regression tests\n- Collect feedback',
      blockers: '- Waiting for access\n- Confirm the rollout window',
      nextPlan: '- Publish notes\n- Notify the team',
    });
  });

  it('defaults, accepts, and validates report dates against the Shanghai calendar', () => {
    const now = new Date('2026-09-16T12:00:00+08:00');
    const defaulted = validateAgentWorkLog({ title: 'Today', completed: ['Done'] }, now);
    const historical = validateAgentWorkLog({ reportDate: '2026-09-14', title: 'Catch-up', completed: ['Done'] }, now);
    const future = validateAgentWorkLog({ reportDate: '2026-09-17', title: 'Future', completed: ['Done'] }, now);

    expect(defaulted.data).toMatchObject({ reportDate: '2026-09-16' });
    expect(historical.data).toMatchObject({ reportDate: '2026-09-14' });
    expect(future.success).toBe(false);
  });

  it('reports each member submission state using the Shanghai calendar date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00+08:00'));
    const db = database();
    const submitted = db.findOrCreateUser('submitted@feedmob.com', 'Submitted');
    const missing = db.findOrCreateUser('missing@feedmob.com', 'Missing');
    db.createWorkLog(submitted.id, { title: 'Daily', completed: ['Done'] });
    const result = dailySubmissionStatus(db, '2026-09-03', new Date('2026-09-03T12:00:00+08:00'));
    expect(result.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: submitted.id, submitted: true, count: 1 }),
      expect.objectContaining({ id: missing.id, submitted: false, count: 0 }),
    ]));
    expect(result.timezone).toBe('Asia/Shanghai');
  });

  it('counts a catch-up log on its report date instead of its later submission timestamp', () => {
    const db = database();
    const submitted = db.findOrCreateUser('submitted@feedmob.com', 'Submitted');
    db.upsertDailyWorkLog(submitted.id, { reportDate: '2026-09-14', title: 'Catch-up', completed: ['Done'] }, new Date('2026-09-16T12:00:00+08:00'));

    const result = dailySubmissionStatus(db, '2026-09-14', new Date('2026-09-16T12:00:00+08:00'));

    expect(result.members).toContainEqual(expect.objectContaining({ id: submitted.id, submitted: true, count: 1 }));
  });

  it('uses the Shanghai calendar at the UTC day boundary', () => {
    expect(shanghaiDate(new Date('2026-09-02T16:30:00.000Z'))).toBe('2026-09-03');
  });
});
