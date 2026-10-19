import type { LocalWorkLog } from './db';
import { syncMobiusForWorkLog, type MobiusSyncDatabase, type MobiusSyncResult } from './mobius-sync';
import { syncTimeOffForWorkLog, type TimeOffSyncDatabase } from './time-off-sync';
import type { TimeOffSyncResult } from './time-off-types';

export type WorkLogSyncDatabase = MobiusSyncDatabase & TimeOffSyncDatabase;

export async function syncWorkLog(log: LocalWorkLog, author: { id?: string; email?: string | null; name?: string | null }, options: { source: 'web' | 'mcp' | 'api'; database?: WorkLogSyncDatabase }) {
  const [mobiusResult, timeOffResult] = await Promise.allSettled([
    syncMobiusForWorkLog(log, author, undefined, options),
    syncTimeOffForWorkLog(log, author, options),
  ]);
  const mobius: MobiusSyncResult = mobiusResult.status === 'fulfilled' ? mobiusResult.value
    : { status: 'error', reason: 'persistence_failed', posted: 0, alreadyUpdated: 0, unmatched: 0, failed: 1, postedComments: [], items: [] };
  const timeOff: TimeOffSyncResult = timeOffResult.status === 'fulfilled' ? timeOffResult.value
    : { status: 'error', reason: 'persistence_failed', reportDate: log.reportDate };
  return { mobius, timeOff };
}
