import Link from 'next/link';
import { feedbackStatuses, feedbackCategoryLabel, feedbackStatusLabel, type Feedback, type FeedbackStatus } from '@/lib/feedback';
import type { Locale } from '@/lib/locale';
import { formatWorkTraceDateTime } from '@/lib/time';
import { FeedbackReviewForm } from './feedback-form';

export function FeedbackFilter({ path, status, locale }: { path: string; status?: FeedbackStatus; locale: Locale }) {
  return <form action={path} className="wt-feedback-filter">
    <label><span>{locale === 'zh' ? '处理状态' : 'Status'}</span><select name="status" defaultValue={status ?? ''}>
      <option value="">{locale === 'zh' ? '全部状态' : 'All statuses'}</option>
      {feedbackStatuses.map((value) => <option key={value} value={value}>{feedbackStatusLabel(value, locale)}</option>)}
    </select></label>
    <button className="wt-secondary-button" type="submit">{locale === 'zh' ? '筛选' : 'Filter'}</button>
  </form>;
}

export function FeedbackList({ items, locale, administrator = false }: { items: Feedback[]; locale: Locale; administrator?: boolean }) {
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const date = (value: string) => formatWorkTraceDateTime(value, locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  if (!items.length) return <div className="wt-panel wt-feedback-empty"><strong>{text('暂无反馈', 'No feedback yet')}</strong><p>{administrator ? text('当前筛选条件下没有反馈。', 'No feedback matches this filter.') : text('有改进想法或遇到问题时，可以在这里提交。', 'Share an improvement idea or report a problem here.')}</p></div>;
  return <div className="wt-feedback-list">{items.map((item) => <article className="wt-panel wt-feedback-card" key={item.id}>
    <header><div><span className="wt-feedback-category">{feedbackCategoryLabel(item.category, locale)}</span><h3>{item.title}</h3></div><span className={`wt-feedback-status wt-feedback-status-${item.status.toLowerCase()}`}>{feedbackStatusLabel(item.status, locale)}</span></header>
    <p className="wt-feedback-meta">{administrator && <span>{item.authorName} · {item.authorEmail} · </span>}{date(item.createdAt)}</p>
    <p className="wt-feedback-description">{item.description}</p>
    {item.reply && <div className="wt-feedback-reply"><strong>{text('处理回复', 'Reply')}</strong><p>{item.reply}</p><small>{date(item.updatedAt)}</small></div>}
    {administrator && <FeedbackReviewForm feedbackId={item.id} status={item.status} reply={item.reply} locale={locale} />}
  </article>)}</div>;
}

export function FeedbackPagination({ path, cursor, nextCursor, status, locale }: { path: string; cursor?: string; nextCursor: string | null; status?: FeedbackStatus; locale: Locale }) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const latest = params.size ? `${path}?${params}` : path;
  if (nextCursor) params.set('cursor', nextCursor);
  return <div className="wt-feedback-pagination">
    {cursor && <Link className="wt-secondary-button" href={latest}>{locale === 'zh' ? '最新反馈' : 'Latest feedback'}</Link>}
    {nextCursor && <Link className="wt-next-page" href={`${path}?${params}`}>{locale === 'zh' ? '更早的反馈 →' : 'Earlier feedback →'}</Link>}
  </div>;
}
