import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobiusIssueMatcher } from './mobius-issue-matcher';
import type { MobiusIssue } from './mobius-work-log';

const entry = { section: '完成事项', text: '优化 WorkTrace Markdown 编辑' };
const active: MobiusIssue = { identifier: 'AI-100', title: 'WorkTrace Markdown 编辑', state: 'In Progress' };

beforeEach(() => {
  vi.stubEnv('MOBIUS_MATCHER', 'jev');
  vi.stubEnv('JEV_PROVIDER', 'openrouter');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('JEV_MODEL', 'typesafe/jev-1.13');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Participating candidate eligibility', () => {
  it('preserves safe provider failure details in each failed entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private provider body', { status: 429 })));
    const matcher = createMobiusIssueMatcher(async () => active as unknown as Record<string, unknown>, { list: async () => [active] });
    const entries = [entry, { ...entry, text: '修复 WorkTrace 匹配' }];
    await matcher.prepare(entries);
    for (const value of entries) {
      const match = await matcher(value);
      expect(match).toMatchObject({ reason: 'jev_unavailable', decision: { entry: value, method: 'jev', failure: { kind: 'http', httpStatus: 429, provider: 'openrouter' } } });
      expect(JSON.stringify(match)).not.toContain('private provider body');
    }
  });
  it('filters closed summaries before fetching details or applying the Jev limit', async () => {
    const closed = Array.from({ length: 260 }, (_, index) => ({ ...active, identifier: `AI-${9000 + index}`, state: 'Canceled' }));
    const call = vi.fn(async () => active as unknown as Record<string, unknown>);
    const fetcher = vi.fn(async () => Response.json({ id: 'test-request', model: 'typesafe/jev-1.13', answers: {
      entry_0: { type: 'choice', choice: active.identifier, confidence: 0.9, probabilities: { [active.identifier]: 0.95, NONE: 0.05 } },
    } }));
    vi.stubGlobal('fetch', fetcher);
    const matcher = createMobiusIssueMatcher(call, { list: async () => [...closed, active] });
    const match = await matcher(entry);
    expect(match.issue?.identifier).toBe(active.identifier);
    expect(match.decision?.candidateCount).toBe(1);
    expect(call.mock.calls).toEqual([['get_issue', { identifier: active.identifier }]]);
  });

  it('removes a candidate canceled between listing and detail loading', async () => {
    const call = vi.fn(async () => ({ ...active, state: 'Canceled' }));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const matcher = createMobiusIssueMatcher(call, { list: async () => [active] });
    expect(await matcher(entry)).toMatchObject({ reason: 'no_match', decision: { candidateCount: 0 } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('also excludes canceled candidates from keyword matching', async () => {
    vi.stubEnv('MOBIUS_MATCHER', 'rules');
    const canceled = { ...active, identifier: 'AI-101', state: 'Canceled' };
    const call = vi.fn(async () => active as unknown as Record<string, unknown>);
    const matcher = createMobiusIssueMatcher(call, { list: async () => [active, canceled] });
    expect((await matcher(entry)).issue?.identifier).toBe(active.identifier);
    expect(call.mock.calls).toEqual([['get_issue', { identifier: active.identifier }]]);
  });
});
