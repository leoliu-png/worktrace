import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { httpLinkRanges, isHttpLink, markdownHttpLinkRanges } from './http-link-ranges';

function editor(source: string) {
  return EditorState.create({ doc: source, extensions: [markdown()] });
}

describe('log editor HTTP links', () => {
  it('recognizes HTTP and HTTPS without changing surrounding or multiline text', () => {
    const source = '开始 http://example.test/a?x=1&y=2 后续\n下一行 HTTPS://example.test/b#section 结束';
    const state = editor(source);
    expect(httpLinkRanges(state).map((link) => link.href)).toEqual([
      'http://example.test/a?x=1&y=2', 'HTTPS://example.test/b#section',
    ]);
    for (const link of httpLinkRanges(state)) {
      expect(state.doc.sliceString(link.from, link.to)).toBe(link.href);
    }
    expect(state.doc.toString()).toBe(source);
  });

  it('leaves existing Markdown links, images, autolinks and code to the Markdown editor', () => {
    const source = [
      '[已有链接](https://example.test/markdown)',
      '![图片](https://example.test/image.png)',
      '<https://example.test/auto>',
      '`https://example.test/inline`',
      '```',
      'https://example.test/code',
      '```',
      'https://example.test/plain',
    ].join('\n');
    expect(httpLinkRanges(editor(source)).map((link) => link.href)).toEqual(['https://example.test/plain']);
  });

  it.each(['http', 'https'])('preserves exact %s destinations ending in punctuation', (scheme) => {
    for (const ending of ['!', '.', ',', ';', ':', "'", ')', ']', '}', '，', '。', '；', '！', '、', '：', '」', '』', '】', '）']) {
      for (const part of ['/path', '/?q=hello', '/#section']) {
        const href = scheme + '://example.test' + part + ending;
        const source = '链接 ' + href + ' 后续';
        const state = editor(source);
        const expected = [{ from: 3, to: 3 + href.length, href }];
        expect(httpLinkRanges(state)).toEqual(expected);
        expect(state.doc.sliceString(3, 3 + href.length)).toBe(href);
        expect(httpLinkRanges(editor(state.doc.toString()))).toEqual(expected);
      }
    }
  });

  it('keeps balanced URL parentheses', () => {
    const href = 'https://example.test/a_(b)';
    expect(httpLinkRanges(editor('参考 ' + href + ' 后续')).map((link) => link.href)).toEqual([href]);
  });

  it('recognizes HTTP and HTTPS immediately after Chinese text', () => {
    const source = '查看https://example.test/path 后续\n参考http://example.test/a?x=1&y=2 结束';
    const state = editor(source);
    const links = httpLinkRanges(state);
    expect(links.map((link) => link.href)).toEqual([
      'https://example.test/path', 'http://example.test/a?x=1&y=2',
    ]);
    for (const link of links) {
      expect(state.doc.sliceString(link.from, link.to)).toBe(link.href);
    }
    expect(state.doc.toString()).toBe(source);
    expect(httpLinkRanges(editor(state.doc.toString()))).toEqual(links);
  });

  it.each(['𠮷', '𠀀', '查看', '（', '【', '「', '『', '，', '。', '；', '：', '、'])(
    'recognizes URLs after the Unicode boundary %s and preserves Unicode destinations',
    (prefix) => {
      const href = 'https://example.test/路径/😀?词=𠮷#章节';
      const source = prefix + href + ' 后续';
      const state = editor(source);
      const expected = [{ from: prefix.length, to: prefix.length + href.length, href }];
      expect(httpLinkRanges(state)).toEqual(expected);
      expect(state.doc.sliceString(prefix.length, prefix.length + href.length)).toBe(href);
      expect(httpLinkRanges(editor(state.doc.toString()))).toEqual(expected);
    },
  );

  it('does not activate plain text, other protocols or embedded schemes', () => {
    const source = [
      '普通文本 www.example.test',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.test/file',
      'javascript:https://example.test/a',
      'data:text/plain,https://example.test/b',
      'https://',
    ].join('\n');
    expect(httpLinkRanges(editor(source))).toEqual([]);
  });

  it('rebuilds links from saved source and follows subsequent text edits', () => {
    const initial = editor('说明 https://example.test/old 结束');
    const saved = initial.doc.toString();
    expect(httpLinkRanges(editor(saved))).toEqual(httpLinkRanges(initial));
    const link = httpLinkRanges(initial)[0];
    const updated = initial.update({
      changes: { from: link.from, to: link.to, insert: 'http://example.test/new?q=2' },
    }).state;
    expect(httpLinkRanges(updated).map((entry) => entry.href)).toEqual(['http://example.test/new?q=2']);
    expect(updated.doc.toString()).toBe('说明 http://example.test/new?q=2 结束');
    const ordinary = updated.update({
      changes: { from: 0, to: updated.doc.length, insert: '普通文本' },
    }).state;
    expect(httpLinkRanges(ordinary)).toEqual([]);
  });
});

