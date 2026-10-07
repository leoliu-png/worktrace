import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JevMatchingError, matchEntriesWithJev } from './jev-issue-matcher';
import type { MobiusIssue } from './mobius-work-log';

const issues: MobiusIssue[] = [
  { identifier: 'AI-2660', title: 'RSI 自进化项目运行检查', state: 'In Progress' },
  { identifier: 'AI-2551', title: '写一个提交工作日志的系统', state: 'In Progress', comments: [{ body: '项目已上线 https://worktrace.example.test/' }, { body: '错误项目关系 <!-- worktrace-log:previous -->' }] },
  { identifier: 'AI-2593', title: '远程服务器测试模型', state: 'In Progress', comments: [{ body: '已实现长期运行的内部信息智能平台' }] },
  { identifier: 'AI-2707', title: '使用 Jev 每日自动化数据录入', state: 'In Progress' },
];

function mockDecision(choice: string, probability: number, overrides: Record<string, unknown> = {}) {
  const probabilities = Object.fromEntries([...issues.map((issue) => [issue.identifier, issue.identifier === choice ? probability : 0]), ['NONE', choice === 'NONE' ? probability : 1 - probability]]);
  if (choice === 'NONE') probabilities['AI-2660'] = 1 - probability;
  const confidence = (probability - 1 / 5) / (1 - 1 / 5);
  return vi.fn(async () => Response.json({ id: 'jev-request', model: 'typesafe/jev-1.13-20260917', answers: {
    entry_0: { type: 'choice', choice, probabilities, confidence, ...overrides },
  } }));
}

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('JEV_MODEL', 'typesafe/jev-1.13');
  vi.stubEnv('JEV_MIN_PROBABILITY', '0.75');
  vi.stubEnv('JEV_MIN_CONFIDENCE', '0.70');
  vi.stubEnv('JEV_MIN_MARGIN', '0.20');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Jev matching decisions', () => {
  it('accepts the reported RSI 85% decision when confidence and lead also pass', async () => {
    vi.stubGlobal('fetch', mockDecision('AI-2660', 0.85));
    const [match] = await matchEntriesWithJev([{ section: '完成事项', text: '检查 RSI，近期运行都失败了' }], issues);
    expect(match.issue?.identifier).toBe('AI-2660');
    expect(match.reason).toBeUndefined();
    expect(match.decision?.thresholds?.probability).toBe(0.75);
  });

  it('still rejects a decision below 75% and keeps NONE as a rejection', async () => {
    vi.stubGlobal('fetch', mockDecision('AI-2660', 0.74));
    expect((await matchEntriesWithJev([{ section: '完成事项', text: '检查 RSI 运行异常' }], issues))[0].reason).toBe('low_confidence');
    vi.stubGlobal('fetch', mockDecision('NONE', 0.9));
    expect((await matchEntriesWithJev([{ section: '完成事项', text: '完全不相关的工作内容' }], issues))[0].reason).toBe('no_match');
  });

  it('blocks a Done winner without redirecting it to an active issue', async () => {
    vi.stubGlobal('fetch', mockDecision('AI-2551', 0.95));
    const candidates = issues.map((issue) => issue.identifier === 'AI-2551' ? { ...issue, state: 'Done' } : issue);
    const [match] = await matchEntriesWithJev([{ section: '完成事项', text: '优化 WorkTrace 的 Issue 匹配' }], candidates);
    expect(match).toMatchObject({ reason: 'done', issue: { identifier: 'AI-2551' } });
  });

  it('passes human project evidence and excludes previous automatic comments', async () => {
    const fetcher = mockDecision('AI-2551', 0.95);
    vi.stubGlobal('fetch', fetcher);
    await matchEntriesWithJev([{ section: '完成事项', text: 'WorkTrace 添加 Jev 匹配功能' }], issues);
    const request = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(request.state.candidate_issues['AI-2551'].human_comments).toContain('https://worktrace.example.test/');
    expect(JSON.stringify(request)).not.toContain('错误项目关系');
  });

  it('does not call Jev for future plans, including plans with an issue identifier', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const matches = await matchEntriesWithJev([{ section: 'Todos', text: 'AI-2593 明日检查平台' }], issues);
    expect(matches).toEqual([{ reason: 'planned_work' }]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects invented identifiers instead of allowing an external issue into the candidate scope', async () => {
    vi.stubGlobal('fetch', mockDecision('AI-2660', 0.9, { choice: 'AI-9999' }));
    await expect(matchEntriesWithJev([{ section: '完成事项', text: '检查 RSI 运行异常' }], issues)).rejects.toEqual(new JevMatchingError('jev_invalid_response'));
  });
});
