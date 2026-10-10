import { redirect } from 'next/navigation';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { NewWorkLogForm } from '@/components/new-work-log-form';
import { workTraceReportDate } from '@/lib/report-date';
import { currentConsoleUser } from '@/lib/session';

type PageProps = { searchParams: Promise<{ error?: string }> };

export default async function NewLogPage({ searchParams }: PageProps) {
  const user = await currentConsoleUser();
  if (!user) redirect('/');
  const today = workTraceReportDate();
  const error = (await searchParams).error;
  return <ConsolePageFrame title="新建日志" activePath="/console/logs/new">
    <p className="wt-description">提交后将立即对团队成员可见。</p>
    <NewWorkLogForm key={user.id} userId={user.id} today={today} error={error} />
  </ConsolePageFrame>;
}
