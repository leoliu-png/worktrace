import { redirect } from 'next/navigation';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { FeedbackFilter, FeedbackList, FeedbackPagination } from '@/components/feedback-list';
import { createDatabase } from '@/lib/db';
import { feedbackStatuses } from '@/lib/feedback';
import { currentLocale } from '@/lib/locale-server';
import { currentConsoleUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function FeedbackManagementPage({ searchParams }: { searchParams: Promise<{ status?: string; cursor?: string }> }) {
  const user = await currentConsoleUser();
  if (!user) redirect('/');
  if (user.role !== 'ADMIN') redirect('/console');
  const locale = await currentLocale();
  const query = await searchParams;
  const status = feedbackStatuses.find((value) => value === query.status);
  const database = createDatabase();
  let result;
  try { result = database.listFeedback(user.id, { all: true, status, cursor: query.cursor }); }
  finally { database.close(); }
  return <ConsolePageFrame title="反馈管理" activePath="/console/admin/feedback" administratorOnly>
    <div className="wt-page-actions"><p className="wt-description">{locale === 'zh' ? '查看用户的建议与问题，回复处理进展并更新状态。' : 'Review suggestions and problems, reply to users, and update progress.'}</p><FeedbackFilter path="/console/admin/feedback" status={status} locale={locale} /></div>
    <FeedbackList items={result.items} locale={locale} administrator />
    <FeedbackPagination path="/console/admin/feedback" cursor={query.cursor} nextCursor={result.nextCursor} status={status} locale={locale} />
  </ConsolePageFrame>;
}
