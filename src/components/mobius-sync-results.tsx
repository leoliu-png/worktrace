import Link from 'next/link';
import { MarkdownContent } from './markdown-content';
import { MobiusResultsRefresh } from './mobius-results-refresh';
import type { MobiusSyncReason, MobiusSyncRun } from '@/lib/mobius-sync-result';
import { formatWorkTraceDateTime } from '@/lib/time';

const reasons: Record<MobiusSyncReason, [string, string]> = {
  not_configured: ['尚未配置 Mobius 连接。', 'Mobius is not connected.'],
  author_not_enabled: ['你的账号尚未启用 Mobius 同步。', 'Mobius sync is not enabled for your account.'],
  different_author: ['这次保存者与日志作者不同，未执行同步。', 'The editor is not the log author; sync was skipped.'],
  past_report_date: ['该日志日期不是今天，未自动评论。', 'This log is not for today; no comments were posted.'],
  empty: ['没有可用于匹配的日志条目。', 'There are no log entries to match.'],
  entry_limit: ['本次条目过多，此条未参与匹配。', 'This entry exceeded the per-submission matching limit.'],
  multiple_ids: ['条目包含多个 Issue 编号，无法确定对应关系。', 'The entry contains multiple issue identifiers.'],
  no_match: ['你的 Participating 列表中没有找到明确匹配的 Issue。', 'No clear match was found in your Participating list.'],
  ambiguous: ['存在多个相似的 Issue，未自动评论。', 'Multiple issues matched; no comment was posted.'],
  done: ['候选 Issue 已是 Done，此匹配未采用，也未改投其他 Issue。', 'The candidate is Done; the match was rejected without falling back to another issue.'],
  not_related: ['该 Issue 不在你的 My issues → Participating 列表中，未采用此匹配。', 'This issue is outside your My issues → Participating list; the match was rejected.'],
  participating_unavailable: ['无法确认你的 Participating 列表，已停止自动评论；日志已保存。', 'Your Participating list could not be verified; automatic comments were stopped and the log was saved.'],
  stopped: ['该 Issue 已请求停止自动操作，未发表评论。', 'Automatic actions were stopped for this issue.'],
  updated_today: ['该 Issue 今天已有更新，未重复评论。', 'The issue already has an update today; no comment was posted.'],
  duplicate: ['该 Issue 今天已同步，或正在同步，未重复评论。', 'The issue was already synced today or is being synced; no duplicate comment was posted.'],
  matching_failed: ['匹配失败；日志已保存。', 'Matching failed; the log was saved.'],
  comment_failed: ['发表评论失败；日志已保存。', 'Posting the comment failed; the log was saved.'],
  connection_failed: ['Mobius 连接失败；日志已保存。', 'The Mobius connection failed; the log was saved.'],
  token_account_mismatch: ['Mobius 令牌所属账号与日志作者不一致，未发表评论。', 'The Mobius token account differs from the log author; no comment was posted.'],
  no_comment_permission: ['当前 Mobius 账号没有评论权限。', 'The connected Mobius account cannot post comments.'],
  persistence_failed: ['同步结果未能完整保存，请在 Mobius 核对评论。', 'The sync result could not be fully saved; verify comments in Mobius.'],
};

