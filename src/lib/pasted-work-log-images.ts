import { parser } from '@lezer/markdown';
import type { LocalWorkLogAttachment } from './db';

export type PendingPastedImage = { source: string; file: File };
type ImageDestination = { from: number; to: number; source: string };

function unescapeMarkdown(value: string) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_\x60{|}~])/g, '$1');
}

function referenceLabel(value: string) {
  return unescapeMarkdown(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

// Use the complete Markdown tree, including nested blocks. Only image
// destinations (or definitions used by images) participate in file matching;
// code, ordinary links, alt text, titles and longer URLs remain literal.
function imageDestinations(markdown: string): ImageDestination[] {
  const destinations = new Map<number, ImageDestination>();
  const definitions = new Map<string, ImageDestination>();
  const references = new Set<string>();
  const destination = (from: number, to: number): ImageDestination => {
    const wrapped = markdown[from] === '<' && markdown[to - 1] === '>';
    if (wrapped) { from += 1; to -= 1; }
    return { from, to, source: unescapeMarkdown(markdown.slice(from, to)) };
  };
  parser.parse(markdown).iterate({ enter(node) {
    if (node.name === 'LinkReference') {
      const key = node.node.getChild('LinkLabel');
      const url = node.node.getChild('URL');
      if (key && url) {
        const label = referenceLabel(markdown.slice(key.from + 1, key.to - 1));
        if (!definitions.has(label)) definitions.set(label, destination(url.from, url.to));
      }
      return false;
    }
    if (node.name !== 'Image') return;
    const url = node.node.getChild('URL');
    if (url) {
      const range = destination(url.from, url.to);
      destinations.set(range.from, range);
    } else {
      const key = node.node.getChild('LinkLabel');
      const close = node.node.getChildren('LinkMark').find((mark) => markdown.slice(mark.from, mark.to) === ']');
      const label = key && key.to - key.from > 2
        ? markdown.slice(key.from + 1, key.to - 1)
        : markdown.slice(node.from + 2, close?.from ?? node.to - 1);
      references.add(referenceLabel(label));
    }
  } });
  for (const label of references) {
    const range = definitions.get(label);
    if (range) destinations.set(range.from, range);
  }
  return [...destinations.values()].sort((left, right) => left.from - right.from);
}

export function pendingPastedImages(formData: FormData, markdown: string): PendingPastedImage[] {
  const rawFiles = formData.getAll('pastedImages').filter((value): value is File => typeof value !== 'string' && value.size > 0);
  let sources: unknown;
  try { sources = JSON.parse(String(formData.get('pastedImageSources') ?? '[]')); }
  catch { throw new Error('Invalid pasted image references'); }
  if (!Array.isArray(sources) || sources.length !== rawFiles.length || sources.length > 5) throw new Error('Invalid pasted image count');
  if (new Set(sources).size !== sources.length || sources.some((source) => typeof source !== 'string' || !/^blob:[^\s()]{1,500}$/.test(source))) throw new Error('Invalid pasted image source');

  const images = sources.map((source, index) => ({ source: source as string, file: rawFiles[index] }));
  const embeddedSources = new Set(imageDestinations(markdown).map((image) => image.source));
  const referenced = images.filter(({ source }) => embeddedSources.has(source));
  if (referenced.some(({ file }) => file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))) throw new Error('Invalid pasted image file');
  if ([...embeddedSources].some((source) => source.startsWith('blob:') && !sources.includes(source))) throw new Error('Unmatched pasted image');
  return referenced;
}

export function replacePastedImageSources(markdown: string, images: PendingPastedImage[], attachments: LocalWorkLogAttachment[]): string {
  if (images.length !== attachments.length) throw new Error('Pasted image count mismatch');
  const replacements = new Map(images.map((image, index) =>
    [image.source, '/api/v1/work-logs/' + attachments[index].workLogId + '/attachments/' + attachments[index].id]));
  let content = markdown;
  for (const { from, to, source } of imageDestinations(markdown).reverse()) {
    const replacement = replacements.get(source);
    if (replacement) content = content.slice(0, from) + replacement + content.slice(to);
  }
  return content;
}
