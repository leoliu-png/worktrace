import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createDatabase, type LocalWorkLog } from './db';
import { issueIsDone, issueUpdatedToday, mobiusCommentBody, workLogEntries, type MobiusIssue, type WorkLogEntry } from './mobius-work-log';
import { createMobiusIssueMatcher } from './mobius-issue-matcher';
import { createMobiusParticipatingScope, MobiusParticipatingScopeError } from './mobius-participating-scope';
import { workTraceReportDate } from './report-date';
import type { MobiusSyncItem, MobiusSyncReason, MobiusSyncResult, MobiusSyncSource } from './mobius-sync-result';

export type { MobiusSyncResult } from './mobius-sync-result';
export type MobiusSyncDatabase = Pick<ReturnType<typeof createDatabase>, 'startMobiusSyncRun' | 'finishMobiusSyncRun' | 'claimMobiusComment' | 'markMobiusCommentPosted' | 'releaseMobiusCommentClaim'>;
type SyncOptions = { source?: MobiusSyncSource; database?: MobiusSyncDatabase };

type ToolData = Record<string, unknown>;

function toolData(result: unknown): ToolData {
  if (!result || typeof result !== 'object') throw new Error('Mobius MCP tool returned invalid data.');
  const response = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  if (response.isError) throw new Error('Mobius MCP tool returned an error.');
  const text = response.content?.find((part) => part.type === 'text')?.text;
  if (!text) throw new Error('Mobius MCP tool returned no text.');
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Mobius MCP tool returned invalid data.');
  return parsed as ToolData;
}

function asIssue(value: unknown): MobiusIssue | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const issue = value as Partial<MobiusIssue>;
  return typeof issue.identifier === 'string' && typeof issue.title === 'string' ? issue as MobiusIssue : undefined;
}

function allowedAuthor(email: string) {
  const allowlist = process.env.MOBIUS_SYNC_AUTHOR_EMAILS?.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
  return allowlist.includes(email.toLowerCase());
}

function reportSyncError(stage: string, error: unknown, token: string) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
  console.error(`Mobius work-log sync (${stage}): ${(token ? detail.replaceAll(token, '[redacted]') : detail).slice(0, 500)}`);
}

function appOrigin() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? '');
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.origin : undefined;
  } catch { return undefined; }
}

