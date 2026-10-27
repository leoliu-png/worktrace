import { describe, expect, it } from 'vitest';
import type { LocalWorkLogAttachment } from './db';
import { pendingPastedImages, replacePastedImageSources, type PendingPastedImage } from './pasted-work-log-images';

const source = 'blob:http://local.invalid/synthetic-image';
const oldSource = 'blob:http://local.invalid/synthetic-before-restore';
const tick = String.fromCharCode(96);
const attachment = (id: string) => ({ id, workLogId: 'synthetic-log' }) as LocalWorkLogAttachment;
const attachmentUrl = (id: string) => '/api/v1/work-logs/synthetic-log/attachments/' + id;
const image = (value = source, type = 'image/png', size = 3): PendingPastedImage => ({
  source: value,
  file: new File([new Uint8Array(size)], 'synthetic-image', { type }),
});
function form(images: PendingPastedImage[]) {
  const data = new FormData();
  data.set('pastedImageSources', JSON.stringify(images.map((entry) => entry.source)));
  for (const entry of images) data.append('pastedImages', entry.file);
  return data;
}

describe('pasted work-log image references', () => {
  it('saves a restored image while preserving obsolete addresses in code examples', () => {
    const literal = [
      '行内示例：' + tick + '![示例](' + oldSource + ')' + tick,
      '~~~markdown',
      '![示例](' + oldSource + ')',
      '~~~',
    ].join('\n');
    const markdown = '# 合成日志\n\n![真实图片](' + source + ')\n\n' + literal;
    const pending = pendingPastedImages(form([image()]), markdown);
    expect(pending.map((entry) => entry.source)).toEqual([source]);
    const saved = replacePastedImageSources(markdown, pending, [attachment('image-1')]);
    expect(saved).toBe('# 合成日志\n\n![真实图片](' + attachmentUrl('image-1') + ')\n\n' + literal);
    expect(pendingPastedImages(form([]), saved)).toEqual([]);
  });

  it('replaces only the actual destination when the same address also occurs in literal text', () => {
    const before = '前🧪，' + source + '。' + tick + '![代码](' + source + ')' + tick + '\n';
    const after = '\n[普通链接](' + source + ')\n~~~\n![代码](' + source + ')\n~~~';
    const markdown = before + '![' + source + '](<' + source + '> "标题 ' + source + '")' + after;
    const pending = pendingPastedImages(form([image()]), markdown);
    expect(pending).toHaveLength(1);
    expect(replacePastedImageSources(markdown, pending, [attachment('image-1')]))
      .toBe(before + '![' + source + '](<' + attachmentUrl('image-1') + '> "标题 ' + source + '")' + after);
  });

  it.each([
    ['inline code', tick.repeat(2) + ' ![示例](' + source + ') ' + tick + ' ' + tick.repeat(2)],
    ['indented code', '    ![示例](' + source + ')'],
    ['nested fenced code', '> - 示例\n>   ~~~~markdown\n>   ![示例](' + source + ')\n>   ~~~\n>   ![仍在代码内](' + source + ')\n>   ~~~~'],
    ['long backtick fence', tick.repeat(4) + 'markdown\n' + tick.repeat(3) + '\n![示例](' + source + ')\n' + tick.repeat(3) + '\n' + tick.repeat(4)],
    ['escaped image marker', '\\![示例](' + source + ')'],
    ['ordinary link', '[链接](' + source + ')'],
    ['plain Unicode text', '中文🧪（' + source + '），结束。'],
    ['unclosed parenthesis', '![图片](' + source],
    ['unclosed bracket', '![图片(' + source + ')'],
  ])('ignores %s for validation and replacement', (_name, markdown) => {
    expect(pendingPastedImages(form([]), markdown)).toEqual([]);
    expect(pendingPastedImages(form([image()]), markdown)).toEqual([]);
    expect(replacePastedImageSources(markdown, [image()], [attachment('unused')])).toBe(markdown);
  });

  it('keeps Unicode, punctuation, escaped labels and CRLF outside destinations unchanged', () => {
    const markdown = '前🧪，![图\\]片 *说明*](<' + source + '> "引号，中文。")；后\r\n\r\n> - ![第二张](' + source + ')\r\n';
    const expected = '前🧪，![图\\]片 *说明*](<' + attachmentUrl('image-1') + '> "引号，中文。")；后\r\n\r\n> - ![第二张](' + attachmentUrl('image-1') + ')\r\n';
    const pending = pendingPastedImages(form([image()]), markdown);
    expect(pending).toHaveLength(1);
    expect(replacePastedImageSources(markdown, pending, [attachment('image-1')])).toBe(expected);
  });

  it('matches complete URL tokens rather than prefixes or punctuation boundaries', () => {
    for (const suffix of ['-longer', '中文', '.', '?query=1']) {
      const markdown = '![另一张](' + source + suffix + ')';
      expect(() => pendingPastedImages(form([image()]), markdown)).toThrow('Unmatched pasted image');
      expect(replacePastedImageSources(markdown, [image()], [attachment('image-1')])).toBe(markdown);
    }
  });

  it('matches escaped punctuation in real destinations without modifying other copies', () => {
    const punctuationSource = source + '!x';
    const markdown = '![图](' + source + '\\!x) ' + punctuationSource;
    const pending = pendingPastedImages(form([image(punctuationSource)]), markdown);
    expect(pending.map((entry) => entry.source)).toEqual([punctuationSource]);
    expect(replacePastedImageSources(markdown, pending, [attachment('image-1')]))
      .toBe('![图](' + attachmentUrl('image-1') + ') ' + punctuationSource);
  });

  it('uses referenced image definitions while preserving unused definitions and their titles', () => {
    const markdown = [
      '![图][标 签]',
      '![标 签][]',
      '![标 签]',
      '',
      '[标 签]: <' + source + '> "标题 ' + source + '"',
      '[unused]: ' + oldSource,
    ].join('\n');
    const pending = pendingPastedImages(form([image()]), markdown);
    expect(pending).toHaveLength(1);
    expect(replacePastedImageSources(markdown, pending, [attachment('image-1')])).toBe([
      '![图][标 签]',
      '![标 签][]',
      '![标 签]',
      '',
      '[标 签]: <' + attachmentUrl('image-1') + '> "标题 ' + source + '"',
      '[unused]: ' + oldSource,
    ].join('\n'));
  });

  it('rejects genuinely unmatched blob image references, including wrapped destinations', () => {
    for (const markdown of ['![图](' + source + ')', '![图](<' + source + '> "标题")', '![图][ref]\n\n[ref]: ' + source]) {
      expect(() => pendingPastedImages(form([]), markdown)).toThrow('Unmatched pasted image');
    }
  });

  it('maps repeated references to one file and keeps attachment order independent of document order', () => {
    const second = source + '-second';
    const markdown = '![二](' + second + ')\n![一](' + source + ')\n![再一](' + source + ')';
    const pending = pendingPastedImages(form([image(), image(second)]), markdown);
    expect(pending.map((entry) => entry.source)).toEqual([source, second]);
    expect(replacePastedImageSources(markdown, pending, [attachment('one'), attachment('two')]))
      .toBe('![二](' + attachmentUrl('two') + ')\n![一](' + attachmentUrl('one') + ')\n![再一](' + attachmentUrl('one') + ')');
  });

  it('does not replace unrelated saved or remote image URLs', () => {
    const markdown = '![保存图片](/api/v1/work-logs/synthetic-log/attachments/existing)\n![远程示例](https://example.invalid/image.png)';
    expect(pendingPastedImages(form([]), markdown)).toEqual([]);
    expect(replacePastedImageSources(markdown, [], [])).toBe(markdown);
  });
});

