import { ConsolePageFrame } from '@/components/console-page-frame';
import { changeMemberRole, deleteMember } from '@/app/actions/admin';
import { createDatabase } from '@/lib/db';
import { currentConsoleUser } from '@/lib/session';
import { currentLocale } from '@/lib/locale-server';

export default async function MembersPage() {
  const currentUser = await currentConsoleUser();
  if (!currentUser || currentUser.role !== 'ADMIN') return <ConsolePageFrame title="成员管理" activePath="/console/admin/members" administratorOnly><p /></ConsolePageFrame>;
  const locale = await currentLocale(); const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const database = createDatabase(); const members = database.listUsers(); database.close();
  return <ConsolePageFrame title="成员管理" activePath="/console/admin/members" administratorOnly>
    <p className="wt-description">{text('管理 FeedMob 工作轨迹成员与管理员角色。最后一位管理员不能被降级或删除。', 'Manage members and administrator roles. The final administrator cannot be demoted or removed.')}</p><section className="wt-panel wt-admin-table wt-member-table"><div className="wt-table-header"><span>{text('成员', 'Member')}</span><span>{text('角色', 'Role')}</span><span>{text('状态', 'Status')}</span><span>{text('操作', 'Actions')}</span></div>{members.map((member) => <div className="wt-table-row" key={member.id}><div><strong>{member.name}</strong><small>{member.email}</small></div><span className="wt-status">{member.role === 'ADMIN' ? text('管理员', 'Administrator') : text('成员', 'Member')}</span><span>{text('已启用', 'Active')}</span><div className="wt-member-actions"><form action={changeMemberRole}><input type="hidden" name="userId" value={member.id} /><input type="hidden" name="role" value={member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN'} /><button className="wt-member-role-button" type="submit">{member.role === 'ADMIN' ? text('降为成员', 'Make member') : text('设为管理员', 'Make administrator')}</button></form>{member.id !== currentUser.id && <form action={deleteMember}><input type="hidden" name="userId" value={member.id} /><button className="wt-danger-link" type="submit">{text('删除成员', 'Delete member')}</button></form>}</div></div>)}</section>
  </ConsolePageFrame>;
}
