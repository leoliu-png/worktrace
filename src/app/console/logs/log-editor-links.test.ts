import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from '@/components/markdown-content';
import { MarkdownEditor } from '@/components/markdown-editor';
import { handleLogLinkClick, HttpLinkDecorations, installLogLinkNavigation, LogEditorLinks } from './log-editor-links';

function decoratedLinks(plugin: HttpLinkDecorations, state: EditorState) {
  const links: { from: number; to: number; href: string }[] = [];
  plugin.decorations.between(0, state.doc.length, (from, to, decoration) => {
    links.push({ from, to, href: decoration.spec.attributes.href ?? decoration.spec.attributes['data-wt-log-href'] });
  });
  return links;
}

describe('log editor background Markdown parsing', () => {
  it('refreshes stale link decorations after parsing a long reopened log without text or viewport changes', () => {
    const href = 'https://example.test/plain?q=1#section';
    const source = [
      '本地合成段落。\n\n'.repeat(3000),
      '[已有链接](https://example.test/existing)',
      '',
      '> - 引用中的嵌套代码',
      '>   ~~~text',
      '>   https://example.test/fenced',
      '>   ~~~',
      '',
      '正文 ' + href + ' 结束',
    ].join('\n');
    const initial = EditorState.create({ doc: source, extensions: [markdown()] });
    expect(syntaxTreeAvailable(initial, source.length)).toBe(false);
    const plugin = new HttpLinkDecorations({ state: initial });
    const pending = decoratedLinks(plugin, initial);
    expect(pending).toEqual([]);

    // Complete the parser's pending work, then publish it in an empty
    // transaction, as a background parsing update does. No DOM or network needed.
    expect(ensureSyntaxTree(initial, source.length, 5000)).not.toBeNull();
    const parsed = initial.update({});
    expect(parsed.docChanged).toBe(false);
    expect(syntaxTree(parsed.state)).not.toBe(syntaxTree(initial));
    expect(syntaxTreeAvailable(parsed.state, source.length)).toBe(true);
    plugin.update({
      startState: initial,
      state: parsed.state,
      docChanged: parsed.docChanged,
      viewportChanged: false,
    });

    const from = source.lastIndexOf(href);
    const existing = 'https://example.test/existing';
    const label = source.indexOf('已有链接');
    const destination = source.indexOf(existing);
    const expectedMarkdown = [
      { from: label, to: label + 4, href: existing },
      { from: destination, to: destination + existing.length, href: existing },
    ];
    expect(decoratedLinks(plugin, parsed.state)).toEqual([
      ...expectedMarkdown, { from, to: from + href.length, href },
    ]);
    expect(parsed.state.doc.toString()).toBe(source);

    // The same installed plugin continues to follow edits after parsing.
    const replacement = 'http://example.test/edited';
    const edited = parsed.state.update({ changes: { from, to: from + href.length, insert: replacement } });
    plugin.update({
      startState: parsed.state,
      state: edited.state,
      docChanged: edited.docChanged,
      viewportChanged: false,
    });
    // An edit can invalidate the parsed tail again. The editor deliberately
    // leaves that tail inert until background parsing catches up, so publish
    // the completed tree before asserting that every late link is available.
    expect(ensureSyntaxTree(edited.state, edited.state.doc.length, 5000)).not.toBeNull();
    const reparsed = edited.state.update({});
    expect(reparsed.docChanged).toBe(false);
    expect(syntaxTreeAvailable(reparsed.state, reparsed.state.doc.length)).toBe(true);
    plugin.update({
      startState: edited.state,
      state: reparsed.state,
      docChanged: false,
      viewportChanged: false,
    });
    expect(decoratedLinks(plugin, reparsed.state)).toEqual([
      ...expectedMarkdown,
      { from, to: from + replacement.length, href: replacement },
    ]);
    expect(reparsed.state.doc.toString()).toBe(source.slice(0, from) + replacement + source.slice(from + href.length));
  });
});

function localClick(button = 0, ctrlKey = false, metaKey = false) {
  const counts = { prevented: 0, stopped: 0 };
  return {
    counts, button, ctrlKey, metaKey,
    preventDefault: () => { counts.prevented++; },
    stopImmediatePropagation: () => { counts.stopped++; },
  };
}

