import type { EditorState } from '@codemirror/state';

function indentation(line: string): number {
  return (line.match(/^[\t ]*/)?.[0] ?? '').replace(/\t/g, '    ').length;
}

function headingLevel(line: string): number | undefined {
  const match = line.match(/^ {0,3}(#{1,6})[ \t]+\S/);
  return match?.[1].length;
}

function isFence(line: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})/.test(line);
}

export function markdownFoldRange(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const doc = state.doc;
  const current = doc.lineAt(lineStart);
  if (isFence(current.text)) return null;
  let insidePreviousFence = false;
  for (let number = 1; number < current.number; number++) if (isFence(doc.line(number).text)) insidePreviousFence = !insidePreviousFence;
  if (insidePreviousFence) return null;

  const level = headingLevel(current.text);
  if (level) {
    let last = current;
    let insideFence = false;
    for (let number = current.number + 1; number <= doc.lines; number++) {
      const line = doc.line(number);
      if (isFence(line.text)) insideFence = !insideFence;
      const nextLevel = insideFence ? undefined : headingLevel(line.text);
      if (nextLevel && nextLevel <= level) break;
      if (line.text.trim()) last = line;
    }
    return last.number > current.number ? { from: current.to, to: last.to } : null;
  }

  if (!current.text.trim()) return null;
  const baseIndent = indentation(current.text);
  let last = current;
  for (let number = current.number + 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (!line.text.trim()) continue;
    if (indentation(line.text) <= baseIndent) break;
    last = line;
  }
  return last.number > current.number ? { from: current.to, to: last.to } : null;
}
