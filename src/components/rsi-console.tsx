'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { operateRsi } from '@/app/actions/rsi';

type Task = {
  id: string; title: string; description: string; state: string; updatedAt: string;
  metadata: { reason?: string; implementationReused?: boolean; handlingMode?: string; agentInstructions?: string; sourceSha?: string; round?: number; stageUrl?: string; acceptance?: string[]; scopeHistory?: { at: string; reason: string; alignment: string; oldScope: string[]; newScope: string[] }[]; failureMemory?: { id: string; kind: string; cycle: number; summary: string; sourceSha?: string; issues: { name?: string; file?: string; line?: number; problem?: string; requestedChange?: string; evidence?: string }[] }[]; lastCallFailure?: { kind: string; message: string; at: string } | null; findings?: { stage?: string; summary?: string; review?: { summary?: string }; qa?: { summary?: string; checks?: { name: string; passed: boolean; evidence: string }[] } } };
  policy: { used: number; limit: number; remaining: number; cycle: number; totalUsed: number; totalDeveloperCalls: number; developerCalls: number; callFailures: number; callFailureLimit: number; canContinue: boolean; manualRetries: number; retryAllowed: boolean; retryDisabledReason: string; canClose: boolean };
  approvals: { userId: string; userName: string; sourceSha: string; decision: string; note: string }[];
};
type Runtime = {
  state: string; title: string; description: string; startedAt: string | null; nextSweep: string | null; retryAt: string | null;
  queuedTasks: number; humanTasks: number; sweepRequested: boolean;
  agent: { role: string; label: string; startedAt: string; taskId: string | null; lastOperation: { message: string; at: string } | null } | null;
  lastSweep: { at: string; summary: string } | null;
  processRequested: { taskId: string; title: string; state: string } | null;
  processControl: { allowed: boolean; reason: string };
  lastManualProcess: { title: string; state: string; summary: string; finishedAt: string } | null;
  callRetry: { role: string; attempt: number; limit: number; nextAt: string; message: string } | null;
};
type ActionMessage = { kind: 'error' | 'success' | 'pending'; text: string };
type Status = {
  enabled: boolean; heartbeat: string | null; appReady: boolean; agentRunsToday: number; tasksToday: number; stageUrl: string;
  settings: { sweepMinutes: number; maxTasksPerDay: number; maxAgentRunsPerDay: number; maxRepairRounds: number; maxStageAttempts: number; maxInfrastructureFailures: number };
  runtime: Runtime; lastError: { message: string; at: string } | null; tasks: Task[];
  events: { id: number; message: string; createdAt: string; type: string }[];
};
const labels: Record<string, string> = {
  QUEUED: '等待处理', TRIAGING: '整理反馈', SCOPING: '复核修改范围', DEVELOPING: '正在开发', VERIFYING: '检查代码', REVIEWING: '独立评审', STAGING: '部署与浏览器复测',
  WAITING_ACCEPTANCE: '等待真人验收', ACCEPTED: '已在本地验收', REJECTED: '未通过验收', ESCALATED: '自动处理已停止 · 需人工处理', CLOSED: '已结束自动处理',
};
const steps = [['TRIAGING', '整理反馈'], ['SCOPING', '范围审查'], ['DEVELOPING', '开发'], ['VERIFYING', '代码检查'], ['REVIEWING', '独立评审'], ['STAGING', '浏览器复测'], ['WAITING_ACCEPTANCE', '真人验收'], ['ACCEPTED', '本地更新']];
const format = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
function duration(now: number, start?: string | null) {
  if (!start) return '—';
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
function eventLabel(message: string) {
  if (labels[message]) return labels[message];
  const role = /^(user|triage|scope|developer|reviewer|qa) 已开始独立会话$/.exec(message)?.[1];
  const names: Record<string, string> = { user: '用户体验 Agent', triage: '反馈整理 Agent', scope: '范围规划与审查 Agent', developer: '开发 Agent', reviewer: '独立评审 Agent', qa: '浏览器复测 Agent' };
  return role ? `${names[role]} 开始执行` : message === 'baseline 本地应用已启动' ? '本地应用已就绪' : message;
}
export function RsiConsole() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState('');
  const [patch, setPatch] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<{ action: string; taskId?: string } | null>(null);
  const [taskMessages, setTaskMessages] = useState<Record<string, ActionMessage>>({});
  const actionInFlight = useRef(false);
  const [now, setNow] = useState(0);
  const [lastReceived, setLastReceived] = useState(0);
  async function refresh() {
    try {
      const response = await fetch('/api/admin/rsi', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '无法读取服务状态。');
      if (!value.runtime) throw new Error('运行服务正在更新，请稍后刷新。');
      setStatus(value); setLastReceived(Date.now()); setConnectionError('');
    } catch (failure) { setConnectionError(failure instanceof Error ? failure.message : '无法读取服务状态。'); }
  }
  useEffect(() => {
    void refresh(); setNow(Date.now());
    const polling = setInterval(refresh, 5000), clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(polling); clearInterval(clock); };
  }, []);
  function act(action: string, task?: Task) {
    if (actionInFlight.current) return;
    const note = task ? (notes[task.id] || '').trim() : '';
    function report(kind: ActionMessage['kind'], text: string) {
      if (task) setTaskMessages(values => ({ ...values, [task.id]: { kind, text } }));
      else if (kind === 'error') { setNotice(''); setError(text); }
      else { setError(''); setNotice(text); }
    }
    if (action === 'retry' && note.length < 8) { report('error', '恢复任务前，请至少填写 8 字，说明已经排除的原因或具体处理方案。'); return; }
    if (action === 'reject' && note.length < 8) { report('error', '请至少填写 8 字的验收意见，说明具体问题和期望效果，Agent 会据此继续修复。'); return; }
    setError(''); setNotice('');
    actionInFlight.current = true;
    setActiveAction({ action, taskId: task?.id });
    const progress: Record<string, string> = { close: '正在结束自动处理并转人工…', process: '正在读取反馈并安排本次优化…', retry: '正在恢复任务…', approve: '正在记录验收结果…', reject: '正在记录验收结果…' };
    report('pending', progress[action] || '正在提交操作…');
    startTransition(async () => {
      try {
        const result = await operateRsi({ action, taskId: task?.id, sourceSha: task?.metadata.sourceSha, note });
        if (result.error) report('error', result.error);
        else {
          const notices: Record<string, string> = { pause: '已暂停自动运行；执行中的任务会结束当前处理。', resume: '自动运行已开启，请查看下方当前执行状态。', retry: '已恢复排队，累计开发次数保留。', close: '已结束自动处理，后续由人工处理。' };
          report('success', result.message || notices[action] || '操作已记录。');
          if (task) setNotes(values => ({ ...values, [task.id]: '' }));
        }
      } catch (failure) {
        report('error', failure instanceof Error ? failure.message : '操作未完成，请刷新状态后确认再试。');
      } finally {
        await refresh();
        actionInFlight.current = false; setActiveAction(null);
      }
    });
  }
  async function showPatch(task: Task) {
    try { const response = await fetch(`/api/admin/rsi?patch=${task.id}`, { cache: 'no-store' }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setPatch(value.patch); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '无法读取改动。'); }
  }
  const runtime = status?.runtime;
  const connected = Boolean(status && !connectionError && lastReceived && now - lastReceived < 20000 && status.heartbeat && now - Date.parse(status.heartbeat) < 45000);
  const running = Boolean(runtime && ['RUNNING', 'PAUSING', 'MANUAL'].includes(runtime.state));
  const activeTitle = connected ? runtime?.title : status ? '暂时无法确认当前执行状态' : '正在连接自动优化服务…';
  const activeDescription = connected ? runtime?.description : status ? '显示的是上次收到的信息。请检查服务连接，恢复后会自动更新。' : '正在读取后台服务和任务信息。';
  const sweepBusy = runtime?.agent?.role === 'user' || runtime?.sweepRequested;
  const busy = pending || Boolean(activeAction);
  const processBusy = Boolean(runtime?.processRequested);
  const processing = activeAction?.action === 'process';
  return <div className="wt-rsi-console">
    <p className="wt-description">自动体验、发现问题、开发、独立评审和复测。测试通过后等待真人验收；当前仅在本地运行。</p>
    {error && <p role="alert" className="wt-form-error">{error}</p>}
    {connectionError && <p role="alert" className="wt-form-error">{connectionError}</p>}
    {notice && <p role="status" className="wt-feedback-success">{notice}</p>}
    <section className="wt-panel wt-rsi-summary">
      <div className="wt-rsi-heading"><div className="wt-rsi-badges">
        <span className={`wt-rsi-badge ${connected ? 'is-online' : 'is-offline'}`}><i aria-hidden="true" />{connected ? '后台服务在线' : status ? '连接未确认' : '连接中'}</span>
        <span className={`wt-rsi-badge ${status?.enabled ? 'is-enabled' : 'is-paused'}`}>自动运行：{status ? status.enabled ? '已开启' : '已暂停' : '读取中'}</span>
      </div><span className="wt-rsi-muted">每 5 秒刷新 · 最近收到 {format(lastReceived ? new Date(lastReceived).toISOString() : null)}</span></div>
      <div className={`wt-rsi-live ${running && connected ? 'is-running' : ''}`} aria-live="polite">
        <span className="wt-rsi-live-mark" aria-hidden="true">{running && connected ? '↻' : '●'}</span>
        <div><h3>{activeTitle}</h3><p>{activeDescription}</p></div>
      </div>
      {runtime?.callRetry && <p role="status" className="wt-rsi-action-message is-pending">当前阶段第 {runtime.callRetry.attempt}/{runtime.callRetry.limit} 次调用将在 {Math.max(0, Math.ceil((Date.parse(runtime.callRetry.nextAt) - now) / 1000))} 秒后开始。连接故障不消耗没有产生代码改动的修复轮次。</p>}
      {running && connected && <div className="wt-rsi-operation">
        <strong>{runtime?.agent?.label || '后台执行程序'}</strong><span>已运行 {duration(now, runtime?.agent?.startedAt || runtime?.startedAt)}</span>
        <p>{runtime?.agent?.lastOperation?.message || (runtime?.agent ? '正在等待模型返回或准备下一步操作。' : '正在执行检查、构建或部署，请查看后续进展。')}</p>
        {runtime?.agent?.lastOperation?.at && <small>最近操作：{format(runtime.agent.lastOperation.at)}</small>}
      </div>}
      <div className="wt-rsi-buttons">
        <button className="wt-primary-button" disabled={busy || !connected} onClick={() => act(status?.enabled ? 'pause' : 'resume')}>{status?.enabled ? '暂停自动运行' : '继续自动运行'}</button>
        <button className="wt-secondary-button" disabled={busy || !connected || Boolean(sweepBusy)} onClick={() => act('sweep')}>{runtime?.sweepRequested ? '巡检已排队' : runtime?.agent?.role === 'user' ? '正在巡检' : '巡检一次'}</button>
        <button className="wt-secondary-button" disabled={busy || !connected || !runtime?.processControl?.allowed} title={runtime?.processControl?.reason || '读取最新反馈并处理最早一条待处理反馈'} onClick={() => act('process')}>{processing ? '正在安排优化…' : processBusy ? runtime?.processRequested?.state === 'RUNNING' ? '正在处理一条反馈' : '手动优化已排队' : '处理一条反馈'}</button>
        <button className="wt-secondary-button" onClick={() => void refresh()}>刷新状态</button>
      </div>
      <p className="wt-rsi-muted">“巡检一次”只体验一轮。“处理一条反馈”读取最新反馈，处理最早一条待处理反馈，执行筛选 → 开发 → 检查和构建 → 独立评审 → 测试版部署 → 浏览器复测；通过后等待真人验收。</p>
      <p className="wt-rsi-muted">两个手动按钮都不会改变自动运行开关；暂停时也可执行，结束后保持暂停。已转人工或达到累计上限的任务不会重新执行。</p>
      {runtime?.processControl?.reason && <p className="wt-rsi-muted">手动优化：{runtime.processControl.reason}</p>}
      {runtime && !runtime.queuedTasks && !processBusy && <p className="wt-rsi-muted">当前队列没有待处理反馈。可先提交建议反馈，再点击“处理一条反馈”；按钮会立即读取最新反馈。</p>}
      {status && runtime && <>
        <div className="wt-rsi-metrics">
          <div><span>等待执行</span><strong>{runtime.queuedTasks} 项</strong></div><div><span>需要人工处理</span><strong>{runtime.humanTasks} 项</strong></div>
          <div><span>今日开发任务</span><strong>{status.tasksToday} / {status.settings.maxTasksPerDay}</strong></div><div><span>今日 Agent 调用</span><strong>{status.agentRunsToday} / {status.settings.maxAgentRunsPerDay}</strong></div>
        </div>
        <p className="wt-rsi-muted">服务心跳：{format(status.heartbeat)} · {status.enabled ? `下次自动巡检：${runtime.nextSweep && Date.parse(runtime.nextSweep) <= now ? '已到时间，将在空闲时执行' : format(runtime.nextSweep)}` : '自动巡检已暂停，不安排定时执行。'}{runtime.retryAt && status.enabled ? ` · 退避结束：${format(runtime.retryAt)}` : ''}</p>
        {runtime.lastSweep && <details className="wt-rsi-last-sweep"><summary>上次巡检结果 · {format(runtime.lastSweep.at)}</summary><p>{runtime.lastSweep.summary}</p></details>}
        {runtime.lastManualProcess && <details className="wt-rsi-last-sweep"><summary>上次手动优化结果 · {labels[runtime.lastManualProcess.state] || runtime.lastManualProcess.state} · {format(runtime.lastManualProcess.finishedAt)}</summary><p>{runtime.lastManualProcess.title}：{runtime.lastManualProcess.summary}</p></details>}
      </>}
      {status?.lastError && <details><summary>最近一次运行异常 · {format(status.lastError.at)}</summary><p>{status.lastError.message}</p></details>}
    </section>
    <section className="wt-rsi-tasks"><h3>优化任务</h3>
      <p className="wt-rsi-muted">每个修复周期最多 {status?.settings.maxRepairRounds || 5} 轮代码修复，调用故障上限 {status?.settings.maxInfrastructureFailures || 6} 次。源码补查、范围修正及工具验证不占代码修复轮次；已通过的验证证据会保留。真人验收不通过会携带意见交回 Agent。标记“人工处理”的反馈会被 Agent 跳过。</p>
      {!status?.tasks.length && <div className="wt-panel"><p>暂无任务。可通过“建议反馈”提交具体问题，或点击“巡检一次”让用户 Agent 体验系统。</p></div>}
      {status?.tasks.map(task => {
        const manual = ['ESCALATED', 'REJECTED'].includes(task.state), policy = task.policy;
        const currentStep = steps.findIndex(([key]) => key === task.state);
        const failures = task.metadata.findings?.qa?.checks?.filter(item => !item.passed) || [];
        return <article key={task.id} className="wt-panel wt-rsi-task">
          <div className="wt-rsi-heading"><h3>{task.title}</h3><span className={`wt-rsi-task-state ${manual ? 'needs-human' : task.state === 'ACCEPTED' ? 'is-complete' : ''}`}>{labels[task.state] || task.state}</span></div>
          <p><span className={`wt-feedback-status wt-feedback-mode-${task.metadata.handlingMode === 'HUMAN' ? 'human' : 'agent'}`}>{task.metadata.handlingMode === 'HUMAN' ? '人工处理 · Agent 跳过' : 'Agent 处理'}</span></p>
          <p>{task.metadata.reason || '等待自动处理。'}</p>
          <p className="wt-rsi-muted">修复周期 {policy.cycle + 1} · 本周期代码修复 {policy.used}/{policy.limit} 轮 · 剩余 {policy.remaining} 轮 · 开发调用 {policy.developerCalls} 次 · 调用故障 {policy.callFailures}/{policy.callFailureLimit} 次 · 历史累计修复 {policy.totalUsed} 轮 / 开发调用 {policy.totalDeveloperCalls} 次</p>
          {task.metadata.implementationReused && <p className="wt-rsi-muted">本次沿用之前保存的代码进入验证，未新增代码修复轮次。是否满足要求，以检查、独立评审和浏览器复测结果为准。</p>}
          {task.metadata.agentInstructions && <details><summary>查看人工补充要求 / 验收反馈</summary><p className="wt-rsi-pre">{task.metadata.agentInstructions}</p></details>}
          {task.state === 'CLOSED' && task.metadata.handlingMode === 'HUMAN' && <p>此建议由人工处理，Agent 不会继续执行。需要交回 Agent 时，请到<a href="/console/admin/feedback">反馈管理</a>，切换为 Agent 处理即可，补充要求可不填。</p>}
          {task.state === 'QUEUED' && <div className="wt-rsi-buttons"><button disabled={busy || !connected || !runtime?.processControl?.allowed || !policy.canContinue} title={runtime?.processControl?.reason} className="wt-secondary-button" onClick={() => act('process', task)}>{processing && activeAction?.taskId === task.id ? '正在安排优化…' : '手动处理此反馈'}</button></div>}
          {!manual && task.state !== 'CLOSED' && <ol className="wt-rsi-steps" aria-label="任务处理阶段">{steps.map(([key, label], index) => <li key={key} aria-current={index === currentStep ? 'step' : undefined} className={index === currentStep ? 'is-current' : currentStep > index ? 'is-done' : ''}>{label}</li>)}</ol>}
          <details><summary>查看原始反馈与验收要求</summary><p className="wt-rsi-pre">{task.description}</p>{task.metadata.acceptance && <ul>{task.metadata.acceptance.map((item, index) => <li key={index}>{item}</li>)}</ul>}</details>
          {!!task.metadata.scopeHistory?.length && <details><summary>范围调整记录 · {task.metadata.scopeHistory.length} 次</summary>{task.metadata.scopeHistory.map((item,index)=><div key={`${item.at}-${index}`}><strong>{format(item.at)}</strong><p>{item.reason}</p><p>{item.alignment}</p><p className="wt-rsi-pre">原范围：{item.oldScope.join('、') || '未分配'}{`\n`}批准范围：{item.newScope.join('、')}</p></div>)}</details>}
          {!!task.metadata.failureMemory?.length && <details><summary>历史问题记录 · {task.metadata.failureMemory.length} 条 · 新周期会继承</summary><p className="wt-rsi-muted">以下是历史检查、评审和复测发现；是否已解决，以当前版本的新验证为准。各 Agent 收到问题记录，独立评审不共享开发对话。</p>{task.metadata.failureMemory.map(item => <div key={item.id}><strong>周期 {item.cycle + 1} · {({ review: '独立评审', browser: '浏览器复测', checks: '代码检查', developer: '开发待验证说明' } as Record<string, string>)[item.kind] || item.kind}{item.sourceSha ? ` · ${item.sourceSha.slice(0, 8)}` : ''}</strong><p className="wt-rsi-pre">{item.summary}</p>{item.issues.length > 0 && <ul>{item.issues.map((issue, index) => <li key={index}>{issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ''}：` : issue.name ? `${issue.name}：` : ''}{issue.problem || issue.evidence || ''}{issue.requestedChange && <p>{issue.requestedChange}</p>}</li>)}</ul>}</div>)}</details>}
          {task.metadata.lastCallFailure && <div className="wt-rsi-action-message is-error"><strong>最近一次调用故障 · {format(task.metadata.lastCallFailure.at)}</strong><p>{task.metadata.lastCallFailure.message}</p></div>}
          {task.metadata.findings && <details><summary>查看最近代码检查或评审问题</summary><p className="wt-rsi-pre">{task.metadata.findings.qa?.summary || task.metadata.findings.review?.summary || task.metadata.findings.summary || '代码检查未通过，相关记录已保留。'}</p>{failures.length > 0 && <ul>{failures.map((item, index) => <li key={index}><strong>{item.name}</strong><p>{item.evidence}</p></li>)}</ul>}</details>}
          {task.state === 'WAITING_ACCEPTANCE' && <div className="wt-rsi-accept">
            <p>等待两名不同账号验收同一版本。当前通过 {new Set(task.approvals.filter(item => item.sourceSha === task.metadata.sourceSha && item.decision === 'approve').map(item => item.userId)).size}/2 人。</p>
            <div className="wt-rsi-buttons"><a className="wt-primary-button" href={`${status.stageUrl}/_rsi/acceptance`} target="_blank" rel="noreferrer">打开测试版</a><button className="wt-secondary-button" onClick={() => void showPatch(task)}>查看代码改动</button></div>
            <p className="wt-rsi-muted">打开后可选择管理员 A 或 B，直接测试“建议反馈”，再以所选账号进入验收页。</p>
            <label>验收说明<textarea value={notes[task.id] || ''} onChange={event => setNotes(values => ({ ...values, [task.id]: event.target.value }))} rows={2} maxLength={1000} placeholder="不通过时至少填写 8 字：具体问题、复现步骤、期望效果，意见会交给 Agent 继续修复。" /></label>
            <div className="wt-rsi-buttons"><button disabled={busy || !connected} className="wt-primary-button" onClick={() => act('approve', task)}>本人验收通过</button><button disabled={busy || !connected} className="wt-secondary-button" onClick={() => act('reject', task)}>验收不通过，交回 Agent 修复</button></div>
            {task.approvals.map(item => <p key={`${item.userId}-${item.sourceSha}`}>{item.userName}：{item.decision === 'approve' ? '通过' : '未通过'} {item.note}</p>)}
          </div>}
          {manual && <div className="wt-rsi-manual">
            <strong>{task.metadata.handlingMode === 'HUMAN' ? '已标记人工处理，Agent 将跳过此建议' : policy.canContinue ? policy.remaining ? '处理原因后可从保存的阶段继续' : '可继续未完成的检查，无需重新开发' : '已停止自动开发，后续由人工处理'}</strong>
            <p>{policy.retryAllowed ? '仅在排除临时故障或补充了具体方案后，允许人工恢复一次；继续沿用剩余开发额度。' : policy.retryDisabledReason}</p>
            <p>可查看失败记录，人工修复代码或明确调整需求。恢复自动运行会继续其他任务，不会循环执行本建议。</p>
            {task.metadata.handlingMode === 'HUMAN' && <p>如需 Agent 继续修复，请到<a href="/console/admin/feedback">反馈管理</a>切换为“Agent 处理”即可，补充要求可不填。</p>}
            <label>{policy.retryAllowed ? '人工处理说明（转人工可不填，恢复任务至少 8 字）' : '人工处理说明（选填）'}<textarea value={notes[task.id] || ''} onChange={event => setNotes(values => ({ ...values, [task.id]: event.target.value }))} rows={2} maxLength={1000} placeholder={policy.retryAllowed ? '可记录后续由谁、如何处理；如需恢复任务，请至少填写 8 字的具体处理方案。' : '可记录后续由谁、如何处理；要交回 Agent，请到反馈管理切换处理方式。'} /></label>
            <div className="wt-rsi-buttons">
              {policy.retryAllowed && <button disabled={busy || !connected} className="wt-secondary-button" onClick={() => act('retry', task)}>{activeAction?.taskId === task.id && activeAction.action === 'retry' ? '正在恢复任务…' : '补充方案后恢复一次'}</button>}
              {policy.canClose && <button disabled={busy || !connected} className="wt-secondary-button" onClick={() => act('close', task)}>{activeAction?.taskId === task.id && activeAction.action === 'close' ? '正在转人工…' : '结束自动处理并转人工'}</button>}
            </div>
          </div>}
          {taskMessages[task.id] && <p role={taskMessages[task.id].kind === 'error' ? 'alert' : 'status'} className={`wt-rsi-action-message is-${taskMessages[task.id].kind}`}>{taskMessages[task.id].text}</p>}
        </article>;
      })}
    </section>
    {patch && <section className="wt-panel"><div className="wt-rsi-heading"><h3>候选代码改动</h3><button onClick={() => setPatch('')} className="wt-secondary-button">关闭改动</button></div><pre className="wt-rsi-diff">{patch}</pre></section>}
    <section className="wt-panel"><h3>运行记录</h3><ol className="wt-rsi-events">{status?.events.slice(0,30).map(event => <li key={event.id}><time>{format(event.createdAt)}</time><span>{eventLabel(event.message)}</span></li>)}</ol></section>
  </div>;
}
