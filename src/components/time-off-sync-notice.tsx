import Link from 'next/link';
import { timeOffReasons, type TimeOffReason } from '@/lib/time-off-types';

export function TimeOffSyncNotice({ status, reason }: { status?: string; reason?: string }) {
  if (!['synced', 'partial', 'error', 'disabled', 'skipped'].includes(status ?? '')) return null;
  const message = reason && Object.hasOwn(timeOffReasons, reason) ? timeOffReasons[reason as TimeOffReason] : '请在同步页面查看详情。';
  return <p className={status === 'error' ? 'wt-form-error wt-time-off-notice' : status === 'partial' ? 'wt-time-off-warning wt-time-off-notice' : 'wt-description wt-time-off-notice'} role="status">
    {status === 'synced' ? 'Time off 已同步为该日报日期的最新日志。' : status === 'partial' ? 'Time off 正文已同步，部分图片未能同步。请查看详情，补传或修复图片后重新同步。' : `WorkTrace 工作日志已保存。${message}`} <Link href="/console/time-off">查看 Time off 同步 →</Link>
  </p>;
}
