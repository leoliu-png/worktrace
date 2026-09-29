import Link from 'next/link';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { LogList } from '@/components/log-list';
import { createDatabase } from '@/lib/db';
import { reportDateRange } from '@/lib/report-date';
import { currentConsoleUser } from '@/lib/session';
import type { LogDateRange, WorkTraceLog } from '@/lib/worktrace-data';

type PageProps = { searchParams: Promise<{ q?: string; member?: string; range?: LogDateRange; cursor?: string }> };

export default async function LogsPage({ searchParams }: PageProps) {
  const user = await currentConsoleUser(); if (!user) return null;
  const { q: query = '', member = 'all', range = 'all', cursor } = await searchParams;
  const selectedRange: LogDateRange = ['today', 'week', 'month'].includes(range) ? range : 'all';
  const db = createDatabase(); const members = db.listUsers(); const result = db.queryWorkLogs({ authorId: member === 'all' ? undefined : member, query, cursor, limit: 50, ...reportDateRange(selectedRange) }); db.close();
  const people = new Map(members.map((person) => [person.id, person]));
  const logs: WorkTraceLog[] = result.items.map((log) => ({ ...log, authorName: people.get(log.authorId)?.name ?? '未知成员', authorEmail: people.get(log.authorId)?.email ?? 'unknown@feedmob.com' }));
  const nextHref = result.nextCursor ? `/console/logs?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(member !== 'all' ? { member } : {}), ...(selectedRange !== 'all' ? { range: selectedRange } : {}), cursor: result.nextCursor })}` : null;
  return <ConsolePageFrame title="日志列表" activePath="/console/logs" compactViewport><div className="wt-compact-page wt-log-page"><div className="wt-page-actions"><p className="wt-description">查看团队成员已发布的结构化日报。</p><Link className="wt-primary-button" href="/console/logs/new">＋ 新建日志</Link></div><form className="wt-panel wt-filter-panel" action="/console/logs"><label><span>人员</span><select name="member" defaultValue={member}><option value="all">全部成员</option>{members.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label><span>日期范围</span><select name="range" defaultValue={selectedRange}><option value="all">全部时间</option><option value="today">今天</option><option value="week">本周</option><option value="month">本月</option></select></label><label className="wt-search"><span>搜索</span><input name="q" defaultValue={query} placeholder="搜索标题、内容或提交人" /></label><button className="wt-filter-submit" type="submit">搜索</button></form><section className="wt-panel wt-log-scroll-panel"><div className="wt-list-labels"><span>工作日志</span><span>提交人</span><span>日报日期</span><span>来源</span></div><LogList logs={logs} />{nextHref && <Link className="wt-next-page" href={nextHref}>下一页</Link>}</section></div></ConsolePageFrame>;
}