export function MobiusSyncResults({ runs, locale, history = false }: { runs: MobiusSyncRun[]; locale: 'zh' | 'en'; history?: boolean }) {
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const reasonText = (reason: MobiusSyncReason) => reasons[reason][locale === 'zh' ? 0 : 1];
  const runStatuses = { matching: text('匹配中', 'Matching'), posted: text('已评论', 'Commented'), partial: text('部分成功', 'Partially completed'), error: text('同步失败', 'Failed'), skipped: text('未发表评论', 'No comments'), disabled: text('未启用同步', 'Not enabled') };
  const itemStatuses = { posted: text('已评论', 'Commented'), skipped: text('已跳过', 'Skipped'), unmatched: text('未匹配', 'Unmatched'), error: text('失败', 'Failed') };
  const sourceLabels = { web: text('手动保存', 'Web'), mcp: 'MCP', api: 'API' };
  return <section id="issue-results" className="wt-panel wt-issue-results">
    <div className="wt-panel-heading wt-issue-heading"><h2>{text('Issue 匹配结果', 'Issue matching results')}</h2><div className="wt-issue-actions"><MobiusResultsRefresh locale={locale} />{!history && <Link href="/console/issue-matches">{text('查看全部', 'View all')}</Link>}</div></div>
    <p className="wt-issue-caption">{text('匹配范围：My issues → Participating · 页面打开时每 15 秒自动刷新', 'Scope: My issues → Participating · refreshes every 15 seconds while visible')}</p>
    {!runs.length ? <div className="wt-issue-empty">{text('保存或提交日志后，可在这里查看匹配的 Issue、评论正文和未评论原因。手动提交与 MCP 提交都会显示。', 'Save or submit a log to see matched issues, posted comments and skipped reasons here. Both web and MCP submissions are included.')}</div> : <div className={history ? 'wt-issue-runs' : 'wt-issue-runs wt-issue-runs-preview'}>{runs.map((run, index) => {
      const unfinished = run.status === 'matching' && Date.now() - new Date(run.createdAt).getTime() > 10 * 60_000;
      const result = run.result;
      return <details className="wt-issue-run" key={run.id} open={index === 0}>
        <summary><div className="wt-issue-run-title"><strong>{run.logTitle}</strong><span>{run.reportDate} · {sourceLabels[run.source]} · {formatWorkTraceDateTime(run.createdAt, locale === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div><div className="wt-issue-run-counts">{result && <span>{text(`评论 ${result.posted} · 已更新 ${result.alreadyUpdated} · 未匹配 ${result.unmatched} · 失败 ${result.failed}`, `Comments ${result.posted} · Updated ${result.alreadyUpdated} · Unmatched ${result.unmatched} · Failed ${result.failed}`)}</span>}<span className={`wt-issue-status ${run.status}`}>{unfinished ? text('处理未完成', 'Incomplete') : runStatuses[run.status]}</span></div></summary>
        <div className="wt-issue-run-content"><Link className="wt-issue-log-link" href={`/console/logs/${encodeURIComponent(run.workLogId)}`}>{text('查看工作日志 →', 'View work log →')}</Link>
          {run.status === 'matching' && <p>{unfinished ? text('本次提交没有记录完整的同步结果，请到 Mobius 核对。', 'This submission did not record a complete sync result. Verify it in Mobius.') : text('正在匹配 Issue 并检查是否需要评论，结果会自动刷新。', 'Matching issues and checking whether comments are needed. Results will refresh automatically.')}</p>}
          {result?.reason && <p className="wt-issue-reason">{reasonText(result.reason)}</p>}
          {result?.items.map((item, itemIndex) => <article className="wt-issue-item" key={`${run.id}-${itemIndex}`}>
            <div className="wt-issue-item-heading"><div>{item.identifier ? <><a href={`https://mobius.feedmob.com/issue/${encodeURIComponent(item.identifier)}`} target="_blank" rel="noopener noreferrer">{item.identifier} · {item.title}</a>{item.issueState && <small>{item.issueState}</small>}</> : <strong>{text('日志条目', 'Log entry')}</strong>}</div><span className={`wt-issue-status ${item.status}`}>{itemStatuses[item.status]}</span></div>
            <ul className="wt-issue-entry-list">{item.entries.map((entry, entryIndex) => <li key={entryIndex}><span>{entry.section}</span>{entry.text}</li>)}</ul>
            {item.reason && <p className="wt-issue-reason">{reasonText(item.reason)}</p>}
            {item.status === 'posted' && item.commentBody && <div className="wt-issue-comment"><strong>{text('实际评论内容', 'Posted comment')}</strong><MarkdownContent value={item.commentBody} /></div>}
          </article>)}
        </div>
      </details>;
    })}</div>}
  </section>;
}
