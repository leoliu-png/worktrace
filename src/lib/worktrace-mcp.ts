import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dailySubmissionStatus, validateAgentWorkLog, workLogSectionInputSchema } from './agent-work-logs';
import type { LocalUser, LocalWorkLog } from './db';
import { syncWorkLog, type WorkLogSyncDatabase } from './work-log-sync';
import { parseMarkdownWorkLog, workLogMarkdownContent } from './markdown-work-log';
import { resolveReportDate } from './report-date';
import { appendMarkdownWorkItem } from './mcp-markdown-append';
import type { TimeOffSyncRun } from './time-off-types';
import type { MobiusSyncRun } from './mobius-sync-result';
import { markdownImageContent } from './markdown-work-log-images';
import { feedbackCategories, feedbackStatuses, type Feedback, type FeedbackInput, type FeedbackStatus } from './feedback';

export const workTraceMcpTools = {
  prepare_work_log: { description: 'Turn raw work notes into a user-confirmable structured draft. Do not invent optional fields.' },
  create_work_log: { required: ['title', 'completed'] },
  update_work_log: { required: ['id', 'title', 'completed'] },
  list_work_logs: { description: 'List team work-log summaries with filters and cursor paging.' },
  get_work_log: { description: 'Read one complete work log by id.' },
  get_daily_submission_status: { timezone: 'Asia/Shanghai' },
  get_work_log_sync_status: { description: 'Read the current user’s latest Mobius and Time off sync results for a log.' },
  append_work_log: { description: 'Append an item to an existing work log without replacing its other content.' },
  submit_markdown_work_log: { description: 'Submit a complete Markdown work log for the authenticated user.' },
  create_feedback: { description: 'Submit a suggestion or problem as the authenticated user.' },
  list_feedback: { description: 'List all feedback in the management view; administrators only.' },
  get_rsi_status: { description: 'Read the current automated improvement status; administrators only.' },
} as const;

