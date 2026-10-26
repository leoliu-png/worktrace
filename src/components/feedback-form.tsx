'use client';

import { useActionState, useEffect, useState } from 'react';
import { reviewFeedback, submitFeedback } from '@/app/actions/feedback';
import { feedbackCategories, feedbackStatuses, feedbackHandlingModes, feedbackCategoryLabel, feedbackStatusLabel, feedbackHandlingLabel, feedbackErrorMessage, type FeedbackActionState, type FeedbackCategory, type FeedbackStatus, type FeedbackHandlingMode } from '@/lib/feedback';
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

export function FeedbackReviewForm({ feedbackId, status, reply, handlingMode, agentRevision, agentInstructions, locale }: { feedbackId: string; status: FeedbackStatus; reply: string; handlingMode: FeedbackHandlingMode; agentRevision: number; agentInstructions: string; locale: Locale }) {
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [state, action, pending] = useActionState(reviewFeedback, initialState);
  const [selectedStatus, setSelectedStatus] = useState(status);
  const [response, setResponse] = useState(reply);
  const [mode, setMode] = useState(handlingMode);
  const [instructions, setInstructions] = useState(agentInstructions);
  const [requestAgent, setRequestAgent] = useState(false);
  useEffect(() => { setSelectedStatus(status); setResponse(reply); setMode(handlingMode); setInstructions(agentInstructions); setRequestAgent(false); }, [status, reply, handlingMode, agentRevision, agentInstructions]);
  const handBack = mode === 'AGENT' && handlingMode === 'HUMAN';
  return <details className="wt-feedback-review"><summary>{text('处理这条反馈', 'Review this feedback')}</summary>
    <form className="wt-feedback-form" action={action} aria-busy={pending}>
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <input type="hidden" name="agentRevision" value={agentRevision} />
      <fieldset disabled={pending}>
        <label><span>{text('处理状态', 'Status')}</span><select name="status" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as FeedbackStatus)}>{feedbackStatuses.map((value) => <option key={value} value={value}>{feedbackStatusLabel(value, locale)}</option>)}</select></label>
        <label><span>{text('处理方式', 'Handled by')}</span><select name="handlingMode" value={mode} onChange={(event) => { setMode(event.target.value as FeedbackHandlingMode); setRequestAgent(false); }}>{feedbackHandlingModes.map(value => <option key={value} value={value}>{feedbackHandlingLabel(value, locale)}</option>)}</select></label>
        <p className="wt-feedback-hint">{mode === 'HUMAN' ? text('带有“人工处理”标记的反馈会被 Agent 跳过。正在执行的步骤结束后停止后续处理。', 'The Agent skips human-handled feedback and stops after the current step.') : text('待处理、处理中的反馈均可由 Agent 处理；自动运行暂停时，可到自动优化中手动触发。', 'The Agent can process Pending and In progress feedback. When paused, trigger it from Automatic improvement.')}</p>
        {mode === 'AGENT' && <label><span><input type="checkbox" name="requestAgent" checked={handBack || requestAgent} disabled={handBack} onChange={event => setRequestAgent(event.target.checked)} /> {text('根据补充要求，让 Agent 再处理一轮', 'Request another Agent cycle using the instructions below')}</span></label>}
        <label><span>{text('给 Agent 的补充要求 / 验收反馈', 'Agent instructions / acceptance feedback')}</span><textarea name="agentInstructions" rows={3} maxLength={3000} minLength={mode === 'AGENT' && (handBack || requestAgent) ? 8 : undefined} required={mode === 'AGENT' && (handBack || requestAgent)} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder={text('写明未通过的原因、复现步骤和期望效果；重新交给 Agent 时至少填写 8 字。', 'Describe the failure, reproduction steps and expected result (at least 8 characters for a new cycle).')} /></label>
        <label><span>{text('处理回复', 'Reply')}</span><textarea name="reply" rows={3} maxLength={3000} value={response} onChange={(event) => setResponse(event.target.value)} placeholder={text('说明处理进展、计划或暂不采纳的原因，提交者可查看。', 'Share progress, plans, or the reason this is not planned. The submitter can see your reply.')} /></label>
        <SubmitButton pending={pending} locale={locale} reviewing />
      </fieldset>
      {state.error && <p className="wt-form-error" role="alert">{feedbackErrorMessage(state.error, locale)}</p>}
      {state.saved && <p className="wt-feedback-success" role="status">{text('处理结果已保存，Agent 会在下一次读取反馈时同步处理方式。', 'Saved. The Agent will sync the handling mode on its next feedback poll.')}</p>}
    </form>
  </details>;
}
