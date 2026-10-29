import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createDatabase } from './db';
import { createWorkTraceMcpServer, workTraceMcpTools } from './worktrace-mcp';

describe('WorkTrace MCP tools', () => {
  it('exposes structured write, log retrieval, and Shanghai submission tools', () => {
    expect(Object.keys(workTraceMcpTools)).toEqual(expect.arrayContaining([
      'prepare_work_log', 'create_work_log', 'list_work_logs', 'get_work_log', 'get_daily_submission_status',
    ]));
    expect(workTraceMcpTools.create_work_log.required).toEqual(['title', 'completed']);
    expect(workTraceMcpTools.get_daily_submission_status.timezone).toBe('Asia/Shanghai');
  });

  it('updates an authenticated owner\'s work log through MCP and records the update', async () => {
    const db = createDatabase(':memory:');
    const owner = db.findOrCreateUser('member@feedmob.com', 'Member');
    const log = db.createWorkLog(owner.id, { title: 'Original title', completed: ['Original completion'] });
    const server = createWorkTraceMcpServer(db, owner);
    const client = new Client({ name: 'worktrace-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'update_work_log',
        arguments: {
          id: log.id,
          title: 'Updated title',
          completed: ['Updated completion'],
          blockers: ['Waiting for a response', 'Confirm the release window'],
        },
      },
    }, CallToolResultSchema);

    const content = result.content.find((item) => item.type === 'text');
    expect(JSON.parse(content?.text ?? '{}')).toMatchObject({ title: 'Updated title', blockers: '- Waiting for a response\n- Confirm the release window' });
    expect(db.getWorkLog(log.id)).toMatchObject({ title: 'Updated title', completed: ['Updated completion'] });
    expect(db.listMobiusSyncRuns(owner.id).items).toEqual([expect.objectContaining({ source: 'mcp', workLogId: log.id, result: expect.objectContaining({ posted: 0 }) })]);
    expect(db.listAuditEvents(owner.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'WORK_LOG_UPDATED', targetId: log.id }),
    ]));

    await client.close();
    await server.close();
    db.close();
  });

  it('replaces the authenticated user\'s existing log when create_work_log is called again today', async () => {
    const db = createDatabase(':memory:');
    const owner = db.findOrCreateUser('member@feedmob.com', 'Member');
    const server = createWorkTraceMcpServer(db, owner);
    const client = new Client({ name: 'worktrace-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.request({ method: 'tools/call', params: { name: 'create_work_log', arguments: { title: 'First', completed: ['Collected notes'] } } }, CallToolResultSchema);
    const replacement = await client.request({ method: 'tools/call', params: { name: 'create_work_log', arguments: { title: 'Latest', completed: ['Collected notes', 'Submitted report'] } } }, CallToolResultSchema);

    const content = replacement.content.find((item) => item.type === 'text');
    expect(JSON.parse(content?.text ?? '{}')).toMatchObject({ created: false, log: { title: 'Latest', completed: ['Collected notes', 'Submitted report'] } });
    expect(db.listWorkLogs(owner.id)).toHaveLength(1);

    await client.close();
    await server.close();
    db.close();
  });

  it('creates a catch-up log for an explicit past report date and rejects future dates', async () => {
    const db = createDatabase(':memory:');
    const owner = db.findOrCreateUser('member@feedmob.com', 'Member');
    const server = createWorkTraceMcpServer(db, owner);
    const client = new Client({ name: 'worktrace-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const catchUp = await client.request({
      method: 'tools/call',
      params: { name: 'create_work_log', arguments: { reportDate: '2026-09-14', title: 'Catch-up', completed: ['Reconciled data'] } },
    }, CallToolResultSchema);
    const future = await client.request({
      method: 'tools/call',
      params: { name: 'create_work_log', arguments: { reportDate: '2999-01-01', title: 'Future', completed: ['Not allowed'] } },
    }, CallToolResultSchema);

    const catchUpContent = catchUp.content.find((item) => item.type === 'text');
    expect(JSON.parse(catchUpContent?.text ?? '{}')).toMatchObject({ created: true, log: { reportDate: '2026-09-14', title: 'Catch-up' } });
    expect(future.isError).toBe(true);
    expect(db.listWorkLogs(owner.id)).toHaveLength(1);

    await client.close();
    await server.close();
    db.close();
  });

  it('preserves Markdown, rejects stale replacement and reports sync results only to the owner', async () => {
    const db = createDatabase(':memory:');
    const owner = db.findOrCreateUser('markdown@feedmob.com', 'Owner');
    const other = db.findOrCreateUser('other@feedmob.com', 'Other');
    const server = createWorkTraceMcpServer(db, owner), otherServer = createWorkTraceMcpServer(db, other);
    const client = new Client({ name: 'owner-test', version: '1' }), otherClient = new Client({ name: 'other-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair(), [c, d] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a), otherServer.connect(d), otherClient.connect(c)]);
    const call = (name: string, args: Record<string, unknown>, actor = client) => actor.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema);
    const value = (result: Awaited<ReturnType<typeof call>>) => JSON.parse(result.content.find((item) => item.type === 'text')?.text ?? '{}');
    try {
      const markdown = '# 工作记录\n\n## Done\n1. 原工作\n   - 细节\n\n## Todos\n- [ ] 明日事项\n';
      const first = value(await call('submit_markdown_work_log', { reportDate: '2026-09-14', markdown }));
      expect(first.log.markdownContent).toBe(markdown);
      expect((await call('submit_markdown_work_log', { reportDate: '2026-09-14', markdown: '# replacement' })).isError).toBe(true);
      expect((await call('submit_markdown_work_log', { reportDate: '2026-09-14', markdown: '# replacement', expectedUpdatedAt: 'stale' })).isError).toBe(true);
      const appended = value(await call('append_work_log', { id: first.log.id, section: 'completed', text: '新工作\n- 子任务', expectedUpdatedAt: first.log.updatedAt, idempotencyKey: 'append-1' }));
      expect(appended.log.markdownContent).toContain('1. 原工作\n   - 细节\n2. 新工作\n   - 子任务\n\n## Todos\n- [ ] 明日事项');
      expect(appended.log.updatedAt).not.toBe(first.log.updatedAt);
      const replay = value(await call('append_work_log', { id: first.log.id, section: 'completed', text: '新工作\n- 子任务', expectedUpdatedAt: first.log.updatedAt, idempotencyKey: 'append-1' }));
      expect(replay).toMatchObject({ replayed: true, log: { markdownContent: appended.log.markdownContent } });
      expect(db.listMobiusSyncRuns(owner.id).items).toHaveLength(2);
      expect((await call('append_work_log', { id: first.log.id, text: '不可覆盖', expectedUpdatedAt: first.log.updatedAt })).isError).toBe(true);
      expect((await call('append_work_log', { id: first.log.id, text: '其他用户', }, otherClient)).isError).toBe(true);
      expect((await call('get_work_log_sync_status', { id: first.log.id }, otherClient)).isError).toBe(true);
      const status = value(await call('get_work_log_sync_status', { id: first.log.id }));
      expect(status).toMatchObject({ logId: first.log.id, reportDate: '2026-09-14', mobius: { source: 'mcp', workLogId: first.log.id }, timeOff: { source: 'mcp', workLogId: first.log.id } });
      const unsafeImage = '# 图片\n![pic][img]\n\n[img]: <blob:local>';
      expect((await call('submit_markdown_work_log', { reportDate: '2026-09-14', markdown: unsafeImage, expectedUpdatedAt: appended.log.updatedAt })).isError).toBe(true);
      expect(db.getWorkLog(first.log.id)?.markdownContent).toBe(appended.log.markdownContent);
      const replaced = value(await call('submit_markdown_work_log', { reportDate: '2026-09-14', markdown: '# 新标题\n\n## Done\n- 完成', expectedUpdatedAt: appended.log.updatedAt }));
      expect(replaced.log.markdownContent).toBe('# 新标题\n\n## Done\n- 完成');
    } finally { await client.close(); await server.close(); await otherClient.close(); await otherServer.close(); db.close(); }
  });

  it('lets members submit feedback and restricts management and RSI tools to administrators', async () => {
    const db = createDatabase(':memory:');
    const member = db.findOrCreateUser('member@feedmob.com', 'Member');
    const other = db.findOrCreateUser('other@feedmob.com', 'Other');
    const admin = db.findOrCreateUser('linden@feedmob.com', 'Admin');
    db.findOrCreateUser('leo_liu@feedmob.com', 'Built-in admin');
    const readStatus = vi.fn(async () => ({ enabled: false, heartbeat: '2026-10-29T00:00:00Z', runtime: { state: 'PAUSED', title: '已暂停' }, tasks: [{ id: 'task', title: '改善编辑', state: 'QUEUED', metadata: { reason: '等待执行', secret: 'not exposed' } }], events: [] }));
    const memberServer = createWorkTraceMcpServer(db, member, { getRsiStatus: readStatus });
    const adminServer = createWorkTraceMcpServer(db, admin, { getRsiStatus: readStatus });
    const memberClient = new Client({ name: 'member', version: '1' }), adminClient = new Client({ name: 'admin', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair(), [c, d] = InMemoryTransport.createLinkedPair();
    await Promise.all([memberClient.connect(a), memberServer.connect(b), adminClient.connect(c), adminServer.connect(d)]);
    const call = (actor: Client, name: string, args: Record<string, unknown> = {}) => actor.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema);
    const value = (result: Awaited<ReturnType<typeof call>>) => JSON.parse(result.content.find((item) => item.type === 'text')?.text ?? '{}');
    try {
      const names = (await memberClient.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain('create_feedback');
      expect(names).not.toContain('list_feedback');
      expect(names).not.toContain('get_rsi_status');
      expect((await call(memberClient, 'list_feedback')).isError).toBe(true);
      expect((await call(memberClient, 'get_rsi_status')).isError).toBe(true);
      const feedback = value(await call(memberClient, 'create_feedback', { category: 'SUGGESTION', title: '  导出日志  ', description: '希望支持导出。' }));
      expect(feedback).toMatchObject({ authorId: member.id, title: '导出日志', status: 'OPEN', handlingMode: 'AGENT' });
      db.createFeedback(other.id, { category: 'BUG', title: '另一个反馈', description: '页面显示异常。' });
      const listed = value(await call(adminClient, 'list_feedback', { status: 'OPEN', limit: 1 }));
      expect(listed.items).toHaveLength(1);
      expect(listed.nextCursor).toBeTruthy();
      const second = value(await call(adminClient, 'list_feedback', { status: 'OPEN', limit: 1, cursor: listed.nextCursor }));
      expect(second.items[0].id).not.toBe(listed.items[0].id);
      const status = value(await call(adminClient, 'get_rsi_status'));
      expect(status).toMatchObject({ enabled: false, runtime: { state: 'PAUSED' }, tasks: [{ title: '改善编辑', reason: '等待执行' }] });
      expect(JSON.stringify(status)).not.toContain('not exposed');
      expect(readStatus).toHaveBeenCalledTimes(1);
      readStatus.mockRejectedValueOnce(new Error('自动优化服务尚未配置。'));
      const unavailable = await call(adminClient, 'get_rsi_status');
      expect(unavailable.isError).toBe(true);
      expect(unavailable.content.find((item) => item.type === 'text')?.text).toContain('尚未配置');
      expect(db.listAuditEvents(member.id)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'FEEDBACK_CREATED', targetId: feedback.id })]));
      db.setUserRole(admin.id, 'MEMBER');
      expect((await call(adminClient, 'get_rsi_status')).isError).toBe(true);
      expect((await call(adminClient, 'list_feedback')).isError).toBe(true);
      expect(readStatus).toHaveBeenCalledTimes(2);
    } finally { await memberClient.close(); await memberServer.close(); await adminClient.close(); await adminServer.close(); db.close(); }
  });
});
