import { readImageAttachment } from './attachments';
import type { LocalWorkLog } from './db';
import { workLogMarkdownContent } from './markdown-work-log';
import { markdownImageContent, workLogImageMarkdown } from './markdown-work-log-images';
import { workLogImageSignature } from './shared-work-log-images';
import type { TimeOffSyncDatabase } from './time-off-sync';
import type { TimeOffImageWarning } from './time-off-types';

export async function prepareTimeOffJournal(log: LocalWorkLog, database: TimeOffSyncDatabase) {
  let markdown = workLogMarkdownContent(log);
  const referenced = markdownImageContent(markdown).images;
  const separate = database.listWorkLogAttachments(log.id).filter((attachment) => !referenced.some((image) => {
    try { return new URL(image.source, 'https://worktrace.invalid').pathname === `/api/v1/work-logs/${log.id}/attachments/${attachment.id}`; }
    catch { return false; }
  }));
  if (separate.length) markdown += `\n\n${separate.map((attachment) => workLogImageMarkdown({ source: `/api/v1/work-logs/${log.id}/attachments/${attachment.id}`, alt: attachment.filename })).join('\n\n')}`;
  let origin: string | undefined;
  for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.AUTH_URL]) {
    try {
      const url = new URL(value ?? '');
      if (!url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost' && process.env.NODE_ENV !== 'production'))) {
        origin = url.origin;
        break;
      }
    } catch {}
  }
  const warnings: TimeOffImageWarning[] = [];
  const replacements: Array<{ from: number; to: number; content: string }> = [];
  for (const image of markdownImageContent(markdown).imageRanges) {
    const alt = (image.alt || '日志图片').replace(/[\[\]<>!*_`\\]/g, '').replace(/\s+/g, ' ').slice(0, 180);
    const omit = (reason: TimeOffImageWarning['reason']) => {
      warnings.push({ alt, reason });
      replacements.push({ from: image.from, to: image.to, content: `（图片“${alt}”暂未同步，请在 WorkTrace 中补传或修复图片后重新同步。）` });
    };
    let url: URL;
    try { url = new URL(image.source, origin ?? 'https://worktrace.invalid'); }
    catch { omit('invalid_url'); continue; }
    const local = image.source.startsWith('/') && !image.source.startsWith('//') || Boolean(origin && url.origin === origin);
    if (!local) {
      if (url.protocol === 'blob:' || url.protocol === 'data:') omit('not_saved');
      else if (url.protocol !== 'https:' || url.username || url.password) omit('invalid_url');
      continue;
    }
    const reference = url.pathname.match(/^\/api\/v1\/work-logs\/([^/]+)\/attachments\/([^/]+)$/);
    if (!reference || url.username || url.password) { omit('invalid_url'); continue; }
    let sourceId: string;
    let attachmentId: string;
    try { sourceId = decodeURIComponent(reference[1]); attachmentId = decodeURIComponent(reference[2]); }
    catch { omit('invalid_url'); continue; }
    const source = sourceId === log.id ? log : database.getWorkLog(sourceId);
    const attachment = database.getWorkLogAttachment(sourceId, attachmentId);
    if (!source || !attachment) { omit('missing'); continue; }
    if (source.authorId !== log.authorId) { omit('different_author'); continue; }
    if (!origin) { omit('public_url_missing'); continue; }
    try { await readImageAttachment(attachment.storageKey); }
    catch { omit('file_missing'); continue; }
    try {
      const shared = new URL(`/api/v1/work-logs/${encodeURIComponent(sourceId)}/attachments/${encodeURIComponent(attachment.id)}`, origin);
      shared.searchParams.set('share', workLogImageSignature(attachment));
      replacements.push({ from: image.from, to: image.to, content: workLogImageMarkdown({ source: shared.href, alt: image.alt }) });
    } catch { omit('configuration'); }
  }
  for (const replacement of replacements.reverse()) markdown = markdown.slice(0, replacement.from) + replacement.content + markdown.slice(replacement.to);
  return { markdown, warnings };
}
