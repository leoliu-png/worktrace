'use client';

import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/locale';

export function LanguageToggle({ locale }: { locale: Locale }) {
  const router = useRouter();
  function toggle() {
    const next = locale === 'zh' ? 'en' : 'zh';
    document.cookie = `worktrace-locale=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }
  return <button type="button" className="language-toggle" onClick={toggle} aria-label="Switch language">{locale === 'zh' ? '中 / EN' : 'EN / 中'}</button>;
}
