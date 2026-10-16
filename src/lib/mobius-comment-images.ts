import path from 'node:path';
import { readImageAttachment, validateImageAttachment } from './attachments';
import type { LocalWorkLog } from './db';
import type { MobiusSyncDatabase } from './mobius-sync';
import type { WorkLogEntry } from './mobius-work-log';
import { markdownImageContent, type WorkLogImage } from './markdown-work-log-images';

type Upload = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export class MobiusImageSyncError extends Error {
  constructor() { super('A work-log image could not be synchronized to Mobius.'); this.name = 'MobiusImageSyncError'; }
}

function safeImageUrl(source: string, base?: string) {
  const url = new URL(source, base);
  if (url.protocol !== 'https:' || url.username || url.password) throw new MobiusImageSyncError();
  return url.href;
}

function uploadedImageUrl(result: Record<string, unknown>, mobiusOrigin: string) {
  const attachment = result.attachment as Record<string, unknown> | undefined;
  const source = typeof result.url === 'string' ? result.url
    : typeof attachment?.url === 'string' ? attachment.url
      : typeof result.markdown === 'string' ? markdownImageContent(result.markdown).images[0]?.source : undefined;
  if (!source) throw new MobiusImageSyncError();
  return safeImageUrl(source, mobiusOrigin);
}

// Stage files without changing the issue, then recheck its eligibility and
// Participating membership before publishing a comment containing the images.
export function createMobiusCommentImageSync(log: Pick<LocalWorkLog, 'id'>, database: Pick<MobiusSyncDatabase, 'getWorkLogAttachment'>, upload: Upload, appOrigin?: string) {
  const uploaded = new Map<string, Promise<string>>();
  const mobiusOrigin = new URL(process.env.MOBIUS_MCP_URL ?? 'https://mobius.feedmob.com/api/mcp').origin;

  async function copyImage(image: WorkLogImage) {
    try {
      const source = new URL(image.source, appOrigin ?? 'https://worktrace.invalid');
      const local = image.source.startsWith('/') && !image.source.startsWith('//')
        || Boolean(appOrigin && source.origin === appOrigin);
      const reference = local ? source.pathname.match(/^\/api\/v1\/work-logs\/([^/]+)\/attachments\/([^/]+)$/) : null;
      if (!reference) {
        // Existing HTTPS image links can be rendered directly by Mobius.
        // Never expose an unresolved blob URL or a private relative endpoint.
        if (!/^https:\/\//i.test(image.source)) throw new MobiusImageSyncError();
        return safeImageUrl(image.source);
      }
      if (decodeURIComponent(reference[1]) !== log.id) throw new MobiusImageSyncError();
      const attachment = database.getWorkLogAttachment(log.id, decodeURIComponent(reference[2]));
      if (!attachment) throw new MobiusImageSyncError();
      const bytes = await readImageAttachment(attachment.storageKey);
      const validated = validateImageAttachment({ filename: attachment.filename, mimeType: attachment.mimeType, size: bytes.length, bytes });
      const result = await upload({
        filename: `${path.parse(validated.filename).name || 'work-log-image'}.${validated.extension}`,
        mimeType: validated.mimeType,
        dataBase64: bytes.toString('base64'),
      });
      return uploadedImageUrl(result, mobiusOrigin);
    } catch { throw new MobiusImageSyncError(); }
  }

  return async (entries: WorkLogEntry[]): Promise<WorkLogEntry[]> => {
    const result: WorkLogEntry[] = [];
    for (const entry of entries) {
      if (!entry.images?.length) { result.push(entry); continue; }
      const images: WorkLogImage[] = [];
      for (const image of entry.images) {
        if (!uploaded.has(image.source)) uploaded.set(image.source, copyImage(image));
        images.push({ ...image, source: await uploaded.get(image.source)! });
      }
      result.push({ ...entry, images });
    }
    return result;
  };
}
