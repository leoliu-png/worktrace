import { ConsolePageFrame } from '@/components/console-page-frame';
import { LogList } from '@/components/log-list';
import { createDatabase } from '@/lib/db';
import { currentConsoleUser } from '@/lib/session';
import type { WorkTraceLog } from '@/lib/worktrace-data';

type PageProps = { searchParams: Promise<{ q?: string }> };

export default async function AdminLogsPage({ searchParams }: PageProps) {
  const user = await currentConsoleUser();
  if (!user) return null;
  const query = (await searchParams).q ?? '';
  const database = createDatabase();
  const people = new Map(database.listUsers().map((person) => [person.id, person]));
  const result = database.queryWorkLogs({ query, limit: 50 });
  database.close();
  const logs: WorkTraceLog[] = result.items.map((log) => ({ ...log, authorName: people.get(log.authorId)?.name ?? '未知成员', authorEmail: people.get(log.authorId)?.email ?? 'unknown@feedmob.com' }));

  return <ConsolePageFrame title="日志管理" activePath="/console/admin/logs" administratorOnly>
    <div className="wt-page-actions wt-admin-page-actions"><p className="wt-description">查询、删除团队全部已发布工作日志。</p><form className="wt-inline-search" action="/console/admin/logs"><input name="q" defaultValue={query} placeholder="搜索标题、内容或提交人" aria-label="搜索日志" /><button type="submit">搜索</button></form></div>
    <section className="wt-panel wt-log-scroll-panel"><div className="wt-list-labels wt-list-labels-management"><span>工作日志</span><span>提交人</span><span>日期</span><span>来源</span><span>操作</span></div><LogList logs={logs} management /></section>
  </ConsolePageFrame>;
}
