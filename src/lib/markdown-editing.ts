import { EditorState, MapMode } from '@codemirror/state';
import { parser } from '@lezer/markdown';

type ListItem = { from: number; to: number; number: number };

function orderedLists(text: string): ListItem[][] {
  const lists: ListItem[][] = [];
  parser.parse(text).iterate({
    enter(node) {
      if (node.name !== 'OrderedList') return;
      const items: ListItem[] = [];
      for (const item of node.node.getChildren('ListItem')) {
        const marker = item.getChild('ListMark');
        if (!marker) continue;
        const digits = text.slice(marker.from, marker.to).match(/^\d+/)?.[0];
        if (digits) items.push({ from: marker.from, to: marker.from + digits.length, number: Number(digits) });
      }
      if (items.length) lists.push(items);
    },
  });
  return lists;
}

// Keep numbering in the same transaction as the edit so cursor positions and undo stay consistent.
export const orderedListRenumbering = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) return transaction;
  const text = transaction.newDoc.toString();
  const lists = orderedLists(text);
  if (!lists.length) return transaction;

  const editedRanges: { from: number; to: number }[] = [];
  transaction.changes.iterChangedRanges((from, to) => editedRanges.push({ from, to }));
  const previousStarts = new Map<number, number>();
  for (const items of orderedLists(transaction.startState.doc.toString())) {
    for (const item of items) {
      if (editedRanges.some(({ from, to }) => from < item.to && to > item.from)) continue;
      const position = transaction.changes.mapPos(item.from, 1, MapMode.TrackDel);
      if (position !== null) previousStarts.set(position, items[0].number);
    }
  }

  const changes: { from: number; to: number; insert: string }[] = [];
  for (const items of lists) {
    // If the first item was removed, the surviving item inherits the original list's start number.
    const start = previousStarts.get(items[0].from) ?? items[0].number;
    items.forEach((item, index) => {
      const number = String(start + index);
      if (text.slice(item.from, item.to) !== number) changes.push({ from: item.from, to: item.to, insert: number });
    });
  }
  changes.sort((a, b) => a.from - b.from);
  return changes.length ? [transaction, { changes, sequential: true }] : transaction;
});

export function imagePasteInsertion(text: string, from: number, to: number, images: string[]) {
  const before = text.slice(0, from);
  const after = text.slice(to);
  const prefix = before && !before.endsWith('\n') ? '\n' : '';
  const reuseNewline = after.startsWith('\n');
  const insert = `${prefix}${images.join('\n')}${reuseNewline ? '' : '\n'}`;
  return { insert, anchor: from + insert.length + (reuseNewline ? 1 : 0) };
}