describe('pasted image validation limits', () => {
  it('keeps the five-image limit', () => {
    const five = Array.from({ length: 5 }, (_, index) => image(source + index));
    const markdown = five.map((entry) => '![图](' + entry.source + ')').join('\n');
    expect(pendingPastedImages(form(five), markdown)).toHaveLength(5);
    expect(() => pendingPastedImages(form([...five, image(source + 'six')]), markdown)).toThrow('Invalid pasted image count');
  });

  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])('accepts the existing %s type', (type) => {
    expect(pendingPastedImages(form([image(source, type)]), '![图](' + source + ')')).toHaveLength(1);
  });

  it('rejects unsupported referenced files and files over five MB', () => {
    const markdown = '![图](' + source + ')';
    expect(() => pendingPastedImages(form([image(source, 'image/svg+xml')]), markdown)).toThrow('Invalid pasted image file');
    expect(pendingPastedImages(form([image(source, 'image/png', 5 * 1024 * 1024)]), markdown)).toHaveLength(1);
    expect(() => pendingPastedImages(form([image(source, 'image/png', 5 * 1024 * 1024 + 1)]), markdown)).toThrow('Invalid pasted image file');
    expect(() => pendingPastedImages(form([image(source, 'image/png', 0)]), markdown)).toThrow('Invalid pasted image count');
  });

  it('keeps source JSON, file pairing, uniqueness and source validation', () => {
    const invalidJson = form([]);
    invalidJson.set('pastedImageSources', '{');
    expect(() => pendingPastedImages(invalidJson, '')).toThrow('Invalid pasted image references');
    for (const value of ['{}', '[1]', JSON.stringify([source])]) {
      const data = form([]);
      data.set('pastedImageSources', value);
      expect(() => pendingPastedImages(data, '')).toThrow('Invalid pasted image count');
    }
    expect(() => pendingPastedImages(form([image(), image()]), '')).toThrow('Invalid pasted image source');
    for (const value of ['https://example.invalid/image', 'blob:', 'blob:bad source', 'blob:bad(source)', 'blob:' + 'x'.repeat(501)]) {
      expect(() => pendingPastedImages(form([image(value)]), '')).toThrow('Invalid pasted image source');
    }
    const data = form([image()]);
    data.set('pastedImageSources', '[1]');
    expect(() => pendingPastedImages(data, '')).toThrow('Invalid pasted image source');
  });

  it('rejects attachment count mismatches', () => {
    expect(() => replacePastedImageSources('![图](' + source + ')', [image()], [])).toThrow('Pasted image count mismatch');
  });
});
