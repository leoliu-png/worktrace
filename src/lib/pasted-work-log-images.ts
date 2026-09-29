import type { LocalWorkLogAttachment } from './db';

export type PendingPastedImage = { source: string; file: File };

export function pendingPastedImages(formData: FormData, markdown: string): PendingPastedImage[] {
  const rawFiles = formData.getAll('pastedImages').filter((value): value is File => typeof value !== 'string' && value.size > 0);
  let sources: unknown;
  try { sources = JSON.parse(String(formData.get('pastedImageSources') ?? '[]')); }
  catch { throw new Error('Invalid pasted image references'); }
  if (!Array.isArray(sources) || sources.length !== rawFiles.length || sources.length > 5) throw new Error('Invalid pasted image count');
  if (new Set(sources).size !== sources.length || sources.some((source) => typeof source !== 'string' || !/^blob:[^\s()]{1,500}$/.test(source))) throw new Error('Invalid pasted image source');

  const images = sources.map((source, index) => ({ source: source as string, file: rawFiles[index] }));
  const referenced = images.filter(({ source }) => markdown.includes(`](${source})`));
  if (referenced.some(({ file }) => file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))) throw new Error('Invalid pasted image file');
  const embeddedSources = markdown.match(/!\[[^\]]*\]\((blob:[^\s)]+)\)/g) ?? [];
  if (embeddedSources.some((image) => !sources.some((source) => image.includes(`](${source})`)))) throw new Error('Unmatched pasted image');
  return referenced;
}

export function replacePastedImageSources(markdown: string, images: PendingPastedImage[], attachments: LocalWorkLogAttachment[]): string {
  if (images.length !== attachments.length) throw new Error('Pasted image count mismatch');
  return images.reduce((content, image, index) => content.replaceAll(image.source, `/api/v1/work-logs/${attachments[index].workLogId}/attachments/${attachments[index].id}`), markdown);
}
