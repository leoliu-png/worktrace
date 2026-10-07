'use client';

import { useFormStatus } from 'react-dom';

export function WorkLogSubmitButton({ editing = false }: { editing?: boolean }) {
  const { pending } = useFormStatus();
  return <button className="wt-primary-button wt-log-submit-button" type="submit" disabled={pending} aria-busy={pending}>
    {pending && <span className="wt-loading-spinner" aria-hidden="true" />}
    {pending ? (editing ? '正在保存…' : '正在提交…') : (editing ? '保存修改' : '发布工作日志')}
  </button>;
}

export function WorkLogSubmissionStatus() {
  const { pending } = useFormStatus();
  return pending ? <p className="wt-log-submission-status" role="status" aria-live="polite">
    正在保存工作日志并匹配相关 Issue，请稍候…
  </p> : null;
}
