import { createDatabase, type LocalWorkLog } from './db';
import { decryptApiKey } from './api-keys';
import { createTimeOffClient, TimeOffError } from './time-off-client';
import { prepareTimeOffJournal } from './time-off-images';
import type { TimeOffSource, TimeOffSyncResult } from './time-off-types';

export type TimeOffSyncDatabase = Pick<ReturnType<typeof createDatabase>, 'getTimeOffConnection' | 'startTimeOffSyncRun' | 'finishTimeOffSyncRun' | 'getWorkLog' | 'getWorkLogAttachment' | 'listWorkLogAttachments'>;
type Author = { id?: string; email?: string | null };
const pending = new Map<string, Promise<TimeOffSyncResult>>();

function tokenFor(database: TimeOffSyncDatabase, authorId: string, email: string) {
  const connection = database.getTimeOffConnection(authorId);
  if (connection) {
    if (!connection.enabled) throw new TimeOffError('disabled');
    if (connection.accountEmail !== email || !connection.encryptedToken) throw new TimeOffError('account_mismatch');
    try { return decryptApiKey(connection.encryptedToken); }
    catch { throw new TimeOffError('configuration'); }
  }
  if (process.env.TIME_OFF_ACCOUNT_EMAIL?.trim().toLowerCase() !== email || !process.env.TIME_OFF_PAT?.trim()) throw new TimeOffError('not_configured');
  return process.env.TIME_OFF_PAT.trim();
}

export async function syncTimeOffForWorkLog(log: LocalWorkLog, author: Author, options: { source?: TimeOffSource; database?: TimeOffSyncDatabase } = {}): Promise<TimeOffSyncResult> {
  let database: TimeOffSyncDatabase | undefined;
  const key = `${log.authorId}:${log.reportDate}`;
  const predecessor = pending.get(key);
  const task = Promise.resolve(predecessor).catch(() => undefined).then(async (): Promise<TimeOffSyncResult> => {
    const result: TimeOffSyncResult = { status: 'error', reportDate: log.reportDate };
    try {
      database = options.database ?? createDatabase();
      const current = database.getWorkLog(log.id);
      if (!current || current.authorId !== log.authorId) throw new TimeOffError('rejected');
      result.runId = database.startTimeOffSyncRun(current, options.source ?? 'web');
      const email = author.email?.trim().toLowerCase();
      if (!email || (author.id !== undefined && author.id !== current.authorId)) throw new TimeOffError('different_author');
      const token = tokenFor(database, current.authorId, email);
      const client = createTimeOffClient(token);
      const identity = await client.identity();
      if (identity.email !== email) throw new TimeOffError('account_mismatch');
      // Resolve again after authentication so queued saves send the latest body.
      const latest = database.getWorkLog(current.id);
      if (!latest || latest.authorId !== current.authorId) throw new TimeOffError('rejected');
      const journal = await prepareTimeOffJournal(latest, database);
      const saved = await client.upsertJournal(latest.reportDate, journal.markdown, email);
      Object.assign(result, { status: journal.warnings.length ? 'partial' : 'synced', reportDate: latest.reportDate, journalId: saved.journalId,
        ...(journal.warnings.length ? { reason: 'image_unavailable', imageWarnings: journal.warnings } : {}) });
    } catch (error) {
      const reason = error instanceof TimeOffError ? error.reason : 'persistence_failed';
      result.reason = reason;
      result.status = reason === 'not_configured' || reason === 'disabled' ? 'disabled' : reason === 'different_author' ? 'skipped' : 'error';
    } finally {
      try { if (database && result.runId) database.finishTimeOffSyncRun(result.runId, result); }
      catch { result.status = 'error'; result.reason = 'persistence_failed'; }
    }
    return result;
  });
  pending.set(key, task);
  try { return await task; }
  finally {
    if (pending.get(key) === task) pending.delete(key);
    if (!options.database) (database as ReturnType<typeof createDatabase> | undefined)?.close();
  }
}
