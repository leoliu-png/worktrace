import type { createDatabase } from './db';
import { maxMarkdownCharacters, workLogMarkdownContent } from './markdown-work-log';
import { markdownImageContent, workLogImageMarkdown } from './markdown-work-log-images';
import { workTraceReportDate } from './report-date';

export type YesterdayLogImage = { sources: string[]; url: string; filename: string; mimeType: string; size: number };
export type YesterdayWorkLogResult = { markdownContent: string; reportDate: string; sourceDate: string; images: YesterdayLogImage[] }
  | { error: 'session' | 'not_found' | 'copy_failed' | 'too_long' | 'images'; sourceDate?: string };
type Database = Pick<ReturnType<typeof createDatabase>, 'queryWorkLogs' | 'listWorkLogAttachments'>;

export function yesterdayWorkLogDraft(database: Database, userId: string, now = new Date(), appOrigin?: string): YesterdayWorkLogResult {
  const reportDate = workTraceReportDate(now);
  const previous = new Date(`${reportDate}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const sourceDate = previous.toISOString().slice(0, 10);
  const log = database.queryWorkLogs({ authorId: userId, reportDate: sourceDate, limit: 1 }).items[0];
  if (!log || log.authorId !== userId) return { error: 'not_found', sourceDate };
  let markdownContent = workLogMarkdownContent(log);
  const attachments = database.listWorkLogAttachments(log.id);
  const images: YesterdayLogImage[] = attachments.map((attachment) => {
    const url = `/api/v1/work-logs/${log.id}/attachments/${attachment.id}`;
    return { sources: [url], url, filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size };
  });
  const embedded = new Set<string>();
  for (const image of markdownImageContent(markdownContent).images) {
    let url: URL;
    try { url = new URL(image.source, appOrigin ?? 'https://worktrace.invalid'); }
    catch { continue; }
    const local = image.source.startsWith('/') && !image.source.startsWith('//') || Boolean(appOrigin && url.origin === appOrigin);
    if (!local) continue;
    const match = url.pathname.match(/^\/api\/v1\/work-logs\/([^/]+)\/attachments\/([^/]+)$/);
    if (!match || decodeURIComponent(match[1]) !== log.id) continue;
    const path = `/api/v1/work-logs/${log.id}/attachments/${decodeURIComponent(match[2])}`;
    const attachment = images.find((candidate) => candidate.url === path);
    if (!attachment) return { error: 'images', sourceDate };
    embedded.add(attachment.url);
    if (!attachment.sources.includes(image.source)) attachment.sources.push(image.source);
  }
  // Older logs can show attachments below the Markdown body. Include them too.
  const separate = images.filter((image) => !embedded.has(image.url));
  if (separate.length) markdownContent += `\n\n### 图片附件\n\n${separate.map((image) => workLogImageMarkdown({ source: image.url, alt: image.filename })).join('\n\n')}`;
  if (images.length > 5 || images.some((image) => image.size <= 0 || image.size > 5 * 1024 * 1024)) return { error: 'images', sourceDate };
  if (markdownContent.length > maxMarkdownCharacters) return { error: 'too_long', sourceDate };
  return { markdownContent, reportDate, sourceDate, images };
}