type Database = WorkLogSyncDatabase & {
  createWorkLogIdempotent(authorId: string, input: any, key: string): { log: unknown; created: boolean };
  createWorkLog(authorId: string, input: any): unknown;
  upsertDailyWorkLog(authorId: string, input: any): { log: LocalWorkLog; created: boolean };
  upsertDailyWorkLogIdempotent(authorId: string, input: any, key: string): { log: LocalWorkLog; created: boolean };
  updateWorkLog(id: string, actorId: string, actorRole: LocalUser['role'], input: any): LocalWorkLog;
  queryWorkLogs(options: { authorId?: string; query?: string; reportDate?: string; from?: string; to?: string; cursor?: string; limit?: number }): { items: Array<{ id: string; authorId: string; [key: string]: unknown }>; nextCursor: string | null };
  getWorkLog(id: string): LocalWorkLog | undefined;
  listUsers(): LocalUser[];
  transaction<T>(callback: () => T): T;
  getWorkLogRequest(authorId: string, key: string): LocalWorkLog | undefined;
  recordWorkLogRequest(authorId: string, key: string, workLogId: string): void;
  listMobiusSyncRuns(authorId: string, options?: { limit?: number; cursor?: string; workLogId?: string }): { items: MobiusSyncRun[]; nextCursor: string | null };
  listTimeOffSyncRuns(userId: string, options?: { workLogId?: string }): TimeOffSyncRun[];
  createFeedback(authorId: string, input: FeedbackInput): Feedback;
  listFeedback(viewerId: string, options?: { all?: boolean; status?: FeedbackStatus; limit?: number; cursor?: string }): { items: Feedback[]; nextCursor: string | null };
};
const output = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function createWorkTraceMcpServer(database: Database, user: LocalUser, options: { getRsiStatus?: () => Promise<unknown> } = {}) {
  const server = new McpServer({ name: 'worktrace', version: '1.0.0' });
  server.registerTool('prepare_work_log', { description: workTraceMcpTools.prepare_work_log.description, inputSchema: { rawNotes: z.string().trim().min(1).max(10_000) } }, async ({ rawNotes }) => output({
    rawNotes,
    instruction: 'Summarize these notes into title and completed (both required). When the user explicitly identifies a work-log date, include reportDate as YYYY-MM-DD; otherwise omit it so WorkTrace uses today in Asia/Shanghai. When explicit, provide inProgress, blockers, and nextPlan as arrays of concise items, never as one semicolon-separated paragraph. Present the draft to the user for confirmation before calling create_work_log.',
  }));
  server.registerTool('create_work_log', { description: 'Create or replace the authenticated user\'s WorkTrace work log for an optional past or current Shanghai report date after the user confirms the draft. Omit reportDate to use today; future dates are rejected.', inputSchema: { reportDate: z.string().optional(), title: z.string(), completed: z.array(z.string()), inProgress: workLogSectionInputSchema.optional(), blockers: workLogSectionInputSchema.optional(), nextPlan: workLogSectionInputSchema.optional(), idempotencyKey: z.string().optional() } }, async ({ idempotencyKey, ...input }) => {
    const parsed = validateAgentWorkLog(input);
    if (!parsed.success) return { content: [{ type: 'text' as const, text: 'Validation failed: use a valid non-future reportDate (YYYY-MM-DD), a title, and at least one completed item.' }], isError: true };
    const result = idempotencyKey ? database.upsertDailyWorkLogIdempotent(user.id, parsed.data, idempotencyKey) : database.upsertDailyWorkLog(user.id, parsed.data);
    const sync = await syncWorkLog(result.log, user, { source: 'mcp', database });
    return output({ ...result, ...sync });
  });
  server.registerTool('update_work_log', { description: 'Update an existing WorkTrace work log. The owner may update their own log; administrators may update any log.', inputSchema: { id: z.string().min(1), title: z.string(), completed: z.array(z.string()), inProgress: workLogSectionInputSchema.optional(), blockers: workLogSectionInputSchema.optional(), nextPlan: workLogSectionInputSchema.optional() } }, async ({ id, ...input }) => {
    const parsed = validateAgentWorkLog(input);
    if (!parsed.success) return { content: [{ type: 'text' as const, text: 'Validation failed: title and at least one completed item are required.' }], isError: true };
    const log = database.updateWorkLog(id, user.id, user.role, parsed.data);
    const sync = await syncWorkLog(log, log.authorId === user.id ? user : {}, { source: 'mcp', database });
    return output({ ...log, ...sync });
  });
  server.registerTool('list_work_logs', { description: workTraceMcpTools.list_work_logs.description, inputSchema: { query: z.string().optional(), authorId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(50).optional() } }, async (input) => output(database.queryWorkLogs(input)));
  server.registerTool('get_work_log', { description: workTraceMcpTools.get_work_log.description, inputSchema: { id: z.string().min(1) } }, async ({ id }) => {
    const log = database.getWorkLog(id);
    return log ? output(log) : { content: [{ type: 'text' as const, text: 'Work log was not found.' }], isError: true };
  });
  server.registerTool('get_daily_submission_status', { description: 'Return every member\'s submitted or missing status for a Shanghai calendar date.', inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() } }, async ({ date }) => output(dailySubmissionStatus(database, date)));
  const selector = { id: z.string().min(1).optional(), reportDate: z.string().optional() };
  function ownLog(id?: string, date?: string) {
    if (id && date) throw new Error('Choose either id or reportDate.');
    if (id) {
      const log = database.getWorkLog(id);
      if (!log || log.authorId !== user.id) throw new Error('Your work log was not found.');
      return log;
    }
    const reportDate = resolveReportDate(date);
    const matches = database.queryWorkLogs({ authorId: user.id, reportDate, limit: 2 }).items;
    if (matches.length > 1) throw new Error('More than one log exists for this date; provide the log id.');
    return matches.length ? database.getWorkLog(matches[0].id) : undefined;
  }
  const failure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Operation failed.' }] });
  server.registerTool('get_work_log_sync_status', { description: workTraceMcpTools.get_work_log_sync_status.description + ' Supply id or reportDate; defaults to today. No comments or synchronization are triggered.', inputSchema: selector, annotations: { readOnlyHint: true } }, async ({ id, reportDate }) => {
    try {
      const log = ownLog(id, reportDate);
      if (!log) throw new Error('Your work log was not found.');
      return output({ logId: log.id, reportDate: log.reportDate, mobius: database.listMobiusSyncRuns(user.id, { workLogId: log.id, limit: 1 }).items[0] ?? null, timeOff: database.listTimeOffSyncRuns(user.id, { workLogId: log.id })[0] ?? null });
    } catch (error) { return failure(error); }
  });
  server.registerTool('append_work_log', { description: workTraceMcpTools.append_work_log.description + ' Supply id or reportDate (defaults to today). Saves atomically and runs the normal sync. If expectedUpdatedAt is supplied, reject a changed log. Reuse a unique idempotencyKey when retrying the same append.', inputSchema: { ...selector, section: z.enum(['completed', 'inProgress', 'blockers', 'nextPlan']).default('completed'), text: z.string().trim().min(1).max(10000), expectedUpdatedAt: z.string().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional() } }, async ({ id, reportDate, section, text, expectedUpdatedAt, idempotencyKey }) => {
    try {
      const result = database.transaction(() => {
        const current = ownLog(id, reportDate);
        if (!current) throw new Error('Your work log was not found; create it first.');
        const key = idempotencyKey ? `mcp-append:${idempotencyKey}` : undefined;
        const previous = key ? database.getWorkLogRequest(user.id, key) : undefined;
        if (previous) {
          if (previous.id !== current.id) throw new Error('The idempotency key belongs to a different work log.');
          return { log: previous, replayed: true };
        }
        if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) throw new Error('Work log changed; reload it before retrying.');
        const markdown = appendMarkdownWorkItem(workLogMarkdownContent(current), section, text);
        const input = parseMarkdownWorkLog(markdown);
        if (!input) throw new Error('The resulting Markdown is empty or exceeds 50,000 characters.');
        const log = database.updateWorkLog(current.id, user.id, user.role, input);
        if (key) database.recordWorkLogRequest(user.id, key, log.id);
        return { log, replayed: false };
      });
      if (result.replayed) {
        const mobius = database.listMobiusSyncRuns(user.id, { workLogId: result.log.id, limit: 1 }).items[0];
        const timeOff = database.listTimeOffSyncRuns(user.id, { workLogId: result.log.id })[0];
        return output({ ...result, mobius: mobius?.result ?? (mobius ? { status: mobius.status, runId: mobius.id } : null), timeOff: timeOff?.result ?? (timeOff ? { status: timeOff.status, runId: timeOff.id } : null) });
      }
      return output({ ...result, ...await syncWorkLog(result.log, user, { source: 'mcp', database }) });
    } catch (error) { return failure(error); }
  });
  server.registerTool('submit_markdown_work_log', { description: workTraceMcpTools.submit_markdown_work_log.description + ' For an existing day, supply its expectedUpdatedAt to confirm replacement. Local blob/data image URLs are not supported; upload attachments separately.', inputSchema: { markdown: z.string().min(1).max(50000), reportDate: z.string().optional(), expectedUpdatedAt: z.string().optional() } }, async ({ markdown, reportDate, expectedUpdatedAt }) => {
    try {
      const input = parseMarkdownWorkLog(markdown);
      if (!input) throw new Error('Markdown must contain text and be at most 50,000 characters.');
      if (markdownImageContent(markdown).images.some((image) => /^(?:blob:|data:|file:)/i.test(image.source))) throw new Error('Local blob/data/file images cannot be submitted through this tool.');
      const date = resolveReportDate(reportDate);
      const result = database.transaction(() => {
        const current = ownLog(undefined, date);
        if (current && (!expectedUpdatedAt || current.updatedAt !== expectedUpdatedAt)) throw new Error('A log already exists or changed; retrieve it and supply its current updatedAt to confirm replacement.');
        return database.upsertDailyWorkLog(user.id, { reportDate: date, ...input });
      });
      return output({ ...result, ...await syncWorkLog(result.log, user, { source: 'mcp', database }) });
    } catch (error) { return failure(error); }
  });
  server.registerTool('create_feedback', { description: workTraceMcpTools.create_feedback.description + ' Creates a pending feedback item attributed to the current account.', inputSchema: { category: z.enum(feedbackCategories), title: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(5000) } }, async (input) => {
    try { return output(database.createFeedback(user.id, input)); }
    catch (error) { return failure(error); }
  });
  if (user.role === 'ADMIN') {
    const requireAdmin = () => {
      if (database.listUsers().find((member) => member.id === user.id)?.role !== 'ADMIN') throw new Error('Administrator access is required.');
    };
    server.registerTool('list_feedback', { description: workTraceMcpTools.list_feedback.description + ' Supports status filtering and cursor pagination.', inputSchema: { status: z.enum(feedbackStatuses).optional(), limit: z.number().int().min(1).max(50).optional(), cursor: z.string().optional() }, annotations: { readOnlyHint: true } }, async ({ status, limit, cursor }) => {
      try { requireAdmin(); return output(database.listFeedback(user.id, { all: true, status, limit, cursor })); }
      catch (error) { return failure(error); }
    });
    server.registerTool('get_rsi_status', { description: workTraceMcpTools.get_rsi_status.description + ' Read-only; the local RSI service must be configured and running.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => {
      try {
        requireAdmin();
        const readStatus = options.getRsiStatus ?? (async () => (await import('./rsi-control')).rsiControl('/status'));
        const raw = await readStatus();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('自动优化服务返回了无效状态。');
        const status = raw as { enabled?: boolean; heartbeat?: string; phase?: string; appReady?: boolean; agentRunsToday?: number; tasksToday?: number; lastError?: { message?: string; at?: string } | null; runtime?: Record<string, unknown>; tasks?: Array<{ id: string; title: string; state: string; updatedAt: string; metadata?: { reason?: string; sourceSha?: string }; approvals?: Array<{ decision: string; sourceSha: string }> }>; events?: Array<{ type: string; message: string; createdAt: string }> };
        const runtime = status.runtime ?? {};
        return output({ enabled: status.enabled, heartbeat: status.heartbeat, phase: status.phase, appReady: status.appReady, agentRunsToday: status.agentRunsToday, tasksToday: status.tasksToday, lastError: status.lastError, runtime: { state: runtime.state, title: runtime.title, description: runtime.description, agent: runtime.agent, startedAt: runtime.startedAt, queuedTasks: runtime.queuedTasks, humanTasks: runtime.humanTasks, nextSweep: runtime.nextSweep, lastSweep: runtime.lastSweep, lastManualProcess: runtime.lastManualProcess }, tasks: (status.tasks ?? []).map((task) => ({ id: task.id, title: task.title, state: task.state, updatedAt: task.updatedAt, reason: task.metadata?.reason, sourceSha: task.metadata?.sourceSha, approvals: task.approvals?.filter((approval) => approval.sourceSha === task.metadata?.sourceSha && approval.decision === 'approve').length ?? 0 })), recentEvents: (status.events ?? []).slice(0, 10).map(({ type, message, createdAt }) => ({ type, message, createdAt })) });
      } catch (error) { return failure(error); }
    });
  }
  return server;
}
