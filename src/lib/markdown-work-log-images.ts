import { parser } from '@lezer/markdown';

export type WorkLogImage = { source: string; alt: string };

function unescape(value: string) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
}

function destination(value: string) {
  return unescape(value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value);
}

function label(value: string) {
  return unescape(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

// Use Markdown nodes so code examples, nested parentheses and reference-style
// images are handled without treating file names or URLs as matching evidence.
export function markdownImageReferences(referenceContext: string) {
  const references = new Map<string, string>();
  parser.parse(referenceContext).iterate({ enter(node) {
    if (node.name !== 'LinkReference') return;
    const key = node.node.getChild('LinkLabel');
    const url = node.node.getChild('URL');
    if (key && url) {
      const name = label(referenceContext.slice(key.from + 1, key.to - 1));
      if (!references.has(name)) references.set(name, destination(referenceContext.slice(url.from, url.to)));
    }
    return false;
  } });
  return references;
}

export function markdownImageContent(value: string, referenceContext: string | ReadonlyMap<string, string> = value) {
  const references = typeof referenceContext === 'string' ? markdownImageReferences(referenceContext) : referenceContext;

  const ranges: Array<{ from: number; to: number }> = [];
  const images: WorkLogImage[] = [];
  const imageRanges: Array<WorkLogImage & { from: number; to: number }> = [];
  parser.parse(value).iterate({ enter(node) {
    if (node.name === 'LinkReference') {
      ranges.push({ from: node.from, to: node.to });
      return false;
    }
    if (node.name !== 'Image') return;
    const close = node.node.getChildren('LinkMark').find((mark) => value.slice(mark.from, mark.to) === ']');
    const alt = unescape(value.slice(node.from + 2, close?.from ?? node.to - 1)).replace(/\s+/g, ' ').trim();
    const url = node.node.getChild('URL');
    const key = node.node.getChild('LinkLabel');
    const source = url ? destination(value.slice(url.from, url.to))
      : references.get(label(key && key.to - key.from > 2 ? value.slice(key.from + 1, key.to - 1) : alt));
    if (source) {
      images.push({ source, alt });
      imageRanges.push({ source, alt, from: node.from, to: node.to });
    }
    ranges.push({ from: node.from, to: node.to });
    return false;
  } });
  let text = '';
  let offset = 0;
  for (const range of ranges) {
    text += value.slice(offset, range.from);
    offset = range.to;
  }
  return { text: text + value.slice(offset), images, imageRanges };
}

export function replaceMarkdownImageSources(value: string, sources: ReadonlyMap<string, string>) {
  const { imageRanges } = markdownImageContent(value);
  let markdown = value;
  for (const image of imageRanges.reverse()) {
    const source = sources.get(image.source);
    if (source) markdown = markdown.slice(0, image.from) + workLogImageMarkdown({ source, alt: image.alt }) + markdown.slice(image.to);
  }
  return markdown;
}

export function mergeWorkLogImages(...groups: Array<WorkLogImage[] | undefined>) {
  return [...new Map(groups.flatMap((images) => images ?? []).map((image) => [image.source, image])).values()];
}

export function workLogImageMarkdown(image: WorkLogImage) {
  const alt = (image.alt || '日志图片').replace(/[\\[\]]/g, '\\$&').replace(/\s+/g, ' ');
  // Mobius's comment renderer expects the URL directly after "(". Encoding
  // parentheses keeps such URLs valid without the unsupported <URL> wrapper.
  const source = image.source.replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/[<>\s]/g, (character) => encodeURIComponent(character));
  return `![${alt}](${source})`;
}
