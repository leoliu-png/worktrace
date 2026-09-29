export type AppRole = 'MEMBER' | 'ADMIN';

const memberNavigation = [
  { id: 'overview', href: '/console', label: '概览' },
  { id: 'logs', href: '/console/logs', label: '工作日志' },
  { id: 'new-log', href: '/console/logs/new', label: '新建日志' },
  { id: 'api-keys', href: '/console/api-keys', label: 'API Keys' },
  { id: 'my-logs', href: '/console/my-logs', label: '我的日志' },
];

const adminNavigation = [
  { id: 'members', href: '/console/admin/members', label: '成员管理' },
  { id: 'access', href: '/console/admin/access', label: '权限控制' },
  { id: 'admin-logs', href: '/console/admin/logs', label: '日志管理' },
  { id: 'audit', href: '/console/admin/audit', label: '安全审计' },
];

export const isAdminEmail = (email?: string | null) => (process.env.ADMIN_EMAILS ?? 'linden@feedmob.com').split(',').map((item) => item.trim().toLowerCase()).includes(email?.toLowerCase() ?? '');
export const visibleNavigation = (role: AppRole) => role === 'ADMIN' ? [...memberNavigation, ...adminNavigation] : memberNavigation;
export const canManage = (role: AppRole) => role === 'ADMIN';
