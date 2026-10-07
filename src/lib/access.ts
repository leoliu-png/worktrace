export type AppRole = 'MEMBER' | 'ADMIN';

const memberNavigation = [
  { id: 'overview', href: '/console', label: '概览' },
  { id: 'logs', href: '/console/logs', label: '工作日志' },
  { id: 'new-log', href: '/console/logs/new', label: '新建日志' },
  { id: 'api-keys', href: '/console/api-keys', label: 'API Keys' },
  { id: 'my-logs', href: '/console/my-logs', label: '我的日志' },
  { id: 'issue-matches', href: '/console/issue-matches', label: 'Issue 匹配结果' },
  { id: 'feedback', href: '/console/feedback', label: '建议反馈' },
];

const adminNavigation = [
  { id: 'members', href: '/console/admin/members', label: '成员管理' },
  { id: 'access', href: '/console/admin/access', label: '权限控制' },
  { id: 'admin-logs', href: '/console/admin/logs', label: '日志管理' },
  { id: 'audit', href: '/console/admin/audit', label: '安全审计' },
  { id: 'admin-feedback', href: '/console/admin/feedback', label: '反馈管理' },
];

export const builtInAdminEmails: readonly string[] = ['leo_liu@feedmob.com'];
export const isBuiltInAdminEmail = (email?: string | null) => builtInAdminEmails.includes(email?.trim().toLowerCase() ?? '');
export const isAdminEmail = (email?: string | null) => isBuiltInAdminEmail(email) || (process.env.ADMIN_EMAILS ?? 'linden@feedmob.com').split(',').map((item) => item.trim().toLowerCase()).includes(email?.trim().toLowerCase() ?? '');
export const visibleNavigation = (role: AppRole) => role === 'ADMIN' ? [...memberNavigation, ...adminNavigation] : memberNavigation;
export const canManage = (role: AppRole) => role === 'ADMIN';
