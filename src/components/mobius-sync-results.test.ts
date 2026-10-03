import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MobiusSyncResults } from './mobius-sync-results';
import type { MobiusSyncRun } from '../lib/mobius-sync-result';

vi.mock('./mobius-results-refresh', () => ({ MobiusResultsRefresh: () => null }));

describe('dashboard Issue matching results', () => {
  it('shows the issue, actual comment, submission source and rejected Done match', () => {
    const run: MobiusSyncRun = {
      id: 'run-1', workLogId: 'log-1', logTitle: '每日日志', reportDate: '2026-09-30', source: 'mcp', status: 'posted', createdAt: '2026-09-30T02:00:00.000Z', finishedAt: '2026-09-30T02:00:10.000Z',
      result: { status: 'posted', posted: 1, alreadyUpdated: 0, unmatched: 1, failed: 0, postedComments: [{ identifier: 'AI-100', body: '**完成事项**\n- 已优化编辑器' }], items: [
        { status: 'posted', identifier: 'AI-100', title: '编辑器', entries: [{ section: '完成事项', text: '已优化编辑器' }], commentBody: '**完成事项**\n- 已优化编辑器' },
        { status: 'skipped', identifier: 'AI-101', title: '旧任务', issueState: 'Done', entries: [{ section: '完成事项', text: '旧任务日志' }], reason: 'done' },
      ] },
    };
    const html = renderToStaticMarkup(createElement(MobiusSyncResults, { runs: [run], locale: 'zh' }));
    expect(html).toContain('Issue 匹配结果');
    expect(html).toContain('MCP');
    expect(html).toContain('https://mobius.feedmob.com/issue/AI-100');
    expect(html).toContain('实际评论内容');
    expect(html).toContain('<li>已优化编辑器</li>');
    expect(html).toContain('候选 Issue 已是 Done，此匹配未采用，也未改投其他 Issue。');
    expect(html).toContain('/console/logs/log-1');
    expect(html).toContain('10:00:00');
  });

  it('describes both web and MCP submission results before the first submission', () => {
    const html = renderToStaticMarkup(createElement(MobiusSyncResults, { runs: [], locale: 'zh' }));
    expect(html).toContain('手动提交与 MCP 提交都会显示');
    expect(html).toContain('/console/issue-matches');
  });
});
