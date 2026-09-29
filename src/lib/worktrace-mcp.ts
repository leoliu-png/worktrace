import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dailySubmissionStatus, validateAgentWorkLog, workLogSectionInputSchema } from './agent-work-logs';
import type { LocalUser } from './db';

export const workTraceMcpTools = {
  prepare_work_log: { description: 'Turn raw work notes into a user-confirmable structured draft. Do not invent optional fields.' },
  create_work_log: { required: ['title', 'completed'] },
  update_work_log: { required: ['id', 'title', 'completed'] },
  list_work_logs: { description: 'List team work-log summaries with filters and cursor paging.' },
  get_work_log: { description: 'Read one complete work log by id.' },
  get_daily_submission_status: { timezone: 'Asia/Shanghai' },
} as const;

type Database = {
  createWorkLogIdempotent(authorId: string, input: any, key: string): { log: unknown; created: boolean };
  createWorkLog(authorId: string, input: any): unknown;
  upsertDailyWorkLog(authorId: string, input: any): { log: unknown; created: boolean };
  upsertDailyWorkLogIdempotent(authorId: string, input: any, key: string): { log: unknown; created: boolean };
  updateWorkLog(id: string, actorId: string, actorRole: LocalUser['role'], input: any): unknown;
  queryWorkLogs(options: { authorId?: string; query?: string; reportDate?: string; from?: string; to?: string; cursor?: string; limit?: number }): { items: Array<{ id: string; authorId: string; [key: string]: unknown }>; nextCursor: string | null };
  getWorkLog(id: string): unknown;
  listUsers(): LocalUser[];
};
const output = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function createWorkTraceMcpServer(database: Database, user: LocalUser) {
  const server = new McpServer({ name: 'worktrace', version: '1.0.0' });
  server.registerTool('prepare_work_log', { description: workTraceMcpTools.prepare_work_log.description, inputSchema: { rawNotes: z.string().trim().min(1).max(10_000) } }, async ({ rawNotes }) => output({
    rawNotes,
    instruction: 'Summarize these notes into title and completed (both required). When the user explicitly identifies a work-log date, include reportDate as YYYY-MM-DD; otherwise omit it so WorkTrace uses today in Asia/Shanghai. When explicit, provide inProgress, blockers, and nextPlan as arrays of concise items, never as one semicolon-separated paragraph. Present the draft to the user for confirmation before calling create_work_log.',
  }));
  server.registerTool('create_work_log', { description: 'Create or replace the authenticated user\'s WorkTrace work log for an optional past or current Shanghai report date after the user confirms the draft. Omit reportDate to use today; future dates are rejected.', inputSchema: { reportDate: z.string().optional(), title: z.string(), completed: z.array(z.string()), inProgress: workLogSectionInputSchema.optional(), blockers: workLogSectionInputSchema.optional(), nextPlan: workLogSectionInputSchema.optional(), idempotencyKey: z.string().optional() } }, async ({ idempotencyKey, ...input }) => {
    const parsed = validateAgentWorkLog(input);
    if (!parsed.success) return { content: [{ type: 'text' as const, text: 'Validation failed: use a valid non-future reportDate (YYYY-MM-DD), a title, and at least one completed item.' }], isError: true };
    const result = idempotencyKey ? database.upsertDailyWorkLogIdempotent(user.id, parsed.data, idempotencyKey) : database.upsertDailyWorkLog(user.id, parsed.data);
    return output(result);
  });
  server.registerTool('update_work_log', { description: 'Update an existing WorkTrace work log. The owner may update their own log; administrators may update any log.', inputSchema: { id: z.string().min(1), title: z.string(), completed: z.array(z.string()), inProgress: workLogSectionInputSchema.optional(), blockers: workLogSectionInputSchema.optional(), nextPlan: workLogSectionInputSchema.optional() } }, async ({ id, ...input }) => {
    const parsed = validateAgentWorkLog(input);
    if (!parsed.success) return { content: [{ type: 'text' as const, text: 'Validation failed: title and at least one completed item are required.' }], isError: true };
    return output(database.updateWorkLog(id, user.id, user.role, parsed.data));
  });
  server.registerTool('list_work_logs', { description: workTraceMcpTools.list_work_logs.description, inputSchema: { query: z.string().optional(), authorId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(50).optional() } }, async (input) => output(database.queryWorkLogs(input)));
  server.registerTool('get_work_log', { description: workTraceMcpTools.get_work_log.description, inputSchema: { id: z.string().min(1) } }, async ({ id }) => {
    const log = database.getWorkLog(id);
    return log ? output(log) : { content: [{ type: 'text' as const, text: 'Work log was not found.' }], isError: true };
  });
  server.registerTool('get_daily_submission_status', { description: 'Return every member\'s submitted or missing status for a Shanghai calendar date.', inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() } }, async ({ date }) => output(dailySubmissionStatus(database, date)));
  return server;
}
