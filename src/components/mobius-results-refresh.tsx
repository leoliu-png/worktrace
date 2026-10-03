'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function MobiusResultsRefresh({ locale }: { locale: 'zh' | 'en' }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden && !pending) startTransition(() => router.refresh());
    }, 15_000);
    return () => clearInterval(interval);
  }, [router, pending]);
  return <button type="button" className="wt-issue-refresh" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
    {pending ? (locale === 'zh' ? '刷新中…' : 'Refreshing…') : (locale === 'zh' ? '刷新结果' : 'Refresh')}
  </button>;
}
