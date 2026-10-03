import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from './db';
import { issueUpdatedToday, matchingTerms, selectMatchingIssue, workLogEntries, type MobiusIssue } from './mobius-work-log';

describe('Mobius work-log matching', () => {
  it('uses an explicit issue identifier and respects the stop flag', () => {
    const issue: MobiusIssue = { identifier: 'AI-1234', title: 'Unrelated title' };
    const entry = { section: '完成事项', text: '完成了 AI-1234 的日志编辑优化' };
    expect(selectMatchingIssue(entry, [issue])).toEqual(issue);
    expect(selectMatchingIssue(entry, [{ ...issue, agentStopRequested: true }])).toBeUndefined();
  });

  it('selects a unique strong title match and skips ambiguous matches', () => {
    const entry = { section: '完成事项', text: 'Binance Youappi VE/JP spend 手动录入' };
    const matching: MobiusIssue = { identifier: 'AS-1', title: 'Binance Youappi VE/JP spend 录入' };
    const unrelated: MobiusIssue = { identifier: 'AS-2', title: 'Binance MX budget 分析' };
    expect(selectMatchingIssue(entry, [unrelated, matching])).toEqual(matching);
    expect(selectMatchingIssue(entry, [matching, { ...matching, identifier: 'AS-3' }])).toBeUndefined();
  });

  it('does not trust only a generated background note as evidence of a match', () => {
    const entry = { section: '完成事项', text: 'Capital One Shopping Samsung TV 自动化录入' };
    const issue: MobiusIssue = {
      identifier: 'AI-1', title: '每日 spend 录入',
      description: '<!-- ai-context:start -->Capital One Shopping Samsung TV 自动化录入',
    };
    expect(selectMatchingIssue(entry, [issue])).toBeUndefined();
    expect(matchingTerms(entry.text)).toContain('samsung');
  });

  it('counts updates using the Shanghai calendar day, including comments', () => {
    const now = new Date('2026-09-30T02:00:00.000Z');
    expect(issueUpdatedToday({ identifier: 'AI-1', title: 'Example', updatedAt: '2026-09-29T16:05:00.000Z' }, now)).toBe(true);
    expect(issueUpdatedToday({ identifier: 'AI-1', title: 'Example', updatedAt: '2026-09-29T15:55:00.000Z' }, now)).toBe(false);
    expect(issueUpdatedToday({ identifier: 'AI-1', title: 'Example', updatedAt: '2026-09-29T15:00:00.000Z', comments: [{ at: '2026-09-30T01:00:00.000Z' }] }, now)).toBe(true);
  });

  it('extracts the submitted entry instead of the whole log', () => {
    const entries = workLogEntries({ completed: ['- 完成 Binance Youappi VE/JP spend 录入'], inProgress: '', blockers: '', nextPlan: '', markdownContent: '' });
    expect(entries).toEqual([{ section: '完成事项', text: '完成 Binance Youappi VE/JP spend 录入' }]);
  });
});

describe('Mobius comment claims', () => {
  const databases: ReturnType<typeof createDatabase>[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  it('allows only one claim per Issue and Shanghai day', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const user = database.findOrCreateUser('member@feedmob.com', 'Member');
    const log = database.createWorkLog(user.id, { title: 'Daily log', completed: ['Update issue'] });
    const first = database.claimMobiusComment('AI-1234', '2026-09-30', log.id);
    expect(first).toBeTruthy();
    expect(database.claimMobiusComment('AI-1234', '2026-09-30', log.id)).toBeNull();
    database.markMobiusCommentPosted(first!);
    expect(database.claimMobiusComment('AI-1234', '2026-09-30', log.id, new Date(Date.now() + 20 * 60_000))).toBeNull();
    expect(database.claimMobiusComment('AI-1234', '2026-10-01', log.id)).toBeTruthy();
  });

  it('releases a failed claim so a later submission can retry', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const user = database.findOrCreateUser('member@feedmob.com', 'Member');
    const log = database.createWorkLog(user.id, { title: 'Daily log', completed: ['Update issue'] });
    const claim = database.claimMobiusComment('AI-1234', '2026-09-30', log.id);
    expect(claim).toBeTruthy();
    database.releaseMobiusCommentClaim(claim!);
    expect(database.claimMobiusComment('AI-1234', '2026-09-30', log.id)).toBeTruthy();
  });
});
