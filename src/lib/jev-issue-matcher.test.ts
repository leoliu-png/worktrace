import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JevMatchingError, matchEntriesWithJev } from './jev-issue-matcher';
import type { MobiusIssue } from './mobius-work-log';

const issues: MobiusIssue[] = [
  { identifier: 'AI-2660', title: 'RSI 自进化项目运行检查', state: 'In Progress' },
  { identifier: 'AI-2551', title: '写一个提交工作日志的系统', state: 'In Progress', comments: [{ body: '项目已上线 https://worktrace.example.test/' }, { body: '错误项目关系 <!-- worktrace-log:previous -->' }] },
  { identifier: 'AI-2593', title: '远程服务器测试模型', state: 'In Progress', comments: [{ body: '已实现长期运行的内部信息智能平台' }] },
  { identifier: 'AI-2707', title: '使用 Jev 每日自动化数据录入', state: 'In Progress' },
];

function mockDecision(choice: string, probability: number, overrides: Record<string, unknown> = {}, candidates = issues) {
  const probabilities = Object.fromEntries([...candidates.map((issue) => [issue.identifier, issue.identifier === choice ? probability : 0]), ['NONE', choice === 'NONE' ? probability : 1 - probability]]);
  if (choice === 'NONE') probabilities['AI-2660'] = 1 - probability;
  const baseline = 1 / (candidates.length + 1);
  const confidence = (probability - baseline) / (1 - baseline);
  return vi.fn(async () => Response.json({ id: 'jev-request', model: 'typesafe/jev-1.13-20260917', answers: {
    entry_0: { type: 'choice', choice, probabilities, confidence, ...overrides },
  } }));
}

