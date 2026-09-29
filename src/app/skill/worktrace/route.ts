import { workTraceSkillMarkdown } from '@/lib/worktrace-skill';

export function GET(request: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  return new Response(workTraceSkillMarkdown(baseUrl), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