describe('log link activation and saved reader', () => {
  it('renders both saved link formats before the detail editor hydrates', () => {
    const href = 'https://example.test/issue/AI-2793';
    const ordinary = '普通文字完整保留，𠮷。';
    const source = '[mobius](' + href + ')\n\n' + ordinary + ' ' + href;
    const html = renderToStaticMarkup(createElement(LogEditorLinks, {
      readOnly: true,
      children: createElement(MarkdownEditor, { initialValue: source, readOnly: true },
        createElement(MarkdownContent, { value: source }),
      ),
    }));
    expect(html.split('href="' + href + '"')).toHaveLength(3);
    expect(html).toContain('>mobius</a>');
    expect(html).toContain(ordinary);
    expect(html).not.toContain('role="toolbar"');
    expect(html).not.toContain('name="markdownContent"');
  });

  it.each(['http', 'https'])('keeps both %s formats clickable with exactly the saved destination', (scheme) => {
    const href = scheme + '://example.test/issue/AI-2793';
    const source = '[mobius](' + href + ')\n普通文本 ' + href;
    const editable = EditorState.create({ doc: source, extensions: [markdown()] });
    const saved = editable.doc.toString();
    const reader = EditorState.create({ doc: saved, extensions: [markdown(), EditorState.readOnly.of(true)] });
    const editorLinks = decoratedLinks(new HttpLinkDecorations({ state: editable }), editable);
    const readerLinks = decoratedLinks(new HttpLinkDecorations({ state: reader }), reader);
    expect(editorLinks).toHaveLength(3);
    expect(readerLinks).toEqual(editorLinks);
    const opened: string[] = [];
    for (const link of editorLinks) {
      expect(link.href).toBe(href);
      const event = localClick(0, true);
      expect(handleLogLinkClick(event, link.href, (target) => { opened.push(target); })).toBe(true);
      expect(event.counts).toEqual({ prevented: 1, stopped: 1 });
    }
    for (const link of readerLinks) {
      expect(handleLogLinkClick(localClick(), link.href, (target) => { opened.push(target); })).toBe(true);
    }
    expect(opened).toEqual(Array(6).fill(href));
    expect(reader.doc.toString()).toBe(source);
    expect(editable.doc.toString()).toBe(source);
  });

  it('opens ordinary, Ctrl, Command and middle clicks exactly once', () => {
    const href = 'https://example.invalid/issue/AI-2793';
    const opened: string[] = [];
    const open = (target: string) => { opened.push(target); };
    const ordinary = localClick();
    expect(handleLogLinkClick(ordinary, href, open)).toBe(true);
    expect(ordinary.counts).toEqual({ prevented: 1, stopped: 1 });
    expect(opened).toEqual([href]);
    for (const event of [localClick(0, true), localClick(0, false, true), localClick(1)]) {
      expect(handleLogLinkClick(event, href, open)).toBe(true);
      expect(event.counts).toEqual({ prevented: 1, stopped: 1 });
    }
    expect(opened).toEqual([href, href, href, href]);
  });

  it('leaves unrelated events alone and rejects invalid destinations without navigation', () => {
    const opened: string[] = [];
    for (const href of ['javascript:alert(1)', 'data:text/plain,https://example.invalid/', 'https://', 'https://[invalid']) {
      const event = localClick(0, true);
      expect(handleLogLinkClick(event, href, (target) => { opened.push(target); })).toBe(false);
      expect(event.counts).toEqual({ prevented: 0, stopped: 0 });
    }
    const rightClick = localClick(2, true);
    expect(handleLogLinkClick(rightClick, 'https://example.invalid/issue/AI-2793', (target) => { opened.push(target); })).toBe(false);
    expect(rightClick.counts).toEqual({ prevented: 0, stopped: 0 });
    expect(opened).toEqual([]);
  });

  it('refreshes accessibility and hints after a read-only lifecycle update without changing text', () => {
    const mode = new Compartment();
    const source = '[mobius](https://example.invalid/issue/AI-2793)\nhttp://example.invalid/issue/AI-2793';
    const editable = EditorState.create({ doc: source, extensions: [markdown(), mode.of(EditorState.readOnly.of(false))] });
    const plugin = new HttpLinkDecorations({ state: editable });
    const attributes = () => {
      const values: Record<string, string>[] = [];
      plugin.decorations.between(0, source.length, (_from, _to, decoration) => { values.push(decoration.spec.attributes); });
      return values;
    };
    expect(attributes().every((value) => value.tabindex === '-1')).toBe(true);
    const updated = editable.update({ effects: mode.reconfigure(EditorState.readOnly.of(true)) });
    expect(updated.docChanged).toBe(false);
    plugin.update({ startState: editable, state: updated.state, docChanged: false, viewportChanged: false });
    expect(attributes()).toHaveLength(3);
    expect(attributes().every((value) => value.tabindex === '0' && value.title === '点击打开链接')).toBe(true);
    expect(updated.state.doc.toString()).toBe(source);

    const editableAgain = updated.state.update({ effects: mode.reconfigure(EditorState.readOnly.of(false)) });
    plugin.update({ startState: updated.state, state: editableAgain.state, docChanged: false, viewportChanged: false });
    expect(attributes()).toHaveLength(3);
    expect(attributes().every((value) => value.tabindex === '-1' && value.title === '点击打开链接；拖动选择文字可编辑')).toBe(true);
    expect(editableAgain.state.doc.toString()).toBe(source);
  });
});

