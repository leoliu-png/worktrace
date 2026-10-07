import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from './db';
import type { MobiusIssue } from './mobius-work-log';
import { syncMobiusForWorkLog } from './mobius-sync';

const mcp = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), callTool: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  connect = mcp.connect;
  close = mcp.close;
  callTool = mcp.callTool;
} }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class {} }));

const now = new Date('2026-09-30T02:00:00.000Z');
const response = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const issues = new Map<string, MobiusIssue>();
const participating = new Set<string>();
const databases: ReturnType<typeof createDatabase>[] = [];
const directories: string[] = [];
const issue: MobiusIssue = { identifier: 'AI-100', title: 'WorkTrace Markdown 编辑', state: 'In Progress', assignee: 'Member', updatedAt: '2026-09-28T02:00:00.000Z' };

function setup(text = '完成 AI-100 的 WorkTrace Markdown 编辑优化', filename = ':memory:') {
  const database = createDatabase(filename);
  databases.push(database);
  const user = database.findOrCreateUser('member@feedmob.com', 'Member');
  const log = database.createWorkLog(user.id, { reportDate: '2026-09-30', title: 'Daily log', completed: [text] });
  return { database, user, log };
}

beforeEach(() => {
  vi.stubEnv('MOBIUS_PAT', 'test-token');
  vi.stubEnv('MOBIUS_SYNC_AUTHOR_EMAILS', 'member@feedmob.com');
  vi.stubEnv('MOBIUS_MATCHER', 'rules');
  issues.clear();
  issues.set(issue.identifier, { ...issue });
  participating.clear();
  participating.add(issue.identifier);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname !== '/api/issues') throw new Error('Unexpected Mobius scope URL.');
    const subscriber = url.searchParams.get('subscriberId');
    if (subscriber === '__worktrace_no_such_subscriber__') return Response.json([]);
    if (subscriber !== 'member-id') throw new Error('Unexpected Mobius subscriber.');
    return Response.json([...issues.values()].filter((item) => participating.has(item.identifier)).map((item) => ({ ...item, archived: false })));
  }));
  mcp.connect.mockReset().mockResolvedValue(undefined);
  mcp.close.mockReset().mockResolvedValue(undefined);
  mcp.callTool.mockReset().mockImplementation(async ({ name, arguments: args }) => {
    if (name === 'whoami') return response({ id: 'member-id', email: 'member@feedmob.com', name: 'Member', capabilities: { comment: true } });
    if (name === 'get_issue') return response(issues.get(args.identifier) ?? {});
    if (name === 'list_issues') return response({ issues: [...issues.values()] });
    if (name === 'add_comment') return response({ success: true });
    throw new Error(`Unexpected tool: ${name}`);
  });
});

