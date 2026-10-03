import Link from 'next/link';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { MobiusSyncResults } from '@/components/mobius-sync-results';
import { createDatabase } from '@/lib/db';
import { currentConsoleUser } from '@/lib/session';
import { currentLocale } from '@/lib/locale-server';

export const dynamic = 'force-dynamic';

export default async function IssueMatchesPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const user = await currentConsoleUser();
  if (!user) return null;
  const locale = await currentLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const { cursor } = await searchParams;
  const database = createDatabase();
  let result;
  try { result = database.listMobiusSyncRuns(user.id, { limit: 25, cursor }); }
  finally { database.close(); }
  return <ConsolePageFrame title="Issue 匹配结果" eyebrow="查看日志与 Mobius Issue 的匹配和评论记录" activePath="/console/issue-matches">
    {cursor && <div className="wt-page-actions"><Link href="/console/issue-matches">{text('查看最新结果', 'View latest results')}</Link></div>}
    <MobiusSyncResults runs={result.items} locale={locale} history />
    {result.nextCursor && <Link className="wt-next-page" href={`/console/issue-matches?cursor=${encodeURIComponent(result.nextCursor)}`}>{text('更早的结果 →', 'Earlier results →')}</Link>}
  </ConsolePageFrame>;
}
