import { z } from 'zod';
import type { Locale } from './locale';

export const feedbackCategories = ['SUGGESTION', 'BUG', 'EXPERIENCE', 'OTHER'] as const;
export const feedbackStatuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'] as const;
export type FeedbackCategory = typeof feedbackCategories[number];
export type FeedbackStatus = typeof feedbackStatuses[number];

export const feedbackInputSchema = z.object({
  category: z.enum(feedbackCategories, { error: 'category' }),
  title: z.string().trim().min(1, 'title').max(120, 'title'),
  description: z.string().trim().min(1, 'description').max(5000, 'description'),
});
export const feedbackReviewSchema = z.object({
  status: z.enum(feedbackStatuses, { error: 'status' }),
  reply: z.string().trim().max(3000, 'reply'),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export type FeedbackReview = z.infer<typeof feedbackReviewSchema>;
export type Feedback = FeedbackInput & {
  id: string; authorId: string; authorName: string; authorEmail: string;
  status: FeedbackStatus; reply: string; reviewedBy: string | null;
  createdAt: string; updatedAt: string;
};
export type FeedbackActionState = { error?: string; createdId?: string; saved?: boolean };

const categories = {
  SUGGESTION: ['功能建议', 'Feature suggestion'], BUG: ['问题反馈', 'Bug report'],
  EXPERIENCE: ['使用体验', 'User experience'], OTHER: ['其他', 'Other'],
} as const;
const statuses = {
  OPEN: ['待处理', 'Pending'], IN_PROGRESS: ['处理中', 'In progress'],
  COMPLETED: ['已完成', 'Completed'], DECLINED: ['暂不采纳', 'Not planned'],
} as const;
const errors: Record<string, readonly [string, string]> = {
  session: ['登录已失效，请重新登录后提交。', 'Your session has expired. Please sign in again.'],
  permission: ['只有管理员可以处理反馈。', 'Only administrators can review feedback.'],
  title: ['请填写 1–120 字的反馈标题。', 'Enter a title between 1 and 120 characters.'],
  description: ['请填写 1–5,000 字的详细说明。', 'Enter details between 1 and 5,000 characters.'],
  category: ['请选择有效的反馈类型。', 'Choose a valid feedback category.'],
  status: ['请选择有效的处理状态。', 'Choose a valid feedback status.'],
  reply: ['处理回复不能超过 3,000 字。', 'The reply must be no more than 3,000 characters.'],
  not_found: ['这条反馈不存在，请刷新页面。', 'This feedback no longer exists. Please refresh.'],
  save_failed: ['反馈保存失败，请稍后重试。', 'Could not save feedback. Please try again.'],
};
export const feedbackCategoryLabel = (value: FeedbackCategory, locale: Locale) => categories[value][locale === 'zh' ? 0 : 1];
export const feedbackStatusLabel = (value: FeedbackStatus, locale: Locale) => statuses[value][locale === 'zh' ? 0 : 1];
export const feedbackErrorMessage = (code: string, locale: Locale) => (errors[code] ?? errors.save_failed)[locale === 'zh' ? 0 : 1];