afterEach(() => {
  for (const database of databases.splice(0)) { try { database.close(); } catch {} }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('persisted Mobius submission results', () => {
  it('persists the actual MCP comment across database reopening and isolates user histories', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'worktrace-mobius-'));
    directories.push(directory);
    const filename = join(directory, 'logs.db');
    const { database, user, log } = setup(undefined, filename);
    const result = await syncMobiusForWorkLog(log, user, now, { source: 'mcp', database });
    const comment = mcp.callTool.mock.calls.find(([call]) => call.name === 'add_comment')?.[0].arguments;
    expect(result).toMatchObject({ status: 'posted', posted: 1, postedComments: [{ identifier: 'AI-100', body: comment.body }] });
    database.close();
    const reopened = createDatabase(filename);
    databases.push(reopened);
    expect(reopened.listMobiusSyncRuns(user.id).items).toEqual([expect.objectContaining({ source: 'mcp', status: 'posted', workLogId: log.id, result: expect.objectContaining({ items: [expect.objectContaining({ identifier: 'AI-100', commentBody: comment.body, status: 'posted' })] }) })]);
    const other = reopened.findOrCreateUser('other@feedmob.com', 'Other');
    expect(reopened.listMobiusSyncRuns(other.id).items).toEqual([]);
    reopened.deleteWorkLog(log.id, user.id, user.role);
    expect(reopened.listMobiusSyncRuns(user.id).items).toEqual([]);
  });

  it('records an unconfigured web submission without connecting to Mobius', async () => {
    vi.stubEnv('MOBIUS_PAT', '');
    const { database, user, log } = setup();
    const result = await syncMobiusForWorkLog(log, user, now, { source: 'web', database });
    expect(result).toMatchObject({ status: 'disabled', reason: 'not_configured', posted: 0 });
    expect(database.listMobiusSyncRuns(user.id).items[0]).toMatchObject({ source: 'web', result: { reason: 'not_configured' } });
    expect(mcp.connect).not.toHaveBeenCalled();
  });

  it('records plans as excluded without reading or commenting on their explicit issue IDs', async () => {
    const { database, user, log } = setup();
    const result = await syncMobiusForWorkLog({ ...log, nextPlan: '- AI-101 检查未来的平台任务' }, user, now, { source: 'mcp', database });
    expect(result.items).toContainEqual(expect.objectContaining({ status: 'skipped', reason: 'planned_work', entries: [{ section: '明日计划', text: 'AI-101 检查未来的平台任务' }] }));
    expect(result.unmatched).toBe(0);
    const calls = mcp.callTool.mock.calls.map(([call]) => call);
    expect(calls.some((call) => call.arguments?.identifier === 'AI-101')).toBe(false);
    expect(result.postedComments[0].body).not.toContain('AI-101');
  });

  it('does not connect to Mobius for a Markdown log containing only Todos', async () => {
    const { database, user, log } = setup();
    const result = await syncMobiusForWorkLog({ ...log, completed: [], inProgress: '', blockers: '', nextPlan: '', markdownContent: '## Todos\n- AI-100 检查平台运行情况' }, user, now, { database });
    expect(result).toMatchObject({ status: 'skipped', reason: 'planned_work', posted: 0, unmatched: 0 });
    expect(mcp.connect).not.toHaveBeenCalled();
  });

  it('records Done as rejected and does not fall back to an active issue', async () => {
    issues.set(issue.identifier, { ...issue, state: 'Done' });
    issues.set('AI-101', { ...issue, identifier: 'AI-101', title: 'WorkTrace Markdown' });
    participating.add('AI-101');
    const { database, user, log } = setup('完成 WorkTrace Markdown 编辑优化');
    const result = await syncMobiusForWorkLog(log, user, now, { database });
    expect(result.items).toContainEqual(expect.objectContaining({ identifier: 'AI-100', status: 'skipped', reason: 'done' }));
    expect(mcp.callTool.mock.calls.some(([call]) => call.name === 'add_comment')).toBe(false);
    expect(database.listMobiusSyncRuns(user.id).items[0].result?.posted).toBe(0);
  });

  it('blocks an issue outside Participating, while allowing a subscribed issue assigned to someone else', async () => {
    issues.set(issue.identifier, { ...issue, assignee: 'Other' });
    participating.delete(issue.identifier);
    const { database, user, log } = setup();
    const rejected = await syncMobiusForWorkLog(log, user, now, { database });
    expect(rejected.items[0]).toMatchObject({ reason: 'not_related', status: 'unmatched' });
    expect(rejected.posted).toBe(0);
    participating.add(issue.identifier);
    const accepted = await syncMobiusForWorkLog(log, user, now, { database });
    expect(accepted.posted).toBe(1);
  });

  it('rechecks Done immediately before posting and records the skipped result', async () => {
    const original = mcp.callTool.getMockImplementation()!;
    let reads = 0;
    mcp.callTool.mockImplementation(async (call) => call.name === 'get_issue' && ++reads >= 3 ? response({ ...issue, state: 'Done' }) : original(call));
    const { database, user, log } = setup();
    const result = await syncMobiusForWorkLog(log, user, now, { database });
    expect(result).toMatchObject({ posted: 0, unmatched: 1, items: [expect.objectContaining({ reason: 'done' })] });
    expect(mcp.callTool.mock.calls.some(([call]) => call.name === 'add_comment')).toBe(false);
  });

  it('distinguishes today’s update from a failed connection in persisted results', async () => {
    issues.set(issue.identifier, { ...issue, comments: [{ at: now.toISOString() }] });
    const { database, user, log } = setup();
    const updated = await syncMobiusForWorkLog(log, user, now, { source: 'api', database });
    expect(updated).toMatchObject({ posted: 0, alreadyUpdated: 1, items: [expect.objectContaining({ reason: 'updated_today' })] });
    mcp.connect.mockRejectedValueOnce(new Error('Connection unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await syncMobiusForWorkLog(log, user, now, { database });
    expect(failed).toMatchObject({ status: 'error', reason: 'connection_failed', posted: 0 });
    expect(database.listMobiusSyncRuns(user.id).items.some((run) => run.result?.reason === 'connection_failed')).toBe(true);
  });

  it('does not label a rejected comment as posted, and paginates repeated submissions', async () => {
    const original = mcp.callTool.getMockImplementation()!;
    mcp.callTool.mockImplementation(async (call) => call.name === 'add_comment' ? { isError: true, content: [] } : original(call));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { database, user, log } = setup();
    const failed = await syncMobiusForWorkLog(log, user, now, { database });
    expect(failed).toMatchObject({ posted: 0, postedComments: [], items: [expect.objectContaining({ status: 'error', reason: 'comment_failed' })] });
    expect(failed.items[0].commentBody).toBeUndefined();
    await syncMobiusForWorkLog(log, user, now, { database });
    const first = database.listMobiusSyncRuns(user.id, { limit: 1 });
    const second = database.listMobiusSyncRuns(user.id, { limit: 1, cursor: first.nextCursor! });
    expect(first.nextCursor).toBeTruthy();
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.nextCursor).toBeNull();
  });
});
