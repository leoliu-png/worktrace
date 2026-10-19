'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { encryptApiKey } from '@/lib/api-keys';
import { createDatabase } from '@/lib/db';
import { createTimeOffClient, TimeOffError } from '@/lib/time-off-client';
import { syncTimeOffForWorkLog } from '@/lib/time-off-sync';
import type { TimeOffReason } from '@/lib/time-off-types';

export type TimeOffConnectState = { error?: TimeOffReason | 'session' | 'token'; connected?: boolean };

export async function connectTimeOff(_previous: TimeOffConnectState, formData: FormData): Promise<TimeOffConnectState> {
  const user = (await auth())?.user;
  if (!user?.id || !user.email) return { error: 'session' };
  const token = String(formData.get('token') ?? '').trim();
  if (!/^fmtopat_[A-Za-z0-9_-]+$/.test(token) || token.length > 512) return { error: 'token' };
  try {
    const identity = await createTimeOffClient(token).identity();
    if (identity.email !== user.email.trim().toLowerCase()) return { error: 'account_mismatch' };
    const encryptedToken = encryptApiKey(token);
    const database = createDatabase();
    try { database.setTimeOffConnection(user.id, identity.email, encryptedToken, true); }
    finally { database.close(); }
  } catch (error) { return { error: error instanceof TimeOffError ? error.reason : 'configuration' }; }
  revalidatePath('/console/time-off');
  return { connected: true };
}

export async function disconnectTimeOff() {
  const user = (await auth())?.user;
  if (!user?.id || !user.email) redirect('/');
  const database = createDatabase();
  // Keep a disabled record so a server-wide fallback cannot silently reconnect it.
  try { database.setTimeOffConnection(user.id, user.email.trim().toLowerCase(), null, false); }
  finally { database.close(); }
  revalidatePath('/console/time-off');
}

export async function retryTimeOffSync(formData: FormData) {
  const user = (await auth())?.user;
  if (!user?.id || !user.email) redirect('/');
  const database = createDatabase();
  let log;
  try { log = database.getWorkLog(String(formData.get('workLogId') ?? '')); }
  finally { database.close(); }
  if (!log || log.authorId !== user.id) redirect('/console/time-off');
  const result = await syncTimeOffForWorkLog(log, user, { source: 'retry' });
  revalidatePath('/console/time-off');
  redirect(`/console/time-off?timeOff=${result.status}&timeOffReason=${result.reason ?? ''}`);
}
