import { ConsolePageFrame } from '@/components/console-page-frame';
import { createDatabase } from '@/lib/db';
import { currentConsoleUser } from '@/lib/session';

type PageProps = { searchParams: Promise<{ q?: string }> };

export default async function AuditPage({ searchParams }: PageProps) {
  const currentUser = await currentConsoleUser();
  if (!currentUser || currentUser.role !== 'ADMIN') return <ConsolePageFrame title="安全审计" activePath="/console/admin/audit" administratorOnly><p /></ConsolePageFrame>;

  const query = ((await searchParams).q ?? '').trim().toLocaleLowerCase();
  const database = createDatabase();
  const users = new Map(database.listUsers().map((user) => [user.id, user]));
  const events = database.listAuditEvents();
  database.close();
  const filteredEvents = !query ? events : events.filter((event) => [users.get(event.actorId)?.name, users.get(event.actorId)?.email, event.type, event.targetType].filter(Boolean).some((value) => value!.toLocaleLowerCase().includes(query)));

  return <ConsolePageFrame title="安全审计" activePath="/console/admin/audit" administratorOnly>
    <div className="wt-page-actions wt-admin-page-actions"><p className="wt-description">追溯登录、权限变更、API Key 和日志敏感操作。</p><form className="wt-inline-search" action="/console/admin/audit"><input name="q" defaultValue={query} placeholder="搜索操作者、事件或目标" aria-label="搜索安全审计" /><button type="submit">搜索</button></form></div>
    <section className="wt-panel wt-admin-table wt-audit-table"><div className="wt-table-header"><span>时间</span><span>操作者</span><span>事件</span><span>目标</span></div>{filteredEvents.map((event) => <div className="wt-table-row" key={event.id}><span>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.createdAt))}</span><span>{users.get(event.actorId)?.email ?? '未知成员'}</span><code>{event.type}</code><span>{event.targetType}</span></div>)}</section>
  </ConsolePageFrame>;
}
