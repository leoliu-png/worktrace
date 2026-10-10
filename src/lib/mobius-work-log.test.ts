import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from './db';
import { issueUpdatedToday, matchingTerms, mobiusCommentBody, plannedWorkLogEntries, selectMatchingIssue, workLogEntries, type MobiusIssue } from './mobius-work-log';
import { parseMarkdownWorkLog } from './markdown-work-log';

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

  it('uses the original Markdown hierarchy even when legacy fields flattened the children', () => {
    const parent = 'AI-2593：长期运行的内部信息智能平台，继续优化';
    const details = ['修复风险复核反复失败', '清理了 9 条过期任务', '新增首页今日关键结论'];
    const markdownContent = `## Done\n3. ${parent}\n${details.map((text) => `   - ${text}`).join('\n')}\n4. 完成 WorkTrace 日志编辑优化`;
    const log = { completed: [parent, ...details, '完成 WorkTrace 日志编辑优化'], inProgress: '', blockers: '', nextPlan: '', markdownContent };
    const entries = workLogEntries(log);
    expect(entries).toEqual([
      { section: '完成事项', text: `${parent}\n${details.map((text) => `- ${text}`).join('\n')}` },
      { section: '完成事项', text: '完成 WorkTrace 日志编辑优化' },
    ]);
    const issue: MobiusIssue = { identifier: 'AI-2593', title: '内部信息智能平台', state: 'In Progress' };
    expect(selectMatchingIssue(entries[0], [issue])).toBe(issue);
    const body = mobiusCommentBody({ id: 'log', reportDate: '2026-10-08' }, [entries[0]], 'Leo');
    expect(body).toContain(`- ${parent}\n  - ${details[0]}\n  - ${details[1]}\n  - ${details[2]}`);
  });

  it('keeps each MCP completed-array item intact, including details beyond 600 characters', () => {
    const parent = 'AI-2593 平台继续优化';
    const details = Array.from({ length: 40 }, (_, index) => `- 第 ${index + 1} 项优化：修复引用匹配与中文错误信息，验证重试流程。`).join('\n');
    const text = `${parent}\n${details}\n- 最后一项：检查首页展示结果`;
    const entries = workLogEntries({ completed: [text, '每日 spend 数据验证完成'], inProgress: '', blockers: '', nextPlan: '', markdownContent: '' });
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe(text);
    expect(entries[0].text).toContain('最后一项：检查首页展示结果');
  });

  it('keeps progress details with their parent and ignores code examples inside that parent', () => {
    const log = parseMarkdownWorkLog([
      '## 进行中',
      '- AI-2593 平台持续优化',
      '  - 调整重试机制',
      '',
      '  ```text',
      '  AI-9999 示例编号，不能参与匹配',
      '  ```',
      '  - 修正首页展示',
      '- WorkTrace 日志编辑优化',
    ].join('\n'))!;
    const entries = workLogEntries(log);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ section: '进行中' });
    expect(entries[0].text).toContain('调整重试机制');
    expect(entries[0].text).toContain('修正首页展示');
    expect(entries[0].text).not.toContain('AI-9999');
  });

  it('excludes a planned parent and its entire nested list as one planned work item', () => {
    const log = parseMarkdownWorkLog('## Done\n- [ ] AI-2593 明日检查平台\n  - 检查首页显示\n  - 验证定时任务\n- [x] 完成 WorkTrace 编辑优化')!;
    expect(workLogEntries(log)).toEqual([{ section: '完成事项', text: '完成 WorkTrace 编辑优化' }]);
    expect(plannedWorkLogEntries(log)).toEqual([{ section: '明日计划', text: 'AI-2593 明日检查平台\n- 检查首页显示\n- 验证定时任务' }]);
  });

  it('excludes structured future plans from matching and keeps actual progress and blockers', () => {
    const log = { completed: ['RSI 运行检查发现失败'], inProgress: 'WorkTrace 使用 Jev 改进匹配', blockers: '平台定时任务异常待排查', nextPlan: '- AI-2593 明日检查平台', markdownContent: '' };
    expect(workLogEntries(log).map((entry) => entry.text)).toEqual(['RSI 运行检查发现失败', 'WorkTrace 使用 Jev 改进匹配', '平台定时任务异常待排查']);
    expect(plannedWorkLogEntries(log)).toEqual([{ section: '明日计划', text: 'AI-2593 明日检查平台' }]);
  });

  it('maps plain and formatted Todo headings to future plans before extracting actual work', () => {
    const log = parseMarkdownWorkLog('# 日志\n## Done\n1. 检查 RSI 运行异常\n\n**Todos:**\n1. AI-2593 明日检查平台\n\n## 进行中\n正在实现 WorkTrace 匹配')!;
    expect(log.nextPlan).toContain('AI-2593 明日检查平台');
    expect(log.completed).toEqual(['检查 RSI 运行异常']);
    expect(workLogEntries(log).map((entry) => entry.text)).toEqual(['检查 RSI 运行异常', '正在实现 WorkTrace 匹配']);
    expect(plannedWorkLogEntries(log).map((entry) => entry.text)).toEqual(['AI-2593 明日检查平台']);
  });

  it('excludes an entire nested Todo block from Markdown-only logs and resumes at a peer heading', () => {
    const log = { completed: [], inProgress: '', blockers: '', nextPlan: '', markdownContent: '# 日志\n## 待办\n### 内部平台\n- AI-2593 明日检查平台\n### 日志系统\n- 接入 Jev 新功能\n## Done\n检查 RSI 运行异常' };
    expect(workLogEntries(log)).toEqual([{ section: '完成事项', text: '检查 RSI 运行异常' }]);
    expect(plannedWorkLogEntries(log)).toHaveLength(2);
  });

  it('excludes unfinished checkboxes and labeled Todo items without hiding actual Todo-feature development', () => {
    const log = { completed: ['- [ ] AI-2593 检查平台', '- [x] 实现 Todo 编辑功能', '待办：明日检查 RSI 运行'], inProgress: '', blockers: '', nextPlan: '', markdownContent: '' };
    expect(workLogEntries(log)).toEqual([{ section: '完成事项', text: '实现 Todo 编辑功能' }]);
    expect(plannedWorkLogEntries(log)).toHaveLength(2);
    expect(selectMatchingIssue({ section: 'Todos', text: 'AI-2593 检查平台' }, [{ identifier: 'AI-2593', title: '内部平台' }])).toBeUndefined();
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
