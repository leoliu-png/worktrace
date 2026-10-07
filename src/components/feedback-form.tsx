'use client';

import { useActionState, useEffect, useState } from 'react';
import { reviewFeedback, submitFeedback } from '@/app/actions/feedback';
import { feedbackCategories, feedbackStatuses, feedbackCategoryLabel, feedbackStatusLabel, feedbackErrorMessage, type FeedbackActionState, type FeedbackCategory, type FeedbackStatus } from '@/lib/feedback';
import type { Locale } from '@/lib/locale';

const initialState: FeedbackActionState = {};

function SubmitButton({ pending, locale, reviewing = false }: { pending: boolean; locale: Locale; reviewing?: boolean }) {
  const label = reviewing ? (locale === 'zh' ? '保存处理结果' : 'Save review') : (locale === 'zh' ? '提交反馈' : 'Submit feedback');
  return <button className="wt-primary-button wt-feedback-submit" type="submit" disabled={pending} aria-busy={pending}>
    {pending && <span className="wt-loading-spinner" aria-hidden="true" />}
    {pending ? (locale === 'zh' ? '正在保存…' : 'Saving…') : label}
  </button>;
}

export function FeedbackForm({ locale }: { locale: Locale }) {
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [state, action, pending] = useActionState(submitFeedback, initialState);
  const [category, setCategory] = useState<FeedbackCategory>('SUGGESTION');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (state.createdId) { setTitle(''); setDescription(''); setCategory('SUGGESTION'); }
  }, [state.createdId]);

  return <form className="wt-feedback-form" action={action} aria-busy={pending}>
    <fieldset disabled={pending}>
      <label><span>{text('反馈类型', 'Category')}</span><select name="category" value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}>{feedbackCategories.map((value) => <option key={value} value={value}>{feedbackCategoryLabel(value, locale)}</option>)}</select></label>
      <label><span>{text('标题', 'Title')}</span><input name="title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} placeholder={text('例如：希望支持导出每周日志', 'For example: export weekly work logs')} /></label>
      <label><span>{text('详细说明', 'Details')}</span><textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={5000} rows={7} placeholder={text('描述遇到的问题、使用场景或期望的改进效果。如有问题，请写下复现步骤。', 'Describe the problem, use case, or improvement you would like. Include reproduction steps for bugs.')} /><small>{description.length} / 5,000</small></label>
      <SubmitButton pending={pending} locale={locale} />
    </fieldset>
    {pending && <p className="wt-feedback-hint" role="status">{text('正在提交反馈，请稍候…', 'Submitting feedback, please wait…')}</p>}
    {state.error && <p className="wt-form-error" role="alert">{feedbackErrorMessage(state.error, locale)}</p>}
    {state.createdId && <p className="wt-feedback-success" role="status">{text('反馈已提交，可以在“我的反馈”中查看处理进展。', 'Feedback submitted. Track its progress in My feedback.')}</p>}
  </form>;
}

export function FeedbackReviewForm({ feedbackId, status, reply, locale }: { feedbackId: string; status: FeedbackStatus; reply: string; locale: Locale }) {
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [state, action, pending] = useActionState(reviewFeedback, initialState);
  const [selectedStatus, setSelectedStatus] = useState(status);
  const [response, setResponse] = useState(reply);
  useEffect(() => { setSelectedStatus(status); setResponse(reply); }, [status, reply]);
  return <details className="wt-feedback-review"><summary>{text('处理这条反馈', 'Review this feedback')}</summary>
    <form className="wt-feedback-form" action={action} aria-busy={pending}>
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <fieldset disabled={pending}>
        <label><span>{text('处理状态', 'Status')}</span><select name="status" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as FeedbackStatus)}>{feedbackStatuses.map((value) => <option key={value} value={value}>{feedbackStatusLabel(value, locale)}</option>)}</select></label>
        <label><span>{text('处理回复', 'Reply')}</span><textarea name="reply" rows={3} maxLength={3000} value={response} onChange={(event) => setResponse(event.target.value)} placeholder={text('说明处理进展、计划或暂不采纳的原因，提交者可查看。', 'Share progress, plans, or the reason this is not planned. The submitter can see your reply.')} /></label>
        <SubmitButton pending={pending} locale={locale} reviewing />
      </fieldset>
      {state.error && <p className="wt-form-error" role="alert">{feedbackErrorMessage(state.error, locale)}</p>}
      {state.saved && <p className="wt-feedback-success" role="status">{text('处理结果已保存。', 'Review saved.')}</p>}
    </form>
  </details>;
}
