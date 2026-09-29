import { describe, expect, it } from 'vitest';
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
});
