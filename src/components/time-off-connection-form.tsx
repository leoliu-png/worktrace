'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { connectTimeOff, type TimeOffConnectState } from '@/app/actions/time-off';
import { timeOffReasons } from '@/lib/time-off-types';

export function TimeOffActionButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <button className="wt-secondary-button" type="submit" disabled={pending} aria-busy={pending}>{pending ? pendingLabel : children}</button>;
}

export function TimeOffConnectionForm() {
  const [state, action, pending] = useActionState(connectTimeOff, {} as TimeOffConnectState);
  const error = state.error === 'session' ? '登录会话已失效，请重新登录。' : state.error === 'token' ? '请填写有效的 Time off API 令牌。' : state.error ? timeOffReasons[state.error] : undefined;
  return <form className="wt-form wt-time-off-connect" action={action}>
    <label><span>个人 Time off API 令牌</span><input type="password" name="token" autoComplete="off" required maxLength={512} placeholder="fmtopat_…" aria-describedby="time-off-token-help" /></label>
    <p id="time-off-token-help" className="wt-description">请使用与当前 WorkTrace 登录邮箱相同的 Time off 账号生成的令牌。令牌加密保存，不会显示给其他用户。</p>
    <button className="wt-primary-button" type="submit" disabled={pending} aria-busy={pending}>{pending ? '正在验证账号…' : '连接 / 更新令牌'}</button>
    {error && <p className="wt-form-error" role="alert">{error}</p>}
    {state.connected && <p className="wt-description" role="status">已连接，之后提交或保存日志会自动同步。</p>}
  </form>;
}
