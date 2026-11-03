'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { removeImageAttachments, saveImageAttachments } from '@/lib/attachments';
import { createDatabase } from '@/lib/db';
import { feedbackInputSchema, feedbackReviewSchema, type FeedbackActionState } from '@/lib/feedback';

function refreshFeedback() {
  revalidatePath('/console/feedback');
  revalidatePath('/console/admin/feedback');
  revalidatePath('/console/admin/audit');
}

export async function submitFeedback(_state: FeedbackActionState, formData: FormData): Promise<FeedbackActionState> {
  const user = (await auth())?.user;
  if (!user?.id) return { error: 'session' };
  const input = feedbackInputSchema.safeParse({ category: formData.get('category'), title: formData.get('title'), description: formData.get('description') });
  if (!input.success) return { error: input.error.issues[0].path[0]?.toString() ?? 'save_failed' };
  const values = formData.getAll('images');
  if (values.some(value => !(value instanceof File)) || values.length > 5) return { error: 'images' };
  const files = values.filter((value): value is File => value instanceof File && value.size > 0);
  let images: Awaited<ReturnType<typeof saveImageAttachments>>;
  try { images = files.length ? await saveImageAttachments(files) : []; }
  catch { return { error: 'images' }; }
  let database: ReturnType<typeof createDatabase> | undefined;
  let id: string;
  try { database = createDatabase(); id = database.createFeedback(user.id, input.data, images).id; }
  catch { await removeImageAttachments(images.map(image => image.storageKey)).catch(() => {}); return { error: 'save_failed' }; }
  finally { database?.close(); }
  refreshFeedback();
  return { createdId: id };
}

export async function reviewFeedback(_state: FeedbackActionState, formData: FormData): Promise<FeedbackActionState> {
  const user = (await auth())?.user;
  if (!user?.id) return { error: 'session' };
  if (user.role !== 'ADMIN') return { error: 'permission' };
  const id = String(formData.get('feedbackId') ?? '');
  if (!id) return { error: 'not_found' };
  const input = feedbackReviewSchema.safeParse({ status: formData.get('status'), reply: formData.get('reply'), handlingMode: formData.get('handlingMode'), requestAgent: formData.get('requestAgent') === 'on', agentInstructions: formData.get('agentInstructions'), expectedAgentRevision: Number(formData.get('agentRevision')), agentRequestKey: `admin:${id}:${formData.get('agentRevision')}` });
  if (!input.success) return { error: input.error.issues[0].path[0]?.toString() ?? 'save_failed' };
  const database = createDatabase();
  try { database.reviewFeedback(id, user.id, input.data); }
  catch (error) {
    if (error instanceof Error && error.message === 'Feedback has changed') return { error: 'stale' };
    if (error instanceof Error && error.message === 'Agent instructions are required') return { error: 'agent_note' };
    return { error: error instanceof Error && error.message === 'Feedback was not found' ? 'not_found' : error instanceof Error && error.message === 'Administrator access is required' ? 'permission' : 'save_failed' };
  } finally { database.close(); }
  refreshFeedback();
  return { saved: true };
}
