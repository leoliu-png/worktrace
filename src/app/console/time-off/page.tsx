import Link from 'next/link';
import { disconnectTimeOff, retryTimeOffSync } from '@/app/actions/time-off';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { TimeOffActionButton, TimeOffConnectionForm } from '@/components/time-off-connection-form';
import { TimeOffSyncNotice } from '@/components/time-off-sync-notice';
import { createDatabase } from '@/lib/db';
import { currentConsoleUser } from '@/lib/session';
import { formatWorkTraceDateTime } from '@/lib/time';
import { timeOffReasons, timeOffImageReasons, type TimeOffSyncRun } from '@/lib/time-off-types';

export const dynamic = 'force-dynamic';

const statuses: Record<TimeOffSyncRun['status'], string> = { syncing: '同步中', synced: '已同步', partial: '正文已同步 · 图片待修复', error: '失败', disabled: '未启用', skipped: '已跳过' };
const sources: Record<TimeOffSyncRun['source'], string> = { web: '网页保存', mcp: 'MCP 提交', api: 'API 提交', retry: '手动重试' };

export default async function TimeOffPage({ searchParams }: { searchParams: Promise<{ timeOff?: string; timeOffReason?: string }> }) {
  const user = await currentConsoleUser();
  if (!user) return null;
  const params = await searchParams;
  const database = createDatabase();
  let connection;
  let runs;
  try { connection = database.getTimeOffConnection(user.id); runs = database.listTimeOffSyncRuns(user.id); }
  finally { database.close(); }
  const email = user.email.trim().toLowerCase();
  const connected = connection ? connection.enabled && Boolean(connection.encryptedToken) && connection.accountEmail === email
    : Boolean(process.env.TIME_OFF_PAT?.trim()) && process.env.TIME_OFF_ACCOUNT_EMAIL?.trim().toLowerCase() === email;

  return <ConsolePageFrame title="Time off 同步" activePath="/console/time-off">
    <div className="wt-time-off-page">
      <TimeOffSyncNotice status={params.timeOff} reason={params.timeOffReason} />
      <section className="wt-panel">
        <div className="wt-panel-heading"><h2>连接我的 Time off</h2><a href="https://time-off.feedmob.com/journals" target="_blank" rel="noreferrer">打开 Time off ↗</a></div>
        <p className="wt-description">提交或保存工作日志时，按日报日期同步到 Time off。当天没有日志就创建，已有日志则替换为 WorkTrace 中的完整内容；修改过去的日志会更新相应日期。</p>
        <div className="wt-time-off-account"><p>{connected ? `已连接：${email}` : '尚未连接 / 已关闭自动同步'}</p>{connected && <form action={disconnectTimeOff}><TimeOffActionButton pendingLabel="正在断开…">断开连接</TimeOffActionButton></form>}</div>
        <TimeOffConnectionForm />
        <p className="wt-description">同步失败不影响 WorkTrace 保存，可在下方重试。管理员代编辑他人日志时不会写入自己的 Time off。含图片的日志需要 WorkTrace 的图片地址能够从外网访问。</p>
        <a href="https://time-off.feedmob.com/api-reference" target="_blank" rel="noreferrer">Time off API 文档 ↗</a>
      </section>
      <section className="wt-panel">
        <div className="wt-panel-heading"><h2>最近同步记录</h2><Link href="/console/time-off">刷新结果</Link></div>
        <p className="wt-description">展示自己的最近 25 次同步，重试会使用该日志当前保存的最新内容。</p>
        {!runs.length && <p className="wt-description">还没有同步记录。连接后提交一份工作日志即可。</p>}
        <div className="wt-time-off-runs">{runs.map((run) => <article key={run.id}>
          <div><Link href={`/console/logs/${run.workLogId}?from=my`}><strong>{run.logTitle}</strong></Link><p>{run.reportDate} · {sources[run.source]} · {formatWorkTraceDateTime(run.createdAt, 'zh-CN', { dateStyle: 'short', timeStyle: 'medium' })}</p>
            {run.status === 'partial' ? <p className="wt-time-off-warning">文字内容已同步，以下图片需要补传或修复后重新同步。</p> : run.result?.reason && <p className={run.status === 'error' ? 'wt-form-error' : 'wt-description'}>{timeOffReasons[run.result.reason]}</p>}
            {Boolean(run.result?.imageWarnings?.length) && <ul className="wt-time-off-image-warnings">{run.result!.imageWarnings!.map((warning, index) => <li key={index}>{warning.alt}：{timeOffImageReasons[warning.reason]}</li>)}</ul>}
          </div>
          <span className="wt-status">{statuses[run.status]}</span>
          {run.status !== 'syncing' && connected && <form action={retryTimeOffSync}><input type="hidden" name="workLogId" value={run.workLogId} /><TimeOffActionButton pendingLabel="正在同步…">重新同步</TimeOffActionButton></form>}
        </article>)}</div>
      </section>
    </div>
  </ConsolePageFrame>;
}
