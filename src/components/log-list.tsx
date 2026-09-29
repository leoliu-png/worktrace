import Link from 'next/link';
import { deleteWorkLog } from '@/app/actions/work-logs';
import type { WorkTraceLog } from '@/lib/worktrace-data';
import { markdownPreviewText } from '@/lib/markdown-work-log';
import { formatWorkTraceDateTime } from '@/lib/time';

export type LogPreview = WorkTraceLog;

function reportDate(log: WorkTraceLog) {
  return log.reportDate?.replaceAll('-', '/') ?? formatWorkTraceDateTime(log.createdAt, 'zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function LogList({ logs, management = false }: { logs: LogPreview[]; management?: boolean }) {
  return <div className="wt-log-list">
    {logs.map((log) => <div key={log.id} className={management ? 'wt-log-row wt-log-row-management' : 'wt-log-row'}>
      <Link className="wt-log-main" href={`/console/logs/${log.id}${management ? '?from=admin' : ''}`}><div><strong>{log.title}</strong><p>{log.markdownContent ? markdownPreviewText(log.markdownContent) : log.completed.join('；')}</p></div><span>{log.authorEmail}</span><span>{reportDate(log)}</span><span className="wt-source">Web</span></Link>
      {management && <form action={deleteWorkLog}><input type="hidden" name="id" value={log.id} /><input type="hidden" name="returnTo" value="admin" /><button className="wt-danger-link" type="submit">删除</button></form>}
    </div>)}
  </div>;
}
