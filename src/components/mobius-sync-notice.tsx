import Link from 'next/link';

type Props = { status?: string; posted?: string; unmatched?: string; updated?: string; failed?: string };

function count(value?: string) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 1000) : 0;
}

export function MobiusSyncNotice({ status, posted, unmatched, updated, failed }: Props) {
  if (!['posted', 'partial', 'skipped', 'error', 'disabled'].includes(status ?? '')) return null;
  const messages: string[] = [];
  if (status === 'disabled') messages.push('工作日志已保存，本次未启用 Mobius 同步。');
  if (count(posted)) messages.push(`已向 ${count(posted)} 个 Mobius Issue 发表评论。`);
  if (count(updated)) messages.push(`${count(updated)} 个匹配的 Issue 今天已有更新，未重复评论。`);
  if (count(unmatched)) messages.push(`${count(unmatched)} 条内容没有找到明确匹配的 Issue；在日志条目中写入 Issue 编号可以直接关联。`);
  if (count(failed)) messages.push(`${count(failed)} 项同步失败，工作日志仍已保存。`);
  if (!messages.length) messages.push('工作日志已保存；仅当日报日期是今天且找到明确匹配的 Issue 时，才会自动评论。');
  return <p className={count(failed) ? 'wt-form-error' : 'wt-description'}>{messages.join(' ')} <Link href="/console/issue-matches">查看 Issue 匹配详情 →</Link></p>;
}
