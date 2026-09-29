import Link from 'next/link';
import { deleteWorkLog } from '@/app/actions/work-logs';
import type { WorkTraceLog } from '@/lib/worktrace-data';
import { markdownPreviewText } from '@/lib/markdown-work-log';
import { formatWorkTraceDateTime } from '@/lib/time';

function reportDate(log: WorkTraceLog) {
  return log.reportDate?.replaceAll('-', '/') ?? formatWorkTraceDateTime(log.createdAt, 'zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function MyLogList({ logs }: { logs: WorkTraceLog[] }) {
  return <div className="wt-log-list">
    {logs.map((log) => <div className="wt-log-row wt-my-log-row" key={log.id}>
      <Link className="wt-log-main" href={`/console/logs/${log.id}?from=my`}><div><strong>{log.title}</strong><p>{log.markdownContent ? markdownPreviewText(log.markdownContent) : log.completed.join('；')}</p></div><span>{log.authorEmail}</span><span>{reportDate(log)}</span></Link>
      <div className="wt-row-actions"><Link className="wt-secondary-button" href={`/console/logs/${log.id}/edit?from=my`}>编辑</Link><form action={deleteWorkLog}><input type="hidden" name="id" value={log.id} /><input type="hidden" name="returnTo" value="my" /><button className="wt-danger-link" type="submit">删除</button></form></div>
    </div>)}
  </div>;
}
