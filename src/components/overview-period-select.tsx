'use client';

import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/locale';
import type { OverviewPeriod } from '@/lib/worktrace-data';

export function OverviewPeriodSelect({ locale, period }: { locale: Locale; period: OverviewPeriod }) {
  const router = useRouter();
  const labels = locale === 'zh'
    ? { today: '今天', week: '本周', month: '本月' }
    : { today: 'Today', week: 'This week', month: 'This month' };
  return <select aria-label={locale === 'zh' ? '日期范围' : 'Date range'} value={period} onChange={(event) => router.push(`/console?period=${event.target.value}`)}>
    {(Object.keys(labels) as OverviewPeriod[]).map((value) => <option value={value} key={value}>{labels[value]}</option>)}
  </select>;
}
