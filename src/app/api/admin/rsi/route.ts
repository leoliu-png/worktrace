import { NextResponse } from 'next/server';
import { currentConsoleUser } from '@/lib/session';
import { rsiControl } from '@/lib/rsi-control';

export async function GET(request: Request) {
  const user = await currentConsoleUser();
  if (!user) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
  if (user.role !== 'ADMIN') return NextResponse.json({ error: '需要管理员权限。' }, { status: 403 });
  const taskId = new URL(request.url).searchParams.get('patch');
  if (taskId && !/^[a-f0-9-]{36}$/.test(taskId)) return NextResponse.json({ error: '无效任务。' }, { status: 400 });
  try { return NextResponse.json(await rsiControl(taskId ? `/tasks/${taskId}/patch` : '/status'), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '服务暂不可用。' }, { status: 503 }); }
}
