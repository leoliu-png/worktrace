import Link from 'next/link';
import { updateWorkLog } from '@/app/actions/work-logs';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { MarkdownEditor } from '@/components/markdown-editor';
import { createDatabase } from '@/lib/db';
import { workLogMarkdownContent } from '@/lib/markdown-work-log';
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

  const suffix = from === 'all' ? '' : `?from=${from}`;
  return <ConsolePageFrame title="编辑日志" activePath={from === 'my' ? '/console/my-logs' : from === 'admin' ? '/console/admin/logs' : '/console/logs'}>
    <form className="wt-panel wt-form wt-markdown-form" action={updateWorkLog}>
      <input type="hidden" name="id" value={log.id} />
      <input type="hidden" name="from" value={from} />
      {query.error && <p className="wt-form-error">{query.error === 'too-long' ? '日志内容不能超过 50,000 字符。' : query.error === 'image' ? '图片保存失败：仅支持最多 5 张 PNG、JPEG、WebP 或 GIF，每张不超过 5 MB。' : '请输入 Markdown 日志内容。'}</p>}
      <div className="wt-markdown-meta">
        <label><span>日报日期</span><input value={log.reportDate} readOnly /></label>
        <p className="wt-description">当前文字显示 Markdown 标记，移开焦点后显示排版；标题与缩进可折叠。</p>
      </div>
      <MarkdownEditor initialValue={workLogMarkdownContent(log)} />
      <div className="wt-form-actions"><Link className="wt-secondary-button" href={`/console/logs/${log.id}${suffix}`}>取消</Link><button className="wt-primary-button" type="submit">保存修改</button></div>
    </form>
  </ConsolePageFrame>;
}
