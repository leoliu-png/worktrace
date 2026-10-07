import { EditorState, type TransactionSpec } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';
import { imagePasteInsertion, orderedListRenumbering } from './markdown-editing';

function editor(doc: string) {
  let state = EditorState.create({ doc, extensions: [markdown(), history(), orderedListRenumbering] });
  return {
    get state() { return state; },
    dispatch(transaction: TransactionSpec) { state = state.update(transaction).state; },
  };
}

describe('automatic Markdown list numbering', () => {
  it('renumbers after removing a middle item and preserves the caret and undo/redo', () => {
    const initial = '1. first\n2. second\n3. third';
    const view = editor(initial);
    const from = initial.indexOf('2.');
    view.dispatch({ changes: { from, to: initial.indexOf('3.') }, selection: { anchor: from + 3 }, userEvent: 'delete' });
    expect(view.state.doc.toString()).toBe('1. first\n2. third');
    expect(view.state.selection.main.head).toBe(from + 3);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(initial);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. first\n2. third');
  });

  it('keeps the original start when the first item is removed', () => {
    const view = editor('1. first\n2. second\n3. third');
    view.dispatch({ changes: { from: 0, to: 9 }, userEvent: 'delete' });
    expect(view.state.doc.toString()).toBe('1. second\n2. third');
  });

  it('numbers pasted items and nested lists independently without modifying code', () => {
    const view = editor('');
    view.dispatch({ changes: { from: 0, insert: '1. first\n1. second\n   1. child\n   6. child\n1. third\n\n```md\n1. code\n9. code\n```\n\n    1. indented code\n    8. code' }, userEvent: 'input.paste' });
    expect(view.state.doc.toString()).toBe('1. first\n2. second\n   1. child\n   2. child\n3. third\n\n```md\n1. code\n9. code\n```\n\n    1. indented code\n    8. code');
  });

  it('continues numbering around wrapped content and a separately started list', () => {
    const view = editor('');
    view.dispatch({ changes: { from: 0, insert: '1. first\n   continuation\n\n1. second\n\nparagraph\n\n7) separate\n1) next' }, userEvent: 'input.paste' });
    expect(view.state.doc.toString()).toBe('1. first\n   continuation\n\n2. second\n\nparagraph\n\n7) separate\n8) next');
  });

  it('allows editing the initial number and maps the caret across wider markers', () => {
    const view = editor('8. first\n9. second\n10. last');
    const head = view.state.doc.length;
    view.dispatch({ changes: { from: 0, to: 1, insert: '10' }, selection: { anchor: head + 1 }, userEvent: 'input' });
    expect(view.state.doc.toString()).toBe('10. first\n11. second\n12. last');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });
});

describe('pasted image spacing', () => {
  const image = '![image](blob:image)';
  it.each([
    { text: '', from: 0, to: 0, expected: `${image}\n` },
    { text: 'text\n', from: 5, to: 5, expected: `text\n${image}\n` },
    { text: 'text\n\nnext', from: 5, to: 5, expected: `text\n${image}\nnext` },
    { text: 'beforeafter', from: 6, to: 6, expected: `before\n${image}\nafter` },
    { text: 'before\nreplace\nafter', from: 7, to: 14, expected: `before\n${image}\nafter` },
  ])('uses necessary line breaks and leaves the caret after the image: $text', ({ text, from, to, expected }) => {
    const result = imagePasteInsertion(text, from, to, [image]);
    const updated = text.slice(0, from) + result.insert + text.slice(to);
    expect(updated).toBe(expected);
    expect(result.anchor).toBe(updated.indexOf(image) + image.length + 1);
    expect(updated).not.toContain('\n\n');
  });

  it('places multiple pasted images on consecutive lines', () => {
    const result = imagePasteInsertion('', 0, 0, [image, image]);
    expect(result.insert).toBe(`${image}\n${image}\n`);
  });
});
