export function consoleLoadingMessage(pathname: string) {
  if (pathname === '/console') return '正在加载概览…';
  if (pathname === '/console/logs') return '正在加载全部日志…';
  if (pathname === '/console/logs/new') return '正在加载新建日志…';
  if (pathname === '/console/api-keys') return '正在加载 API 密钥…';
  if (pathname === '/console/my-logs') return '正在加载我的日志…';
  if (pathname === '/console/admin/members') return '正在加载成员管理…';
  if (pathname === '/console/admin/logs') return '正在加载日志管理…';
  if (pathname === '/console/admin/audit') return '正在加载安全审计…';
  return '正在加载页面内容…';
}

export function pendingNavigationClass(currentClassName: string, destination: string | null, href: string) {
  if (!destination) return currentClassName;
  const baseClasses = currentClassName.split(/\s+/).filter((className) => className && className !== 'active');
  return [...baseClasses, destination === href ? 'active' : ''].filter(Boolean).join(' ');
}
