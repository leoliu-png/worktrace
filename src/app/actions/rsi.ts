'use server';
import { currentConsoleUser } from '@/lib/session';
import { rsiControl } from '@/lib/rsi-control';

export async function operateRsi(input: { action: string; taskId?: string; sourceSha?: string; note?: string }) {
  const user = await currentConsoleUser();
  if (!user || user.role !== 'ADMIN') return { error: '需要管理员权限。' };
  if (!['pause', 'resume', 'sweep', 'process', 'retry', 'close', 'approve', 'reject'].includes(input.action)) return { error: '无效操作。' };
  if (input.taskId && !/^[a-f0-9-]{36}$/.test(input.taskId)) return { error: '无效任务。' };
  try {
    if (['approve', 'reject'].includes(input.action)) {
      if (!input.taskId || !input.sourceSha || !/^[a-f0-9]{40}$/.test(input.sourceSha)) return { error: '候选版本不合法，请刷新。' };
      await rsiControl('/accept', { taskId: input.taskId, sourceSha: input.sourceSha, decision: input.action, note: (input.note ?? '').slice(0, 1000), actor: { id: user.id, name: user.name, role: user.role } });
    } else { const result = await rsiControl('/control', { action: input.action, taskId: input.taskId, note: (input.note ?? '').trim().slice(0, 1000), actor: { id: user.id, name: user.name, role: user.role } }) as { message?: string }; return { ok: true, message: result.message }; }
    return { ok: true, message: input.action === 'reject' ? '验收意见已保存，已交回 Agent 排队修复；自动运行暂停时，请点击“手动处理此反馈”。' : '验收结果已记录。' };
  } catch (error) { return { error: error instanceof Error ? error.message : '操作失败，请稍后重试。' }; }
}
