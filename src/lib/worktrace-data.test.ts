import { describe, expect, it } from 'vitest';
import { createDatabase } from './db';
import * as workTraceData from './worktrace-data';
import { filterLogs, filterLogsByPeriod, filterLogsByQuery, loadConsoleData, type WorkTraceLog } from './worktrace-data';

describe('console data', () => {
  it('uses persisted work logs for overview, all logs, and personal logs', () => {
    const db = createDatabase(':memory:');
    const linden = db.findOrCreateUser('linden@feedmob.com', 'Linden');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');
    db.createWorkLog(linden.id, { title: 'OAuth 接入完成', completed: ['完成登录测试'] });
    db.createWorkLog(member.id, { title: 'API 文档整理', completed: ['发布接口说明'] });

    const data = loadConsoleData(db, linden.id);

    expect(data.overview.totalLogs).toBe(2);
    expect(data.logs.map((log) => log.title)).toEqual(expect.arrayContaining(['OAuth 接入完成', 'API 文档整理']));
    expect(data.myLogs).toEqual([expect.objectContaining({ title: 'OAuth 接入完成', authorEmail: 'linden@feedmob.com' })]);
    db.close();
  });
});

describe('overview period filter', () => {
  it('keeps only logs in the selected today, week, or month period', () => {
    const logs: WorkTraceLog[] = [
      { id: 'today', title: 'Today', completed: [], inProgress: '', blockers: '', nextPlan: '', createdAt: '2026-10-06T09:00:00.000Z', authorId: 'u1', authorName: 'One', authorEmail: 'one@feedmob.com' },
      { id: 'week', title: 'Week', completed: [], inProgress: '', blockers: '', nextPlan: '', createdAt: '2026-10-05T09:00:00.000Z', authorId: 'u1', authorName: 'One', authorEmail: 'one@feedmob.com' },
      { id: 'month', title: 'Month', completed: [], inProgress: '', blockers: '', nextPlan: '', createdAt: '2026-10-01T01:00:00.000Z', authorId: 'u1', authorName: 'One', authorEmail: 'one@feedmob.com' },
    ];
    const now = new Date('2026-10-06T12:00:00.000Z');

    expect(filterLogsByPeriod(logs, 'today', now).map((log) => log.id)).toEqual(['today']);
    expect(filterLogsByPeriod(logs, 'week', now).map((log) => log.id)).toEqual(['today', 'week']);
    expect(filterLogsByPeriod(logs, 'month', now).map((log) => log.id)).toEqual(['today', 'week', 'month']);
  });

  it('filters by the report date rather than the later submission timestamp', () => {
    const catchUp: WorkTraceLog = {
      id: 'catch-up',
      reportDate: '2026-09-14',
      title: 'Catch-up',
      completed: ['Done'],
      inProgress: '',
      blockers: '',
      nextPlan: '',
      createdAt: '2026-09-16T02:00:00.000Z',
      authorId: 'u1',
      authorName: 'One',
      authorEmail: 'one@feedmob.com',
    };

    expect(filterLogsByPeriod([catchUp], 'today', new Date('2026-09-14T12:00:00+08:00'))).toEqual([catchUp]);
    expect(filterLogsByPeriod([catchUp], 'today', new Date('2026-09-16T12:00:00+08:00'))).toEqual([]);
  });
});

describe('overview activity data', () => {
  it('keeps all logs from the most recent two days and reports today submission status for every member', () => {
    const db = createDatabase(':memory:');
    const linden = db.findOrCreateUser('linden@feedmob.com', 'Linden');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');
    db.createWorkLog(linden.id, { title: 'Recent trace', completed: ['Done'] });

    const data = loadConsoleData(db, linden.id);

    expect(data.overview.recentLogs).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Recent trace' })]));
    expect(data.overview.memberSubmissionStatus).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: linden.id, submittedToday: true }),
      expect.objectContaining({ id: member.id, submittedToday: false }),
    ]));
    db.close();
  });
});

describe('log query filtering', () => {
  it('finds logs by title, every structured content field, and author identity', () => {
    const logs: WorkTraceLog[] = [
      {
        id: 'matching-log',
        title: 'Release checklist',
        completed: ['Published the deployment notes'],
        inProgress: 'Monitoring metrics',
        blockers: 'Waiting for a vendor reply',
        nextPlan: 'Prepare the weekly review',
        createdAt: '2026-09-03T10:00:00.000Z',
        authorId: 'member-1',
        authorName: 'Linden Zhao',
        authorEmail: 'linden@feedmob.com',
      },
      {
        id: 'other-log',
        title: 'Design review',
        completed: [],
        inProgress: '',
        blockers: '',
        nextPlan: '',
        createdAt: '2026-09-02T10:00:00.000Z',
        authorId: 'member-2',
        authorName: 'QA FeedMob',
        authorEmail: 'qa@feedmob.com',
      },
    ];

    expect(filterLogsByQuery(logs, 'vendor')).toEqual([logs[0]]);
    expect(filterLogsByQuery(logs, 'LINDEN@FEEDMOB.COM')).toEqual([logs[0]]);
    expect(filterLogsByQuery(logs, '  ')).toEqual(logs);
  });
});

describe('combined log filters', () => {
  it('applies both a selected member and a date range', () => {
    const logs: WorkTraceLog[] = [
      { id: 'today-linden', title: 'Today', completed: [], inProgress: '', blockers: '', nextPlan: '', createdAt: '2026-09-03T09:00:00.000Z', authorId: 'linden', authorName: 'Linden', authorEmail: 'linden@feedmob.com' },
      { id: 'yesterday-linden', title: 'Yesterday', completed: [], inProgress: '', blockers: '', nextPlan: '', createdAt: '2026-09-02T09:00:00.000Z', authorId: 'linden', authorName: 'Linden', authorEmail: 'linden@feedmob.com' },
      { id: 'today-qa', title: 'QA today', completed: [], inProgress: '', blockers: '', nextPlan: '', createdAt: '2026-09-03T08:00:00.000Z', authorId: 'qa', authorName: 'QA', authorEmail: 'qa@feedmob.com' },
    ];

    expect(filterLogs(logs, { memberId: 'linden', dateRange: 'today', now: new Date('2026-09-03T12:00:00.000Z') })).toEqual([logs[0]]);
  });
});

describe('work-log Markdown lists', () => {
  it('groups unordered and ordered Markdown list lines while preserving ordinary paragraphs', () => {
    const parse = (workTraceData as typeof workTraceData & { parseWorkLogMarkdown?: (value: string) => unknown }).parseWorkLogMarkdown;

    expect(parse).toBeTypeOf('function');
    expect(parse!('说明文字\n- 跟进 OAuth 回调\n* 修复日志展示\n\n1. 验证生产环境\n2. 通知团队')).toEqual([
      { type: 'paragraph', text: '说明文字' },
      { type: 'unordered-list', items: ['跟进 OAuth 回调', '修复日志展示'] },
      { type: 'ordered-list', items: ['验证生产环境', '通知团队'] },
    ]);
  });
});
