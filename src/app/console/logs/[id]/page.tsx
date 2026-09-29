import Link from 'next/link';
import { deleteWorkLog } from '@/app/actions/work-logs';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { MarkdownContent } from '@/components/markdown-content';
import { createDatabase } from '@/lib/db';
import { workLogMarkdownContent } from '@/lib/markdown-work-log';
import { currentConsoleUser } from '@/lib/session';
import { formatWorkTraceDateTime } from '@/lib/time';
import { loadConsoleData } from '@/lib/worktrace-data';

export default async function LogDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const requestedFrom = (await searchParams).from;
  const from = requestedFrom === 'my' || requestedFrom === 'admin' ? requestedFrom : 'all';
  const user = await currentConsoleUser();
  if (!user) return null;

  const database = createDatabase();
  const { logs } = loadConsoleData(database, user.id);
  const log = logs.find((item) => item.id === id);
  const attachments = log ? database.listWorkLogAttachments(log.id) : [];
  database.close();

  const backHref = from === 'my' ? '/console/my-logs' : from === 'admin' ? '/console/admin/logs' : '/console/logs';
  const backLabel = from === 'my' ? '返回我的日志' : from === 'admin' ? '返回日志管理' : '返回全部日志';
  if (!log) return <ConsolePageFrame title="工作日志详情" activePath={backHref}><p className="wt-description">未找到该工作日志。</p></ConsolePageFrame>;

  const canModify = log.authorId === user.id || user.role === 'ADMIN';
  const markdown = workLogMarkdownContent(log);
  const separateAttachments = attachments.filter((attachment) => !markdown.includes(`/api/v1/work-logs/${log.id}/attachments/${attachment.id}`));
  const suffix = from === 'all' ? '' : `?from=${from}`;
  return <ConsolePageFrame title="工作日志详情" activePath={backHref}>
    <div className="wt-detail-actions">
      <Link href={backHref}>← {backLabel}</Link>
      {canModify && <div className="wt-detail-owner-actions">
        <Link className="wt-secondary-button" href={`/console/logs/${log.id}/edit${suffix}`}>编辑日志</Link>
        <form action={deleteWorkLog}><input type="hidden" name="id" value={log.id} /><input type="hidden" name="returnTo" value={from === 'admin' ? 'admin' : 'my'} /><button className="wt-danger-button" type="submit">删除日志</button></form>
      </div>}
    </div>
    <article className="wt-panel wt-log-detail">
      <header>
        <span className="wt-source">Web</span>
        <p>{log.authorName} · {log.authorEmail} · 日报日期：{log.reportDate?.replaceAll('-', '/') ?? formatWorkTraceDateTime(log.createdAt, 'zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })} · 最后提交：{formatWorkTraceDateTime(log.updatedAt ?? log.createdAt, 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      </header>
      <section><MarkdownContent value={markdown} /></section>
      {separateAttachments.length > 0 && <section><h3>图片附件</h3><div className="wt-attachment-grid">{separateAttachments.map((attachment) => <a key={attachment.id} href={`/api/v1/work-logs/${log.id}/attachments/${attachment.id}`} target="_blank" rel="noreferrer"><img src={`/api/v1/work-logs/${log.id}/attachments/${attachment.id}`} alt={attachment.filename} /><span>{attachment.filename}</span></a>)}</div></section>}
    </article>
  </ConsolePageFrame>;
}
