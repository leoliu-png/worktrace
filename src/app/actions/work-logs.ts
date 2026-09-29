'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { removeImageAttachments, saveImageAttachments } from '@/lib/attachments';
import { createDatabase } from '@/lib/db';
import { normalizeWorkLogSection } from '@/lib/agent-work-logs';
import { maxMarkdownCharacters, parseMarkdownWorkLog } from '@/lib/markdown-work-log';
import { pendingPastedImages, replacePastedImageSources } from '@/lib/pasted-work-log-images';
import { resolveReportDate } from '@/lib/report-date';

async function preparePastedImages(formData: FormData, markdown: string, errorUrl: string) {
  try {
    const pending = pendingPastedImages(formData, markdown);
    const stored = pending.length ? await saveImageAttachments(pending.map((image) => image.file)) : [];
    return { pending, stored };
  } catch { redirect(errorUrl); }
}

export async function createWorkLog(formData: FormData) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) redirect('/');

  const markdownMode = formData.has('markdownContent');
  const markdown = String(formData.get('markdownContent') ?? '');
  if (markdownMode && markdown.length > maxMarkdownCharacters) redirect('/console/logs/new?error=too-long');
  const input = markdownMode ? parseMarkdownWorkLog(markdown) : logInput(formData);
  if (!input || !input.title || (!markdownMode && !input.completed.length)) redirect('/console/logs/new?error=required');
  let reportDate: string;
  try { reportDate = resolveReportDate(String(formData.get('reportDate') ?? '')); }
  catch { redirect('/console/logs/new?error=date'); }

  const { pending, stored } = await preparePastedImages(formData, markdown, '/console/logs/new?error=image');
  const database = createDatabase();
  try {
    database.transaction(() => {
      const { log } = database.upsertDailyWorkLog(user.id, { reportDate, ...input });
      if (pending.length) {
        const attachments = database.addWorkLogAttachments(log.id, stored);
        database.setWorkLogMarkdown(log.id, replacePastedImageSources(markdown, pending, attachments));
      }
    });
  } catch (error) {
    await removeImageAttachments(stored.map((image) => image.storageKey));
    throw error;
  } finally { database.close(); }
  redirect('/console/my-logs?created=1');
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
  try {
    database.transaction(() => {
      database.updateWorkLog(id, user.id, user.role!, input);
      if (pending.length) {
        const attachments = database.addWorkLogAttachments(id, stored);
        database.setWorkLogMarkdown(id, replacePastedImageSources(markdown, pending, attachments));
      }
    });
  } catch (error) {
    await removeImageAttachments(stored.map((image) => image.storageKey));
    throw error;
  } finally { database.close(); }
  redirect(`/console/logs/${id}${from ? `?from=${from}` : ''}`);
}

export async function deleteWorkLog(formData: FormData) {
  const user = (await auth())?.user; const id = String(formData.get('id') ?? '');
  if (!user?.id || !user.role || !id) redirect('/console');
  const database = createDatabase();
  try { database.deleteWorkLog(id, user.id, user.role); } finally { database.close(); }
  redirect(formData.get('returnTo') === 'admin' ? '/console/admin/logs' : '/console/my-logs');
}