beforeEach(() => {
  vi.stubEnv('JEV_PROVIDER', 'openrouter');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('JEV_MODEL', 'typesafe/jev-1.13');
  vi.stubEnv('JEV_MIN_PROBABILITY', '0.75');
  vi.stubEnv('JEV_MIN_CONFIDENCE', '0.70');
  vi.stubEnv('JEV_MIN_MARGIN', '0.20');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Jev matching decisions', () => {
  it('calls TypeSafe directly with its own key and accepts responses without request ids', async () => {
    vi.stubEnv('JEV_PROVIDER', 'typesafe');
    vi.stubEnv('TYPESAFE_API_KEY', 'typesafe-test-key');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.stubEnv('JEV_MODEL', '');
    const response = await mockDecision('AI-2551', 0.95)();
    const data = await response.json();
    delete data.id;
    data.model = 'jev-1.13.0';
    const fetcher = vi.fn(async () => Response.json(data));
    vi.stubGlobal('fetch', fetcher);
    const [match] = await matchEntriesWithJev([{ section: '完成事项', text: '优化 WorkTrace 日志系统' }], issues);
    expect(match.issue?.identifier).toBe('AI-2551');
    expect(match.decision?.model).toBe('jev-1.13.0');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer typesafe-test-key' });
    const request = JSON.parse(init.body as string);
    expect(request.model).toBe('jev-1.13.0');
    expect(request).not.toHaveProperty('provider');
  });

  it('does not send a TypeSafe key to OpenRouter or an unsupported provider', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'typesafe-test-key');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const entries = [{ section: '完成事项', text: '优化 WorkTrace 日志系统' }];
    await expect(matchEntriesWithJev(entries, issues)).rejects.toEqual(new JevMatchingError('jev_not_configured'));
    vi.stubEnv('JEV_PROVIDER', 'unsupported');
    await expect(matchEntriesWithJev(entries, issues)).rejects.toEqual(new JevMatchingError('jev_invalid_configuration'));
    expect(fetcher).not.toHaveBeenCalled();
  });

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

  it('sends only allowed states to Jev, excluding canceled, done and unknown states', async () => {
    const eligible = issues.slice(0, 3).map((issue, index) => ({ ...issue, state: ['To Do', 'In Progress', 'In Review'][index] }));
    const excluded = ['Canceled', 'Cancelled', 'Done', 'Completed', 'Duplicate', 'Backlog', 'Blocked', null].map((state, index) => ({ identifier: `AI-${9000 + index}`, title: 'WorkTrace 匹配项目', state }));
    const fetcher = mockDecision('AI-2551', 0.95, {}, eligible);
    vi.stubGlobal('fetch', fetcher);
    const [match] = await matchEntriesWithJev([{ section: '完成事项', text: '优化 WorkTrace 的 Issue 匹配' }], [...eligible, ...excluded]);
    expect(match.issue?.identifier).toBe('AI-2551');
    expect(match.decision?.candidateCount).toBe(3);
    const request = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(request.questions.entry_0.criteria).sort()).toEqual([...eligible.map((issue) => issue.identifier), 'NONE'].sort());
    expect(Object.keys(request.state.candidate_issues).sort()).toEqual(eligible.map((issue) => issue.identifier).sort());
  });

  it('skips the API when every participating issue is excluded', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const [match] = await matchEntriesWithJev([{ section: '完成事项', text: '优化 WorkTrace 的 Issue 匹配' }], issues.map((issue) => ({ ...issue, state: 'Canceled' })));
    expect(match).toMatchObject({ reason: 'no_match', decision: { candidateCount: 0 } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not count excluded states towards the candidate limit', async () => {
    const excluded = Array.from({ length: 260 }, (_, index) => ({ identifier: `AI-${9000 + index}`, title: 'Closed project', state: 'Canceled' }));
    vi.stubGlobal('fetch', mockDecision('AI-2551', 0.95));
    const [match] = await matchEntriesWithJev([{ section: '完成事项', text: '优化 WorkTrace 的 Issue 匹配' }], [...issues, ...excluded]);
    expect(match.issue?.identifier).toBe('AI-2551');
    expect(match.decision?.candidateCount).toBe(issues.length);
  });

  it('passes human project evidence and excludes previous automatic comments', async () => {
    const fetcher = mockDecision('AI-2551', 0.95);
    vi.stubGlobal('fetch', fetcher);
    await matchEntriesWithJev([{ section: '完成事项', text: 'WorkTrace 添加 Jev 匹配功能' }], issues);
    const request = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(request.state.candidate_issues['AI-2551'].human_comments).toContain('https://worktrace.example.test/');
    expect(JSON.stringify(request)).not.toContain('错误项目关系');
  });

  it('preserves Unicode through excerpt chunking and truncation', async () => {
    const candidates = issues.map((issue, index) => ({ ...issue,
      description: index === 0 ? 'a'.repeat(239) + '🚀项目进度' : 'a'.repeat(995) + '🚀项目进度',
      comments: [{ body: index === 0 ? 'b'.repeat(239) + '🧑‍💻工作进度' : 'c'.repeat(995) + '🎯工作进度' }],
    }));
    const fetcher = mockDecision('AI-2551', 0.95, {}, candidates);
    vi.stubGlobal('fetch', fetcher);
    await matchEntriesWithJev([{ section: '完成事项', text: '优化 WorkTrace' }], candidates);
    const request = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    // Check decoded strings: JSON serialization itself permits lone surrogates.
    const invalidSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const issue of Object.values(request.state.candidate_issues) as Array<{ description: string; human_comments: string }>) {
      expect(issue.description).not.toMatch(invalidSurrogate);
      expect(issue.human_comments).not.toMatch(invalidSurrogate);
      expect(issue.description).toContain('🚀');
    }
    expect(request.state.candidate_issues['AI-2660'].human_comments).toContain('🧑');
    expect(request.state.candidate_issues['AI-2660'].human_comments).toContain('💻');
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
    await expect(matchEntriesWithJev([{ section: '完成事项', text: '检查 RSI 运行异常' }], issues)).rejects.toMatchObject({ reason: 'jev_invalid_response', details: { kind: 'invalid_response', httpStatus: 200 } });
  });

  it.each([400, 401, 403, 429, 503])('keeps HTTP %i without copying the provider body', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private provider body test-key', { status })));
    const error = await matchEntriesWithJev([{ section: '完成事项', text: '检查 RSI' }], issues).catch((error) => error);
    expect(error).toBeInstanceOf(JevMatchingError);
    expect(error).toMatchObject({ reason: [401, 403].includes(status) ? 'jev_not_configured' : 'jev_unavailable', details: { provider: 'openrouter', kind: 'http', httpStatus: status, elapsedMs: expect.any(Number) } });
    expect(JSON.stringify(error)).not.toMatch(/private provider body|test-key/);
  });

  it('distinguishes connection failures from timeouts without storing exception text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('private request test-key'); }));
    const entries = [{ section: '完成事项', text: '检查 RSI' }];
    const error = await matchEntriesWithJev(entries, issues).catch((error) => error);
    expect(error).toMatchObject({ reason: 'jev_unavailable', details: { kind: 'network' } });
    expect(JSON.stringify(error)).not.toMatch(/private request|test-key/);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('Timeout', 'TimeoutError')));
    await expect(matchEntriesWithJev(entries, issues)).rejects.toMatchObject({ reason: 'jev_unavailable', details: { kind: 'timeout' } });
  });

  it('classifies malformed JSON as an invalid response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid json')));
    await expect(matchEntriesWithJev([{ section: '完成事项', text: '检查 RSI' }], issues)).rejects.toMatchObject({ reason: 'jev_invalid_response', details: { kind: 'invalid_response', httpStatus: 200 } });
  });
});
