import Link from 'next/link';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { MyLogList } from '@/components/my-log-list';
import { createDatabase } from '@/lib/db';
import { currentConsoleUser } from '@/lib/session';
import type { WorkTraceLog } from '@/lib/worktrace-data';
import { currentLocale } from '@/lib/locale-server';

type PageProps = { searchParams: Promise<{ q?: string }> };

export default async function MyLogsPage({ searchParams }: PageProps) {
  const user = await currentConsoleUser();
  if (!user) return null;
  const locale = await currentLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const query = (await searchParams).q ?? '';
  const database = createDatabase();
  const person = database.listUsers().find((member) => member.id === user.id);
  const result = database.queryWorkLogs({ authorId: user.id, query, limit: 50 });
  database.close();
  const myLogs: WorkTraceLog[] = result.items.map((log) => ({ ...log, authorName: person?.name ?? user.name, authorEmail: person?.email ?? user.email }));

  return <ConsolePageFrame title="我的工作轨迹" activePath="/console/my-logs" compactViewport><div className="wt-compact-page wt-log-page">
    <div className="wt-page-actions wt-my-logs-actions">
      <p className="wt-description">{text('查看和管理您最近的工作日志条目。', 'View and manage your recent work-log entries.')}</p>
      <form className="wt-inline-search" action="/console/my-logs"><input name="q" defaultValue={query} aria-label={text('搜索我的日志', 'Search my logs')} placeholder={text('搜索我的日志…', 'Search my logs…')} /><button type="submit">{text('搜索', 'Search')}</button></form>
      <Link className="wt-primary-button" href="/console/logs/new">＋ {text('新建日志', 'New log')}</Link>
    </div>
    <section className="wt-panel wt-log-scroll-panel"><div className="wt-list-labels wt-my-log-labels"><span>{text('工作日志', 'Work log')}</span><span>{text('提交人', 'Submitted by')}</span><span>{text('日报日期', 'Report date')}</span><span>{text('操作', 'Actions')}</span></div><MyLogList logs={myLogs} /></section>
  </div></ConsolePageFrame>;
}
