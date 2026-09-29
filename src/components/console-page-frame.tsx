import { redirect } from 'next/navigation';
import { currentConsoleUser } from '@/lib/session';
import { ConsoleShell } from './console-shell';
import { currentLocale } from '@/lib/locale-server';
import type { OverviewPeriod } from '@/lib/worktrace-data';

type ConsolePageFrameProps = {
  title: string;
  eyebrow?: string;
  activePath?: string;
  administratorOnly?: boolean;
  overviewPeriod?: OverviewPeriod;
  compactViewport?: boolean;
  children: React.ReactNode;
};

export async function ConsolePageFrame({ administratorOnly = false, ...props }: ConsolePageFrameProps) {
  const user = await currentConsoleUser();
  if (!user) redirect('/');
  if (administratorOnly && user.role !== 'ADMIN') redirect('/console');
  return <ConsoleShell {...props} role={user.role} user={user} locale={await currentLocale()}>{props.children}</ConsoleShell>;
}
