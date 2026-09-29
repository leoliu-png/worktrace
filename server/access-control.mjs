export const ADMIN_EMAIL = 'linden@feedmob.com';

const baseNavigation = [
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

export const roleForEmail = (email) => email?.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'member';
export const canAccessAdmin = (role) => role === 'admin';
export const navigationFor = (role) => canAccessAdmin(role) ? [...baseNavigation, ...adminNavigation] : baseNavigation;