// A small local DOM fixture drives native EventTarget listeners without a browser,
// network, clipboard permissions or an additional DOM dependency. Browser paste
// and popup interception remain separate acceptance checks.
class LocalLinkElement extends EventTarget {
  constructor(
    readonly tagName = 'SPAN',
    readonly attributes: Record<string, string> = {},
    readonly parentElement: LocalLinkElement | null = null,
  ) { super(); }

  getAttribute(name: string) { return this.attributes[name] ?? null; }

  closest(): LocalLinkElement | null {
    for (let element: LocalLinkElement | null = this; element; element = element.parentElement) {
      if (element.getAttribute('data-wt-log-href') !== null ||
          (element.tagName === 'A' && element.getAttribute('href') !== null)) return element;
    }
    return null;
  }

  contains(target: LocalLinkElement): boolean {
    for (let element: LocalLinkElement | null = target; element; element = element.parentElement) {
      if (element === this) return true;
    }
    return false;
  }
}

function navigationFixture(initial: EditorState, useDefaultOpener = false) {
  let state = initial;
  const dom = Object.assign(new EventTarget(), {
    ownerDocument: { defaultView: { Element: LocalLinkElement } },
  });
  const contentDOM = new LocalLinkElement('DIV');
  const view = {
    dom: dom as unknown as EditorView['dom'],
    contentDOM: contentDOM as unknown as EditorView['contentDOM'],
    get state() { return state; },
  };
  const opened: string[] = [];
  const destroy = installLogLinkNavigation(view, useDefaultOpener ? undefined : (href) => { opened.push(href); });
  return {
    contentDOM, dom, opened, destroy,
    setState(next: EditorState) { state = next; },
    dispatch(type: string, target: EventTarget, properties: Record<string, unknown> = {}) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'target', { value: target });
      Object.assign(event, { button: 0, ctrlKey: false, metaKey: false, key: '', repeat: false, isComposing: false }, properties);
      dom.dispatchEvent(event);
      return event;
    },
  };
}

