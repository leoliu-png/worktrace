import { cookies } from 'next/headers';
import type { Locale } from './locale';

export async function currentLocale(): Promise<Locale> {
  return (await cookies()).get('worktrace-locale')?.value === 'en' ? 'en' : 'zh';
}
