import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from './markdown-content';
import { MarkdownEditor } from './markdown-editor';

describe('work log reading mode', () => {
  it('keeps saved Markdown visible before hydration without exposing editing controls or form fields', () => {
    const markdown = '# 今日工作\n\n1. 完成数据核查\n\n## 图片\n![截图](/api/v1/work-logs/log/attachments/image)';
    const html = renderToStaticMarkup(createElement(MarkdownEditor,
      { initialValue: markdown, readOnly: true },
      createElement(MarkdownContent, { value: markdown }),
    ));
    expect(html).toContain('<h1>今日工作</h1>');
    expect(html).toContain('<li>完成数据核查</li>');
    expect(html).toContain('/api/v1/work-logs/log/attachments/image');
    expect(html).not.toContain('role="toolbar"');
    expect(html).not.toContain('name="markdownContent"');
    expect(html).not.toContain('name="pastedImages"');
  });
});
