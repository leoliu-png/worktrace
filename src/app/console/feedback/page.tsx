import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { FeedbackForm } from '@/components/feedback-form';
import { FeedbackFilter, FeedbackList, FeedbackPagination } from '@/components/feedback-list';
import { createDatabase } from '@/lib/db';
import { feedbackStatuses } from '@/lib/feedback';
import { currentLocale } from '@/lib/locale-server';
import { currentConsoleUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ status?: string; cursor?: string }> }) {
  const user = await currentConsoleUser();
  if (!user) redirect('/');
  const locale = await currentLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const query = await searchParams;
  const status = feedbackStatuses.find((value) => value === query.status);
  const database = createDatabase();
  let result;
  try { result = database.listFeedback(user.id, { status, cursor: query.cursor }); }
  finally { database.close(); }
  return <ConsolePageFrame title="建议反馈" activePath="/console/feedback">
    <div className="wt-page-actions"><p className="wt-description">{text('分享使用中的问题和改进建议，帮助 WorkTrace 更好地记录工作。', 'Share problems and improvement ideas to make WorkTrace better.')}</p>{user.role === 'ADMIN' && <Link className="wt-secondary-button" href="/console/admin/feedback">{text('管理所有反馈', 'Manage all feedback')}</Link>}</div>
    <div className="wt-feedback-layout">
      <section className="wt-panel wt-feedback-create"><h2>{text('提交建议', 'Submit feedback')}</h2><FeedbackForm locale={locale} /></section>
      <section className="wt-feedback-history"><div className="wt-feedback-heading"><h2>{text('我的反馈', 'My feedback')}</h2><FeedbackFilter path="/console/feedback" status={status} locale={locale} /></div><FeedbackList items={result.items} locale={locale} /><FeedbackPagination path="/console/feedback" cursor={query.cursor} nextCursor={result.nextCursor} status={status} locale={locale} /></section>
    </div>
  </ConsolePageFrame>;
}