async function connectMobius(token: string) {
  const url = new URL(process.env.MOBIUS_MCP_URL ?? 'https://mobius.feedmob.com/api/mcp');
  if (url.protocol !== 'https:') throw new Error('MOBIUS_MCP_URL must use HTTPS.');
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (input, init) => {
      const signal = init?.method?.toUpperCase() === 'GET' ? init.signal : AbortSignal.any([init?.signal, AbortSignal.timeout(10_000)].filter((part): part is AbortSignal => Boolean(part)));
      return fetch(input, { ...init, signal });
    },
  });
  const client = new Client({ name: 'worktrace-mobius-sync', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  return toolData(await client.callTool({ name, arguments: args }, undefined, { timeout: 10_000 }));
}

async function getIssue(client: Client, identifier: string) {
  return asIssue(await call(client, 'get_issue', { identifier }));
}

function issueFields(issue?: MobiusIssue) {
  return issue ? { identifier: issue.identifier, title: issue.title, issueState: issue.state } : {};
}

export async function syncMobiusForWorkLog(log: LocalWorkLog, author: { email?: string | null; name?: string | null }, now = new Date(), options: SyncOptions = {}): Promise<MobiusSyncResult> {
  const result: MobiusSyncResult = { status: 'skipped', posted: 0, alreadyUpdated: 0, unmatched: 0, failed: 0, postedComments: [], items: [] };
  const database = options.database ?? createDatabase();
  const token = process.env.MOBIUS_PAT ?? '';
  let client: Client | undefined;
  let connectionReason: MobiusSyncReason = 'connection_failed';
  try {
    result.runId = database.startMobiusSyncRun(log, options.source ?? 'web', now);
    if (!token || !author.email || !allowedAuthor(author.email)) {
      result.status = 'disabled';
      result.reason = !token ? 'not_configured' : !author.email ? 'different_author' : 'author_not_enabled';
      return result;
    }
    if (log.reportDate !== workTraceReportDate(now)) { result.reason = 'past_report_date'; return result; }

    const allEntries = workLogEntries(log);
    const entries = allEntries.slice(0, 30);
    for (const entry of allEntries.slice(30)) {
      result.unmatched++;
      result.items.push({ status: 'unmatched', entries: [entry], reason: 'entry_limit' });
    }
    if (!entries.length) { result.reason = 'empty'; return result; }

    client = await connectMobius(token);
    const identity = await call(client, 'whoami', {});
    if ((identity.capabilities as { comment?: boolean } | undefined)?.comment !== true) {
      connectionReason = 'no_comment_permission';
      throw new Error('The Mobius identity cannot comment.');
    }
    if (typeof identity.email !== 'string' || identity.email.trim().toLowerCase() !== author.email.trim().toLowerCase()) {
      connectionReason = 'token_account_mismatch';
      throw new Error('The Mobius token owner must match the WorkTrace log author.');
    }
    connectionReason = 'participating_unavailable';
    const participating = createMobiusParticipatingScope(token, identity);
    await participating.list();
    connectionReason = 'connection_failed';
    const findIssue = createMobiusIssueMatcher((name, args) => call(client!, name, args), participating);
    const grouped = new Map<string, { issue: MobiusIssue; entries: WorkLogEntry[] }>();
    for (const entry of entries) {
      try {
        const match = await findIssue(entry);
        const issue = match.issue;
        if (match.reason || !issue) {
          result.unmatched++;
          result.items.push({ status: match.reason === 'done' || match.reason === 'stopped' ? 'skipped' : 'unmatched', entries: [entry], reason: match.reason ?? 'no_match', ...issueFields(issue) });
          continue;
        }
        const previous = grouped.get(issue.identifier);
        grouped.set(issue.identifier, { issue, entries: [...(previous?.entries ?? []), entry] });
      } catch (error) {
        result.failed++;
        result.items.push({ status: 'error', entries: [entry], reason: 'matching_failed' });
        reportSyncError('matching', error, token);
      }
    }

    const today = workTraceReportDate(now);
    for (const [identifier, group] of grouped) {
      const item: MobiusSyncItem = { status: 'skipped', entries: group.entries, ...issueFields(group.issue) };
      result.items.push(item);
      let claimId: string | null = null;
      try {
        for (let check = 0; check < 2; check++) {
          const issue = await getIssue(client, identifier);
          Object.assign(item, issueFields(issue));
          if (!issue || issueIsDone(issue) || issue.agentStopRequested) {
            result.unmatched += group.entries.length;
            item.reason = !issue ? 'no_match' : issueIsDone(issue) ? 'done' : 'stopped';
            break;
          }
          if (!await participating.contains(identifier)) {
            result.unmatched += group.entries.length;
            item.reason = 'not_related';
            break;
          }
          if (issueUpdatedToday(issue, now)) { result.alreadyUpdated++; item.reason = 'updated_today'; break; }
          if (check === 0) {
            claimId = database.claimMobiusComment(identifier, today, log.id, now);
            if (!claimId) { result.alreadyUpdated++; item.reason = 'duplicate'; break; }
          }
        }
        if (item.reason) continue;
        const body = mobiusCommentBody(log, group.entries, author.name?.replace(/[\r\n]/g, ' ').slice(0, 100) || author.email, appOrigin());
        const posted = await client.callTool({ name: 'add_comment', arguments: { identifier, body } }, undefined, { timeout: 10_000 });
        if (posted.isError) throw new Error('Mobius refused the comment.');
        item.status = 'posted';
        item.commentBody = body;
        result.posted++;
        result.postedComments.push({ identifier, body });
        const postedClaimId = claimId!;
        claimId = null;
        database.markMobiusCommentPosted(postedClaimId);
      } catch (error) {
        result.failed++;
        if (item.status !== 'posted') { item.status = 'error'; item.reason = error instanceof MobiusParticipatingScopeError ? 'participating_unavailable' : 'comment_failed'; }
        reportSyncError(`comment ${identifier}`, error, token);
      } finally {
        if (claimId) database.releaseMobiusCommentClaim(claimId);
      }
    }
    return result;
  } catch (error) {
    result.failed++;
    result.reason = result.runId ? connectionReason : 'persistence_failed';
    reportSyncError('connection', error, token);
    return result;
  } finally {
    await client?.close().catch(() => undefined);
    result.status = result.failed ? (result.posted ? 'partial' : 'error') : result.posted ? 'posted' : result.status;
    try {
      if (result.runId) database.finishMobiusSyncRun(result.runId, result);
    } catch (error) {
      result.failed++;
      result.status = result.posted ? 'partial' : 'error';
      result.reason = 'persistence_failed';
      reportSyncError('saving result', error, token);
    } finally {
      if (!options.database) (database as ReturnType<typeof createDatabase>).close();
    }
  }
}
