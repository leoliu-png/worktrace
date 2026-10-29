import { markdownWorkBlocks } from './markdown-work-items';
import { workLogSectionHeading, type WorkLogSection } from './work-log-sections';

const headings: Record<WorkLogSection, string> = { completed: '完成事项', inProgress: '进行中', blockers: '阻塞 / 风险', nextPlan: '明日计划' };

// Insert at the end of the named section, preserving nested items and code.
export function appendMarkdownWorkItem(markdown: string, section: WorkLogSection, text: string): string {
  const source = markdown.replace(/\r\n?/g, '\n');
  const itemLines = text.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '').split(/\r?\n/);
  if (!itemLines[0]?.trim()) throw new Error('Work item must not be empty.');
  let offset = 0, start = -1, end = source.length;
  for (const block of markdownWorkBlocks(source)) {
    if (block.kind === 'line') {
      const match = block.text.match(/^\s*(#{1,6})\s+(.+)$/);
      const named = workLogSectionHeading(match?.[2] ?? block.text, Boolean(match));
      if (start < 0 && named === section) start = offset + block.text.length + 1;
      else if (start >= 0 && (match || named)) { end = offset; break; }
    }
    offset += block.text.length + 1;
  }
  if (start < 0) return `${source.trimEnd()}\n\n## ${headings[section]}\n- ${itemLines[0]}${itemLines.slice(1).map((line) => `\n  ${line}`).join('')}\n`;
  const content = source.slice(start, end);
  const numbered = [...content.matchAll(/^(\d+)[.)]\s+/gm)];
  const unordered = [...content.matchAll(/^[-*+]\s+/gm)];
  const marker = numbered.length && (!unordered.length || numbered.at(-1)!.index! > unordered.at(-1)!.index!) ? `${Number(numbered.at(-1)![1]) + 1}. ` : '- ';
  const continuation = ' '.repeat(marker.length);
  const item = marker + itemLines[0] + itemLines.slice(1).map((line) => `\n${continuation}${line}`).join('');
  const before = source.slice(0, end).replace(/\n+$/, '');
  const after = source.slice(end);
  return `${before}\n${item}\n${after ? `\n${after}` : ''}`;
}
