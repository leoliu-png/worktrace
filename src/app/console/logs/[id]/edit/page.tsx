import { getURLFromRedirectError } from 'next/dist/client/components/redirect';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { updateWorkLog } from '@/app/actions/work-logs';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { createDatabase } from '@/lib/db';
import { workLogMarkdownContent } from '@/lib/markdown-work-log';
import { MarkdownWorkLogEditDraft, type EditLogSaveResult } from '@/lib/markdown-work-log-edit-draft';
import { currentConsoleUser } from '@/lib/session';

export default async function EditLogPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; error?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const from = query.from === 'my' || query.from === 'admin' ? query.from : 'all';
  const user = await currentConsoleUser();
  if (!user) return null;

  const database = createDatabase();
  const log = database.getWorkLog(id);
  database.close();
  if (!log || (log.authorId !== user.id && user.role !== 'ADMIN')) return <ConsolePageFrame title="编辑日志" activePath="/console/logs"><p className="wt-description">您无权编辑该日志，或日志不存在。</p></ConsolePageFrame>;

  async function save(formData: FormData): Promise<EditLogSaveResult> {
    'use server';
    // Keep the existing validation, permissions, save and redirect destinations.
    // Return the redirect so the client can clear only a confirmed saved draft
    // before navigating; validation/session redirects retain the draft.
    try {
      await updateWorkLog(formData);
      return { saved: false };
    } catch (error) {
      if (!isRedirectError(error)) throw error;
      const redirectTo = getURLFromRedirectError(error);
      if (!redirectTo) throw error;
      const destination = new URL(redirectTo, 'http://worktrace.local');
      const saved = !destination.searchParams.has('error') && (
        destination.pathname === `/console/logs/${encodeURIComponent(id)}` ||
        destination.pathname === '/console/my-logs'
      );
      return { saved, redirectTo };
    }
  }

  return <ConsolePageFrame title="编辑日志" activePath={from === 'my' ? '/console/my-logs' : from === 'admin' ? '/console/admin/logs' : '/console/logs'}>
    <MarkdownWorkLogEditDraft key={`${user.id}:${log.id}`} userId={user.id} logId={log.id} from={from}
      initialValue={workLogMarkdownContent(log)} action={save}>
      {query.error && <p className="wt-form-error">{query.error === 'too-long' ? '日志内容不能超过 50,000 字符。' : query.error === 'image' ? '图片保存失败：仅支持最多 5 张 PNG、JPEG、WebP 或 GIF，每张不超过 5 MB。' : '请输入 Markdown 日志内容。'}</p>}
      <div className="wt-markdown-meta">
        <label><span>日报日期</span><input value={log.reportDate} readOnly /></label>
        <p className="wt-description">当前文字显示 Markdown 标记，移开焦点后显示排版；标题与缩进可折叠。</p>
      </div>
    </MarkdownWorkLogEditDraft>
  </ConsolePageFrame>;
}
