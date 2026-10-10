import { parser } from '@lezer/markdown';

type MarkdownWorkBlock = { kind: 'line' | 'item' | 'code'; text: string };

// A work item is an outer list item, including its nested lists and continuation paragraphs.
export function markdownWorkBlocks(value: string): MarkdownWorkBlock[] {
  const markdown = value.replace(/\r\n?/g, '\n');
  const ranges: { kind: 'item' | 'code'; from: number; to: number }[] = [];
  parser.parse(markdown).iterate({
    enter(node) {
      const kind = node.name === 'ListItem' ? 'item'
        : node.name === 'FencedCode' || node.name === 'CodeBlock' ? 'code' : undefined;
      if (!kind) return;
      ranges.push({ kind, from: markdown.lastIndexOf('\n', node.from - 1) + 1, to: node.to });
      return false;
    },
  });

  const blocks: MarkdownWorkBlock[] = [];
  let rangeIndex = 0;
  for (let offset = 0; offset < markdown.length;) {
    const range = ranges[rangeIndex]?.from === offset ? ranges[rangeIndex++] : undefined;
    const newline = markdown.indexOf('\n', range?.to ?? offset);
    const end = newline === -1 ? markdown.length : newline;
    blocks.push({ kind: range?.kind ?? 'line', text: markdown.slice(offset, end) });
    offset = end + 1;
  }
  return blocks;
}

function indentationWidth(value: string) {
  return [...value].reduce((width, character) => width + (character === '\t' ? 4 - width % 4 : 1), 0);
}

function removeIndentation(line: string, width: number) {
  let offset = 0;
  let removed = 0;
  while (offset < line.length && removed < width && /[ \t]/.test(line[offset])) {
    removed += line[offset++] === '\t' ? 4 - removed % 4 : 1;
  }
  return ' '.repeat(Math.max(0, removed - width)) + line.slice(offset);
}

export function markdownListItemContent(value: string) {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const marker = lines[0].match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/)?.[0];
  if (!marker) return value.replace(/\r\n?/g, '\n').trim();
  const width = indentationWidth(marker);
  return [lines[0].slice(marker.length), ...lines.slice(1).map((line) => removeIndentation(line, width))].join('\n').trim();
}

export function markdownWithoutCode(value: string) {
  const ranges: { from: number; to: number }[] = [];
  parser.parse(value).iterate({
    enter(node) {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return;
      ranges.push({ from: node.from, to: node.to });
      return false;
    },
  });
  let text = '';
  let offset = 0;
  for (const range of ranges) {
    text += value.slice(offset, range.from) + '\n';
    offset = range.to;
  }
  return text + value.slice(offset);
}
