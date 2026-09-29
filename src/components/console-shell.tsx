import Link from 'next/link';
import { visibleNavigation, type AppRole } from '@/lib/access';
import { AccountMenu } from './account-menu';
import { LanguageToggle } from './language-toggle';
import { localize, translate as t, type Locale } from '@/lib/locale';
import { OverviewPeriodSelect } from './overview-period-select';
import { ConsoleContentLoading, ConsoleNavigationLink, ConsoleNavigationProgress } from './console-navigation-progress';
import type { OverviewPeriod } from '@/lib/worktrace-data';

type ConsoleShellProps = {
  title: string;
  eyebrow?: string;
  activePath?: string;
  role?: AppRole;
  user: { name: string; email: string; image: string | null };
  locale: Locale;
  overviewPeriod?: OverviewPeriod;
  compactViewport?: boolean;
  children: React.ReactNode;
};

export function ConsoleShell({ title, eyebrow = 'WORKTRACE CONSOLE', activePath, role = 'MEMBER', user, locale, overviewPeriod = 'week', compactViewport = false, children }: ConsoleShellProps) {
  const navigation = visibleNavigation(role);
  const labelFor = (id: string) => t(locale, ({ overview: 'overview', logs: 'logs', 'new-log': 'newLog', 'api-keys': 'apiKeys', 'my-logs': 'myLogs', members: 'members', access: 'access', 'admin-logs': 'adminLogs', audit: 'audit' } as const)[id as keyof { overview: 'overview'; logs: 'logs'; 'new-log': 'newLog'; 'api-keys': 'apiKeys'; 'my-logs': 'myLogs'; members: 'members'; access: 'access'; 'admin-logs': 'adminLogs'; audit: 'audit' }]);

  return <ConsoleNavigationProgress><div className={`stitch-console${compactViewport ? ' wt-compact-viewport' : ''}`}>
    <aside className="stitch-sidebar"><Link className="stitch-sidebar-brand" href="/"><span aria-hidden>▣</span><b>WorkTrace</b></Link><ConsoleNavigationLink className="stitch-new-log" href="/console/logs/new">＋ {t(locale, 'newLog')}</ConsoleNavigationLink><nav aria-label="控制台导航">{navigation.map((item) => <ConsoleNavigationLink key={item.href} className={activePath === item.href ? 'active' : ''} href={item.href}><span>{item.id === 'overview' ? '▦' : item.id === 'logs' ? '☷' : item.id === 'my-logs' ? '◉' : item.id === 'api-keys' ? '⌘' : '◇'}</span>{labelFor(item.id)}</ConsoleNavigationLink>)}</nav></aside>
    <main className="stitch-console-main"><header className="console-topbar"><div /><div className="console-topbar-actions"><Link className="console-home-link" href="/">{locale === 'zh' ? '首页' : 'Home'}</Link><LanguageToggle locale={locale} /><AccountMenu {...user} /></div></header><div className="stitch-console-content"><div className="stitch-console-title"><div><h2>{title === '概览' ? (locale === 'zh' ? '概览控制台' : 'Overview') : localize(locale, title)}</h2><p>{title === '概览' ? (locale === 'zh' ? '监控团队工作进展与日志统计' : 'Monitor team progress and work-log activity') : localize(locale, eyebrow)}</p></div>{title === '概览' && <OverviewPeriodSelect locale={locale} period={overviewPeriod} />}</div>{children}<ConsoleContentLoading /></div></main>
  </div></ConsoleNavigationProgress>;
}
