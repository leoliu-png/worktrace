'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
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
  const database = createDatabase();
  let id: string;
  try { id = database.createFeedback(user.id, input.data).id; }
  catch { return { error: 'save_failed' }; }
  finally { database.close(); }
  refreshFeedback();
  return { createdId: id };
}

export async function reviewFeedback(_state: FeedbackActionState, formData: FormData): Promise<FeedbackActionState> {
  const user = (await auth())?.user;
  if (!user?.id) return { error: 'session' };
  if (user.role !== 'ADMIN') return { error: 'permission' };
  const id = String(formData.get('feedbackId') ?? '');
  if (!id) return { error: 'not_found' };
  const input = feedbackReviewSchema.safeParse({ status: formData.get('status'), reply: formData.get('reply') });
  if (!input.success) return { error: input.error.issues[0].path[0]?.toString() ?? 'save_failed' };
  const database = createDatabase();
  try { database.reviewFeedback(id, user.id, input.data); }
  catch (error) {
    return { error: error instanceof Error && error.message === 'Feedback was not found' ? 'not_found' : error instanceof Error && error.message === 'Administrator access is required' ? 'permission' : 'save_failed' };
  } finally { database.close(); }
  refreshFeedback();
  return { saved: true };
}