describe('explicit and bare log links use the same destination', () => {
  it.each(['http', 'https'])('recognizes pasted %s Markdown labels and bare URLs after saving', (scheme) => {
    const href = scheme + '://example.invalid/issue/AI-2793';
    const source = '[mobius](' + href + ')\n普通文本 ' + href + ' 结束';
    for (const state of [editor(source), editor(editor(source).doc.toString())]) {
      const label = source.indexOf('mobius');
      const destination = source.indexOf(href);
      expect(markdownHttpLinkRanges(state)).toEqual([
        { from: label, to: label + 6, href },
        { from: destination, to: destination + href.length, href },
      ]);
      const bare = source.lastIndexOf(href);
      expect(httpLinkRanges(state)).toEqual([{ from: bare, to: bare + href.length, href }]);
      expect(state.doc.toString()).toBe(source);
    }
  });

  it('keeps literal entity text in autolinks while decoding explicit Markdown destinations once', () => {
    const literal = 'https://example.test/issue/AI-2793?first=1&amp;second=2';
    const source = '<' + literal + '> [mobius](' + literal + ')';
    for (const state of [editor(source), editor(editor(source).doc.toString())]) {
      expect(markdownHttpLinkRanges(state).map((link) => link.href)).toEqual([
        literal, 'https://example.test/issue/AI-2793?first=1&second=2',
        'https://example.test/issue/AI-2793?first=1&second=2',
      ]);
      expect(httpLinkRanges(state)).toEqual([]);
      expect(state.doc.toString()).toBe(source);
    }
  });

  it('separates bare URLs from adjacent Markdown links without consuming text or destinations', () => {
    const before = 'https://example.test/before?词=𠮷#章节';
    const explicit = 'https://example.test/issue/AI-2793';
    const after = 'https://example.test/after_(😀)';
    const source = before + '[mobius](' + explicit + ')' + after;
    for (const state of [editor(source), editor(editor(source).doc.toString())]) {
      expect(httpLinkRanges(state)).toEqual([
        { from: 0, to: before.length, href: before },
        { from: source.lastIndexOf(after), to: source.length, href: after },
      ]);
      expect(markdownHttpLinkRanges(state).map((link) => link.href)).toEqual([explicit, explicit]);
      expect(state.doc.toString()).toBe(source);
    }
  });

  it('handles nested labels, angle destinations, titles, escapes, entities and Unicode', () => {
    const href = 'https://example.invalid/路径/😀_(𠮷)?x=1&y=2#章节';
    const destination = 'https://example.invalid/路径/😀_\\(𠮷\\)?x=1&amp;y=2#章节';
    const label = '查看 **𠮷** 与 ' + String.fromCharCode(96) + '代码' + String.fromCharCode(96);
    const source = '[' + label + '](<' + destination + '> "本地标题")';
    const links = markdownHttpLinkRanges(editor(source));
    expect(links.map((link) => link.href)).toEqual([href, href]);
    expect(source.slice(links[0].from, links[0].to)).toBe(label);
    expect(httpLinkRanges(editor(source))).toEqual([]);
  });

  it('recognizes autolinks and bare links inside nested Markdown formatting', () => {
    const href = 'http://example.invalid/issue/AI-2793';
    const source = '> - **' + href + '**\n\n<' + href + '>';
    expect(httpLinkRanges(editor(source)).map((link) => link.href)).toEqual([href]);
    expect(markdownHttpLinkRanges(editor(source)).map((link) => link.href)).toEqual([href]);
  });

  it('keeps URL punctuation while separating surrounding emphasis and adjacent links', () => {
    const first = 'https://example.invalid/a*b*c?q=a_b_c';
    const second = 'http://example.invalid/issue/AI-2793';
    expect(httpLinkRanges(editor(first)).map((link) => link.href)).toEqual([first]);
    expect(httpLinkRanges(editor('**' + first + '**')).map((link) => link.href)).toEqual([first]);
    expect(httpLinkRanges(editor('**' + second + '**_' + second + '_')).map((link) => link.href)).toEqual([second, second]);
  });

  it('does not activate URLs or link syntax inside nested code or images', () => {
    const href = 'https://example.invalid/issue/AI-2793';
    const tick = String.fromCharCode(96);
    const source = [
      tick + '[mobius](' + href + ')' + tick,
      '',
      '> - 引用',
      '>   ~~~markdown',
      '>   [mobius](' + href + ')',
      '>   ' + href,
      '>   ~~~',
      '',
      '    [mobius](' + href + ')',
      '',
      '![图片](' + href + ')',
      '',
      '<!-- ' + href + ' -->',
    ].join('\n');
    expect(httpLinkRanges(editor(source))).toEqual([]);
    expect(markdownHttpLinkRanges(editor(source))).toEqual([]);
  });


  it.each([
    ['<!-- ', ' -->'],
    ['普通文字 <!-- ', ' --> 后续'],
    ['<?local ', ' ?>'],
    ['普通文字 <?local ', ' ?> 后续'],
  ])('keeps comment and processing-instruction contents inert: %s', (before, after) => {
    const hidden = 'https://example.invalid/hidden';
    const visible = 'http://example.invalid/issue/AI-2793';
    const source = before + hidden + ' [mobius](' + hidden + ')' + after + '\n\n正文 ' + visible;
    for (const state of [editor(source), editor(editor(source).doc.toString())]) {
      expect(httpLinkRanges(state)).toEqual([
        { from: source.lastIndexOf(visible), to: source.length, href: visible },
      ]);
      expect(markdownHttpLinkRanges(state)).toEqual([]);
      expect(state.doc.toString()).toBe(source);
    }
  });

  it('follows replacement and removal of a Markdown destination without rewriting text', () => {
    const before = 'https://example.invalid/issue/AI-2793';
    const after = 'http://example.invalid/issue/AI-2793?q=𠮷#结果';
    const state = editor('[mobius](' + before + ')');
    const updated = state.update({ changes: { from: 9, to: 9 + before.length, insert: after } }).state;
    expect(markdownHttpLinkRanges(updated).map((link) => link.href)).toEqual([after, after]);
    expect(updated.doc.toString()).toBe('[mobius](' + after + ')');
    const ordinary = updated.update({ changes: { from: 0, to: updated.doc.length, insert: '普通日志内容' } }).state;
    expect(markdownHttpLinkRanges(ordinary)).toEqual([]);
    expect(httpLinkRanges(ordinary)).toEqual([]);
  });

  it.each(['javascript:alert(1)', 'data:text/plain,https://example.invalid/', 'ftp://example.invalid/a', 'https://', 'https://[invalid', 'https://example.invalid/a\nb'])(
    'rejects invalid or non-HTTP destinations: %s',
    (href) => {
      expect(isHttpLink(href)).toBe(false);
      expect(markdownHttpLinkRanges(editor('[mobius](' + href + ')'))).toEqual([]);
    },
  );
});
