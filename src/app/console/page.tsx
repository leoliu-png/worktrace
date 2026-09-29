import Link from 'next/link';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { LogList } from '@/components/log-list';
import { createDatabase } from '@/lib/db';
import { currentConsoleUser } from '@/lib/session';
import { loadConsoleData, type OverviewPeriod } from '@/lib/worktrace-data';
import { currentLocale } from '@/lib/locale-server';
import { formatWorkTraceDateTime } from '@/lib/time';

export default async function ConsolePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await currentConsoleUser();
  if (!user) return null;
  const requestedPeriod = (await searchParams).period;
  const locale = await currentLocale(); const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const period: OverviewPeriod = requestedPeriod === 'today' || requestedPeriod === 'month' || requestedPeriod === 'week' ? requestedPeriod : 'week';
  const database = createDatabase();
  const { overview } = loadConsoleData(database, user.id, period);
  database.close();
  return <ConsolePageFrame title="概览" activePath="/console" overviewPeriod={period}>
    <div className="wt-stats"><article><small>{text('总日志数', 'Total logs')}</small><strong>{overview.totalLogs}</strong></article><article><small>{text('活跃提交人数', 'Active submitters')}</small><strong>{overview.activeSubmitters}</strong></article><article><small>{text('今日提交数', 'Submitted today')}</small><strong>{overview.submittedToday}</strong></article><article><small>{text('最近提交时间', 'Most recent submission')}</small><strong>{overview.lastSubmittedAt ? formatWorkTraceDateTime(overview.lastSubmittedAt, locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></article></div>
    <div className="wt-overview-grid"><section className="wt-panel wt-overview-scroll-card"><div className="wt-panel-heading"><h2>{text('近期日志预览', 'Recent logs')}</h2><Link href="/console/logs">{text('查看全部', 'View all')}</Link></div><LogList logs={overview.recentLogs} /></section><section className="wt-panel wt-overview-scroll-card"><h2>{text('当日成员提交榜', 'Today’s member submissions')}</h2><div className="wt-member-submission-head"><span>{text('名称', 'Name')}</span><span>{text('状态', 'Status')}</span></div><div className="wt-member-submission-list">{overview.memberSubmissionStatus.map((member) => <div className="wt-member-submission" key={member.id}><span>{member.name}</span><strong className={member.submittedToday ? 'submitted' : 'not-submitted'}>{member.submittedToday ? text('已提交', 'Submitted') : text('未提交', 'Not submitted')}</strong></div>)}</div></section></div>
  </ConsolePageFrame>;
}
