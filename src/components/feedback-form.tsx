'use client';

import { useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { reviewFeedback, submitFeedback } from '@/app/actions/feedback';
import { feedbackCategories, feedbackStatuses, feedbackHandlingModes, feedbackCategoryLabel, feedbackStatusLabel, feedbackHandlingLabel, feedbackErrorMessage, agentTaskInstructions, type FeedbackActionState, type FeedbackCategory, type FeedbackStatus, type FeedbackHandlingMode } from '@/lib/feedback';
import { clearFeedbackDraft, emptyFeedbackDraft, getFeedbackDraftRevision, readFeedbackDraft, saveFeedbackDraft, subscribeFeedbackDraft, type FeedbackDraft } from '@/lib/feedback-draft';
import type { Locale } from '@/lib/locale';

const initialState: FeedbackActionState = {};

function SubmitButton({ pending, locale, reviewing = false }: { pending: boolean; locale: Locale; reviewing?: boolean }) {
  const label = reviewing ? (locale === 'zh' ? '保存处理结果' : 'Save review') : (locale === 'zh' ? '提交反馈' : 'Submit feedback');
  return <button className="wt-primary-button wt-feedback-submit" type="submit" disabled={pending} aria-busy={pending}>
    {pending && <span className="wt-loading-spinner" aria-hidden="true" />}
    {pending ? (locale === 'zh' ? '正在保存…' : 'Saving…') : label}
  </button>;
}

export function FeedbackForm({ locale, userId }: { locale: Locale; userId: string }) {
  return <FeedbackDraftForm key={userId} locale={locale} userId={userId} />;
}

function FeedbackDraftForm({ locale, userId }: { locale: Locale; userId: string }) {
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [draft, setDraft] = useState<FeedbackDraft>(emptyFeedbackDraft);
  const draftRef = useRef(draft);
  const [draftReady, setDraftReady] = useState(false);
  const [state, setState] = useState<FeedbackActionState>(initialState);
  const [pending, setPending] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const restoreDraft = () => {
      const restored = readFeedbackDraft(userId) ?? emptyFeedbackDraft();
      draftRef.current = restored;
      setDraft(restored);
    };
    // A submission can finish in an unmounted instance after this one restores its draft.
    const unsubscribe = subscribeFeedbackDraft(userId, restoreDraft);
    restoreDraft();
    setDraftReady(true);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [userId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // A form action automatically resets native controls even when it returns an error.
    // Handle submission explicitly so only confirmed success clears the saved draft.
    event.preventDefault();
    if (!draftReady || submittingRef.current) return;
    const formData = new FormData(event.currentTarget);
    const submittedDraft = { ...draftRef.current };
    const submittedRevision = getFeedbackDraftRevision(userId);
    const previousState = state;
    submittingRef.current = true;
    setPending(true);
    setState(initialState);
    try {
      const result = await submitFeedback(previousState, formData);
      // Clear on confirmed success even when navigation has unmounted this form.
      // The revision guard and subscription reset A but preserve later edits in B.
      if (result.createdId) clearFeedbackDraft(userId, submittedDraft, submittedRevision);
      if (mountedRef.current) setState(result);
    } catch {
      // Keep the form editable and the draft intact when the server action rejects.
      if (mountedRef.current) setState({ error: 'save_failed' });
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }

  function updateDraft(update: Partial<FeedbackDraft>) {
    const next = { ...draftRef.current, ...update };
    draftRef.current = next;
    setDraft(next);
    // Save in the input event, with no deferred effect or unmount write to race navigation.
    saveFeedbackDraft(userId, next);
  }

  const { category, title, description } = draft;
  return <form className="wt-feedback-form" onSubmit={handleSubmit} aria-busy={pending}>
    <fieldset disabled={pending || !draftReady}>
      <label><span>{text('反馈类型', 'Category')}</span><select name="category" value={category} onChange={(event) => updateDraft({ category: event.target.value as FeedbackCategory })}>{feedbackCategories.map((value) => <option key={value} value={value}>{feedbackCategoryLabel(value, locale)}</option>)}</select></label>
      <label><span>{text('标题', 'Title')}</span><input name="title" value={title} onChange={(event) => updateDraft({ title: event.target.value })} required maxLength={120} placeholder={text('例如：希望支持导出每周日志', 'For example: export weekly work logs')} /></label>
      <label><span>{text('详细说明', 'Details')}</span><textarea name="description" value={description} onChange={(event) => updateDraft({ description: event.target.value })} required maxLength={5000} rows={7} placeholder={text('描述遇到的问题、使用场景或期望的改进效果。如有问题，请写下复现步骤。', 'Describe the problem, use case, or improvement you would like. Include reproduction steps for bugs.')} /><small>{description.length} / 5,000</small></label>
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
        <label><span>{text('处理方式', 'Handled by')}</span><select name="handlingMode" value={mode} onChange={(event) => { const nextMode = event.target.value as FeedbackHandlingMode; setMode(nextMode); if (nextMode === 'AGENT') setInstructions(agentTaskInstructions(instructions)); setRequestAgent(false); }}>{feedbackHandlingModes.map(value => <option key={value} value={value}>{feedbackHandlingLabel(value, locale)}</option>)}</select></label>
        <p className="wt-feedback-hint">{mode === 'HUMAN' ? text('带有“人工处理”标记的反馈会被 Agent 跳过。正在执行的步骤结束后停止后续处理。', 'The Agent skips human-handled feedback and stops after the current step.') : text('当前选择 Agent 处理后，未完成的反馈会继续执行，包括重复建议；历史转人工记录不影响本次选择。自动运行暂停时，可手动触发。', 'Agent handling continues unfinished feedback, including repeated suggestions. Historical handoffs do not override this choice. When paused, trigger it manually.')}</p>
        {mode === 'AGENT' && <label><span><input type="checkbox" name="requestAgent" checked={handBack || requestAgent} disabled={handBack} onChange={event => setRequestAgent(event.target.checked)} /> {text('根据补充要求，让 Agent 再处理一轮', 'Request another Agent cycle using the instructions below')}</span></label>}
        <label><span>{text('给 Agent 的补充要求 / 验收反馈（选填）', 'Agent instructions / acceptance feedback (optional)')}</span><textarea name="agentInstructions" rows={3} maxLength={3000} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder={text('可补充复现步骤或期望效果；不填写时，按原始建议和历史问题继续处理。', 'Add reproduction steps or expected results. Leave blank to continue from the original feedback and recorded findings.')} /></label>
        <label><span>{text('处理回复', 'Reply')}</span><textarea name="reply" rows={3} maxLength={3000} value={response} onChange={(event) => setResponse(event.target.value)} placeholder={text('说明处理进展、计划或暂不采纳的原因，提交者可查看。', 'Share progress, plans, or the reason this is not planned. The submitter can see your reply.')} /></label>
        <SubmitButton pending={pending} locale={locale} reviewing />
      </fieldset>
      {state.error && <p className="wt-form-error" role="alert">{feedbackErrorMessage(state.error, locale)}</p>}
      {state.saved && <p className="wt-feedback-success" role="status">{text('处理结果已保存，Agent 会在下一次读取反馈时同步处理方式。', 'Saved. The Agent will sync the handling mode on its next feedback poll.')}</p>}
    </form>
  </details>;
}