describe('log link production navigation intercepted locally', () => {
  it.each([false, true])('preserves exact targets across editing, reading and reopening (popup blocked: %s)', (blocked) => {
    const href = 'https://example.test/issue/AI-2793';
    const ordinary = '普通中文，编号0042，𠮷。';
    const source = ordinary + '\n[mobius](' + href + ')\n' + href + '\n结束文字';
    // Intercept the actual default opener, rather than replacing the navigation
    // callback. Neither a successful popup nor a blocked one may access a URL.
    const open = vi.fn(() => blocked ? null : {});
    const pasted = EditorState.create({ doc: ordinary, extensions: [markdown()] }).update({
      changes: { from: 0, to: ordinary.length, insert: source },
      userEvent: 'input.paste',
    }).state;
    const saved = pasted.doc.toString();
    const reader = EditorState.create({ doc: saved, extensions: [markdown(), EditorState.readOnly.of(true)] });
    const reopened = EditorState.create({ doc: saved, extensions: [markdown()] });
    vi.stubGlobal('window', { open });
    try {
      for (const pending of [pasted, reader, reopened]) {
        // These assertions exercise navigation after parsing. A headless state
        // has no editor background worker to publish the completed syntax tree.
        expect(ensureSyntaxTree(pending, pending.doc.length, 5000)).not.toBeNull();
        const state = pending.update({}).state;
        const fixture = navigationFixture(state, true);
        const targets: LocalLinkElement[] = [];
        const before = open.mock.calls.length;
        try {
          const decorations = new HttpLinkDecorations({ state });
          decorations.decorations.between(0, state.doc.length, (_from, _to, decoration) => {
            targets.push(new LocalLinkElement(
              decoration.spec.tagName.toUpperCase(), decoration.spec.attributes, fixture.contentDOM,
            ));
          });
          expect(targets).toHaveLength(3); // Markdown label, destination and bare URL.
          expect(fixture.dispatch('click', targets[0]).defaultPrevented).toBe(true);
          expect(fixture.dispatch('click', targets[1], { ctrlKey: true }).defaultPrevented).toBe(true);
          expect(fixture.dispatch('auxclick', targets[2], { button: 1 }).defaultPrevented).toBe(true);
          expect(fixture.dispatch('keydown', targets[0], { key: 'Enter' }).defaultPrevented).toBe(true);
          expect(open.mock.calls.slice(before)).toEqual(Array.from({ length: 4 }, () => [
            href, '_blank', 'noopener,noreferrer',
          ]));
          expect(state.doc.toString()).toBe(source);
        } finally { fixture.destroy(); }
        // Unmounting must remove interception even when the browser blocked a popup.
        expect(fixture.dispatch('click', targets[0]).defaultPrevented).toBe(false);
        expect(open).toHaveBeenCalledTimes(before + 4);
      }
      expect(open).toHaveBeenCalledTimes(12);
      expect(saved).toBe(source);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('log link DOM event routing with a local opener', () => {
  it.each(['http', 'https'])('intercepts exact %s destinations after a paste transaction and reopening the saved text', (scheme) => {
    const href = scheme + '://example.test/issue/AI-2793';
    const ordinary = '普通中文文本，编号0042，日期2026-10-21。𠮷\n';
    const initial = EditorState.create({ doc: ordinary, extensions: [markdown()] });
    const fixture = navigationFixture(initial);
    const plugin = new HttpLinkDecorations({ state: initial });
    const pasted = initial.update({
      changes: { from: initial.doc.length, insert: '[mobius](' + href + ')\n' + href },
      userEvent: 'input.paste',
    });
    expect(pasted.isUserEvent('input.paste')).toBe(true);
    const saved = pasted.state.doc.toString();
    const reader = EditorState.create({ doc: saved, extensions: [markdown(), EditorState.readOnly.of(true)] });
    const reopened = EditorState.create({ doc: saved, extensions: [markdown()] });
    let previous = initial;
    try {
      for (const state of [pasted.state, reader, reopened]) {
        fixture.setState(state);
        plugin.update({ startState: previous, state, docChanged: true, viewportChanged: false });
        const targets: LocalLinkElement[] = [];
        plugin.decorations.between(0, state.doc.length, (_from, _to, decoration) => {
          const element = new LocalLinkElement(
            decoration.spec.tagName.toUpperCase(), decoration.spec.attributes, fixture.contentDOM,
          );
          // Clicking nested label formatting must resolve its enclosing link.
          targets.push(new LocalLinkElement('STRONG', {}, element));
        });
        expect(targets).toHaveLength(3);
        for (const target of targets) {
          const before = fixture.opened.length;
          const modifiers = {};
          expect(fixture.dispatch('mousedown', target, modifiers).defaultPrevented).toBe(state.readOnly);
          expect(fixture.opened).toHaveLength(before);
          expect(fixture.dispatch('click', target, modifiers).defaultPrevented).toBe(true);
          expect(fixture.opened).toHaveLength(before + 1);
          expect(fixture.opened[before]).toBe(href);
        }
        expect(state.doc.toString()).toBe(saved);
        expect(saved.startsWith(ordinary)).toBe(true);
        previous = state;
      }
      expect(fixture.opened).toEqual(Array(9).fill(href));
    } finally { fixture.destroy(); }
  });

  it('preserves editing, handles Command/middle/keyboard activation and removes all listeners', () => {
    const state = EditorState.create({ extensions: [markdown()] });
    const fixture = navigationFixture(state);
    const href = 'https://example.invalid/issue/AI-2793?词=𠮷#章节';
    const anchor = new LocalLinkElement('A', { href }, fixture.contentDOM);
    const target = new LocalLinkElement('EM', {}, anchor);
    let unhandled = 0;
    const observe = () => { unhandled++; };
    for (const type of ['mousedown', 'click', 'auxclick', 'keydown', 'paste']) fixture.dom.addEventListener(type, observe);
    try {
      expect(fixture.dispatch('mousedown', target).defaultPrevented).toBe(false);
      expect(fixture.dispatch('click', target).defaultPrevented).toBe(true);
      expect(fixture.opened).toEqual([href]);
      expect(fixture.dispatch('click', target, { metaKey: true }).defaultPrevented).toBe(true);
      expect(fixture.dispatch('mousedown', target, { button: 1 }).defaultPrevented).toBe(true);
      expect(fixture.dispatch('auxclick', target, { button: 1 }).defaultPrevented).toBe(true);
      expect(fixture.dispatch('keydown', target, { key: 'Enter' }).defaultPrevented).toBe(true);
      expect(fixture.opened).toEqual([href, href, href, href]);
      // Prevent native anchor activation for a held Enter, without opening again.
      expect(fixture.dispatch('keydown', target, { key: 'Enter', repeat: true }).defaultPrevented).toBe(true);
      expect(unhandled).toBe(1); // Only the ordinary mousedown reached other listeners.
      // IME confirmation, normal keys and paste must remain available to editing.
      for (const properties of [{ key: 'Enter', isComposing: true }, { key: 'a' }]) {
        expect(fixture.dispatch('keydown', target, properties).defaultPrevented).toBe(false);
      }
      expect(fixture.dispatch('paste', target).defaultPrevented).toBe(false);
      expect(fixture.opened).toHaveLength(4);

      fixture.destroy();
      const before = unhandled;
      for (const type of ['mousedown', 'click', 'auxclick', 'keydown']) {
        expect(fixture.dispatch(type, target, { ctrlKey: true, button: type === 'auxclick' ? 1 : 0, key: 'Enter' }).defaultPrevented).toBe(false);
      }
      expect(unhandled).toBe(before + 4);
      expect(fixture.opened).toHaveLength(4);
    } finally { fixture.destroy(); }
  });

  it('keeps drag selections editable without opening a link and follows selection-only updates', () => {
    const href = 'https://example.test/issue/AI-2793';
    const initial = EditorState.create({ doc: href, extensions: [markdown()] });
    const fixture = navigationFixture(initial);
    const anchor = new LocalLinkElement('A', { href }, fixture.contentDOM);
    try {
      const selected = initial.update({ selection: { anchor: 0, head: href.length } }).state;
      fixture.setState(selected);
      expect(fixture.dispatch('mousedown', anchor).defaultPrevented).toBe(false);
      expect(fixture.dispatch('click', anchor).defaultPrevented).toBe(true);
      expect(fixture.opened).toEqual([]);
      expect(selected.doc.toString()).toBe(href);
      expect(fixture.dispatch('keydown', anchor, { key: 'a' }).defaultPrevented).toBe(false);
      expect(fixture.dispatch('paste', anchor).defaultPrevented).toBe(false);

      fixture.setState(selected.update({ selection: { anchor: 0 } }).state);
      expect(fixture.dispatch('click', anchor).defaultPrevented).toBe(true);
      expect(fixture.opened).toEqual([href]);

      const reader = EditorState.create({
        doc: href,
        selection: { anchor: 0, head: href.length },
        extensions: [markdown(), EditorState.readOnly.of(true)],
      });
      fixture.setState(reader);
      expect(fixture.dispatch('click', anchor).defaultPrevented).toBe(true);
      expect(fixture.opened).toEqual([href, href]);
    } finally { fixture.destroy(); }
  });

  it('ignores outside links, plain text, non-elements, unsafe URLs and right clicks', () => {
    const fixture = navigationFixture(EditorState.create({ extensions: [markdown()] }));
    const href = 'http://example.invalid/issue/AI-2793';
    const targets = [
      new LocalLinkElement('A', { href }),
      new LocalLinkElement('SPAN', {}, fixture.contentDOM),
      new EventTarget(),
      ...['javascript:alert(1)', 'data:text/plain,https://example.invalid/', 'https://[invalid'].map(
        (value) => new LocalLinkElement('A', { href: value }, fixture.contentDOM),
      ),
    ];
    try {
      for (const target of targets) {
        expect(fixture.dispatch('click', target, { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(fixture.dispatch('keydown', target, { key: 'Enter' }).defaultPrevented).toBe(false);
      }
      const anchor = new LocalLinkElement('A', { href }, fixture.contentDOM);
      expect(fixture.dispatch('auxclick', anchor, { button: 2 }).defaultPrevented).toBe(false);
      expect(fixture.opened).toEqual([]);
    } finally { fixture.destroy(); }
  });
});
