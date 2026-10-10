'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { removeImageAttachments, saveImageAttachments } from '@/lib/attachments';
import { createDatabase, type LocalWorkLog } from '@/lib/db';
import { normalizeWorkLogSection } from '@/lib/agent-work-logs';
import { maxMarkdownCharacters, parseMarkdownWorkLog } from '@/lib/markdown-work-log';
import { syncMobiusForWorkLog, type MobiusSyncResult } from '@/lib/mobius-sync';
import { pendingPastedImages, replacePastedImageSources } from '@/lib/pasted-work-log-images';
import { resolveReportDate } from '@/lib/report-date';

async function preparePastedImages(formData: FormData, markdown: string, errorUrl: string) {
  try {
    const pending = pendingPastedImages(formData, markdown);
    const stored = pending.length ? await saveImageAttachments(pending.map((image) => image.file)) : [];
    return { pending, stored };
  } catch { redirect(errorUrl); }
}

function mobiusQuery(result: MobiusSyncResult) {
  return `&mobius=${result.status}&posted=${result.posted}&unmatched=${result.unmatched}&updated=${result.alreadyUpdated}&failed=${result.failed}`;
}

export async function createWorkLog(formData: FormData): Promise<{ error: string } | { redirectTo: string }> {
  const draftMode = formData.has('draftId');
  const failure = (error: string): { error: string } => {
    if (draftMode) return { error };
    redirect(`/console/logs/new?error=${error}`);
  };
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    if (draftMode) return { error: 'session' };
    redirect('/');
  }

  const markdownMode = formData.has('markdownContent');
  const markdown = String(formData.get('markdownContent') ?? '');
  if (markdownMode && markdown.length > maxMarkdownCharacters) return failure('too-long');
  const input = markdownMode ? parseMarkdownWorkLog(markdown) : logInput(formData);
  if (!input || !input.title || (!markdownMode && !input.completed.length)) return failure('required');
  let reportDate: string;
  try { reportDate = resolveReportDate(String(formData.get('reportDate') ?? '')); }
  catch { return failure('date'); }

  let pending: ReturnType<typeof pendingPastedImages>;
  let stored: Awaited<ReturnType<typeof saveImageAttachments>>;
  try {
    pending = pendingPastedImages(formData, markdown);
    stored = pending.length ? await saveImageAttachments(pending.map((image) => image.file)) : [];
  } catch { return failure('image'); }
  const database = createDatabase();
  let savedLog: LocalWorkLog | undefined;
  try {
    database.transaction(() => {
      const { log } = database.upsertDailyWorkLog(user.id, { reportDate, ...input });
      if (pending.length) {
        const attachments = database.addWorkLogAttachments(log.id, stored);
        database.setWorkLogMarkdown(log.id, replacePastedImageSources(markdown, pending, attachments));
      }
      savedLog = database.getWorkLog(log.id);
    });
  } catch (error) {
    await removeImageAttachments(stored.map((image) => image.storageKey));
    if (draftMode) return { error: 'save' };
    throw error;
  } finally { database.close(); }
  if (!savedLog) throw new Error('Saved work log was not found.');
  const mobius = await syncMobiusForWorkLog(savedLog, user);
  revalidatePath('/console');
  revalidatePath('/console/issue-matches');
  const redirectTo = `/console/my-logs?created=1${mobiusQuery(mobius)}`;
  if (draftMode) return { redirectTo };
  redirect(redirectTo);
}

function logInput(formData: FormData) {
  return { title: String(formData.get('title') ?? '').trim(), completed: String(formData.get('completed') ?? '').split('\n').map((item) => item.trim()).filter(Boolean), inProgress: normalizeWorkLogSection(String(formData.get('inProgress') ?? '')), blockers: normalizeWorkLogSection(String(formData.get('blockers') ?? '')), nextPlan: normalizeWorkLogSection(String(formData.get('nextPlan') ?? '')) };
}

export async function updateWorkLog(formData: FormData) {
  const user = (await auth())?.user; const id = String(formData.get('id') ?? '');
  if (!user?.id || !user.role || !id) redirect('/console');
  const markdownMode = formData.has('markdownContent');
  const markdown = String(formData.get('markdownContent') ?? '');
  const from = formData.get('from') === 'my' ? 'my' : formData.get('from') === 'admin' ? 'admin' : '';
  const editUrl = `/console/logs/${id}/edit${from ? `?from=${from}&` : '?'}error=`;
  if (markdownMode && markdown.length > maxMarkdownCharacters) redirect(`${editUrl}too-long`);
  const input = markdownMode ? parseMarkdownWorkLog(markdown) : logInput(formData);
  if (!input || !input.title || (!markdownMode && !input.completed.length)) redirect(markdownMode ? `${editUrl}required` : '/console');
  const { pending, stored } = await preparePastedImages(formData, markdown, `${editUrl}image`);
  const database = createDatabase();
  let savedLog: LocalWorkLog | undefined;
  try {
    database.transaction(() => {
      database.updateWorkLog(id, user.id, user.role!, input);
      if (pending.length) {
        const attachments = database.addWorkLogAttachments(id, stored);
        database.setWorkLogMarkdown(id, replacePastedImageSources(markdown, pending, attachments));
      }
      savedLog = database.getWorkLog(id);
    });
  } catch (error) {
    await removeImageAttachments(stored.map((image) => image.storageKey));
    throw error;
  } finally { database.close(); }
  if (!savedLog) throw new Error('Saved work log was not found.');
  const mobius = await syncMobiusForWorkLog(savedLog, savedLog.authorId === user.id ? user : {});
  revalidatePath('/console');
  revalidatePath('/console/issue-matches');
  redirect(`/console/logs/${id}?${from ? `from=${from}&` : ''}saved=1${mobiusQuery(mobius)}`);
}

export async function deleteWorkLog(formData: FormData) {
  const user = (await auth())?.user; const id = String(formData.get('id') ?? '');
  if (!user?.id || !user.role || !id) redirect('/console');
  const database = createDatabase();
  try { database.deleteWorkLog(id, user.id, user.role); } finally { database.close(); }
  redirect(formData.get('returnTo') === 'admin' ? '/console/admin/logs' : '/console/my-logs');
}
