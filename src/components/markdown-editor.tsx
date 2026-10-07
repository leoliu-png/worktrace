'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { foldGutter, foldKeymap, foldService, indentUnit } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Table } from '@lezer/markdown';
import { codeBlockField, collapseOnSelectionFacet, editorTheme, imageField, linkPlugin, livePreviewPlugin, markdownStylePlugin, mouseSelectingField, setMouseSelecting, tableField } from 'codemirror-live-markdown';
import { markdownFoldRange } from '@/lib/markdown-folding';
import { imagePasteInsertion, orderedListRenumbering } from '@/lib/markdown-editing';
import { maxMarkdownCharacters } from '@/lib/markdown-work-log';

const maxPastedImages = 5;
const maxImageBytes = 5 * 1024 * 1024;
const supportedImages = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
type PastedImage = { file: File; source: string };
type LineStyle = 'h1' | 'h2' | 'bullet' | 'number' | 'task' | 'quote';

const lineMarkers: Record<LineStyle, RegExp> = {
  h1: /^\s*#\s+/,
  h2: /^\s*##\s+/,
  bullet: /^\s*[-*+]\s+(?!\[[ xX]\]\s+)/,
  number: /^\s*\d+[.)]\s+/,
  task: /^\s*[-*+]\s+\[[ xX]\]\s+/,
  quote: /^\s*>\s+/,
};
const anyLineMarker = /^(\s*)(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s+)/;

function formatLines(view: EditorView, style: LineStyle) {
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from);
  const last = view.state.doc.lineAt(selection.to > selection.from ? selection.to - 1 : selection.to);
  const original = view.state.doc.sliceString(first.from, last.to);
  const lines = original.split('\n');
  const nonempty = lines.filter((line) => line.trim());
  const remove = nonempty.length > 0 && nonempty.every((line) => lineMarkers[style].test(line));
  let number = 0;
  const formatted = lines.map((line) => {
    if (!line.trim()) return line;
    const indentation = line.match(/^\s*/)?.[0] ?? '';
    const text = line.replace(anyLineMarker, '$1').slice(indentation.length);
    if (remove) return `${indentation}${text}`;
    number += 1;
    const marker = style === 'h1' ? '# ' : style === 'h2' ? '## ' : style === 'bullet' ? '- ' : style === 'number' ? `${number}. ` : style === 'task' ? '- [ ] ' : '> ';
    return `${indentation}${marker}${text}`;
  }).join('\n');
  const anchor = selection.empty ? Math.min(first.from + formatted.length, selection.head + formatted.length - original.length) : first.from;
  view.dispatch({ changes: { from: first.from, to: last.to, insert: formatted }, selection: selection.empty ? { anchor: Math.max(first.from, anchor) } : { anchor: first.from, head: first.from + formatted.length }, userEvent: 'input' });
  view.focus();
  return true;
}

function wrapSelection(view: EditorView, before: string, after: string, fallback: string) {
  const selection = view.state.selection.main;
  const selected = view.state.doc.sliceString(selection.from, selection.to) || fallback;
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert: `${before}${selected}${after}` }, selection: { anchor: selection.from + before.length, head: selection.from + before.length + selected.length }, userEvent: 'input' });
  view.focus();
  return true;
}

class ListMarkerWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: WidgetType) { return other instanceof ListMarkerWidget && other.text === this.text; }
  toDOM() { const marker = document.createElement('span'); marker.className = 'wt-cm-list-marker'; marker.textContent = this.text; return marker; }
  ignoreEvent() { return true; }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly characterAt: number) { super(); }
  eq(other: WidgetType) { return other instanceof TaskWidget && other.checked === this.checked && other.characterAt === this.characterAt; }
  toDOM(view: EditorView) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'wt-cm-task-checkbox';
    checkbox.checked = this.checked;
    checkbox.disabled = view.state.readOnly;
    checkbox.setAttribute('aria-label', this.checked ? '标记为未完成' : '标记为已完成');
    checkbox.addEventListener('change', () => view.dispatch({ changes: { from: this.characterAt, to: this.characterAt + 1, insert: checkbox.checked ? 'x' : ' ' }, userEvent: 'input' }));
    return checkbox;
  }
  ignoreEvent() { return true; }
}

const listPreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) { if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged) this.decorations = this.build(update.view); }
  build(view: EditorView) {
    const decorations = [];
    const state = view.state;
    const selection = state.selection.main;
    const editing = view.hasFocus && !state.readOnly;
    const activeStart = editing ? state.doc.lineAt(selection.from).number : -1;
    const activeEnd = editing ? state.doc.lineAt(selection.to).number : -1;
    let insideFence = false;
    for (let number = 1; number <= state.doc.lines; number++) {
      const line = state.doc.line(number);
      if (/^ {0,3}(?:`{3,}|~{3,})/.test(line.text)) { insideFence = !insideFence; continue; }
      if (insideFence || (number >= activeStart && number <= activeEnd)) continue;
      const task = line.text.match(/^(\s*[-*+]\s+)\[([ xX])\](?=\s)/);
      if (task) {
        const from = line.from + task[1].length;
        decorations.push(Decoration.replace({ widget: new TaskWidget(task[2].toLowerCase() === 'x', from + 1) }).range(from, from + 3));
        continue;
      }
      const list = line.text.match(/^(\s*)([-*+]|\d+[.)])(?=\s)/);
      if (list) decorations.push(Decoration.widget({ widget: new ListMarkerWidget(/\d/.test(list[2]) ? list[2] : '•'), side: -1 }).range(line.from + list[1].length));
    }
    return Decoration.set(decorations.sort((a, b) => a.from - b.from), true);
  }
}, { decorations: (plugin) => plugin.decorations });

const foldMarkerAlignment = ViewPlugin.fromClass(class {
  constructor(view: EditorView) { this.align(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.geometryChanged || update.selectionSet || update.focusChanged) this.align(update.view);
  }
  align(view: EditorView) {
    view.requestMeasure({
      key: this,
      read: () => {
        const markers = Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-foldGutter .wt-cm-fold-marker'))
          .filter((marker) => marker.parentElement?.style.visibility !== 'hidden')
          .map((marker) => ({ marker, rect: marker.parentElement!.getBoundingClientRect() }));
        const offsets: { marker: HTMLElement; offset: number }[] = [];
        for (const element of view.contentDOM.querySelectorAll('.cm-line')) {
          const line = view.state.doc.lineAt(view.posAtDOM(element));
          const prefix = line.text.match(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/)?.[0].length ?? 0;
          const coordinates = view.coordsAtPos(Math.min(line.from + prefix, line.to));
          if (!coordinates) continue;
          const center = (coordinates.top + coordinates.bottom) / 2;
          const match = markers.find(({ rect }) => center >= rect.top && center <= rect.bottom);
          if (match) offsets.push({ marker: match.marker, offset: center - (match.rect.top + match.rect.bottom) / 2 });
        }
        return offsets;
      },
      write: (offsets) => {
        for (const { marker, offset } of offsets) marker.style.transform = `translateY(${offset}px)`;
      },
    });
  }
});

export function MarkdownEditor({ initialValue = '', readOnly = false, children }: { initialValue?: string; readOnly?: boolean; children?: ReactNode }) {
  const [value, setValue] = useState(initialValue);
  const [ready, setReady] = useState(false);
  const [imageSources, setImageSources] = useState<string[]>([]);
  const [pasteError, setPasteError] = useState('');
  const mount = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pastedImages = useRef<PastedImage[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mount.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          markdown({ extensions: [Table] }),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          ...(readOnly ? [EditorState.changeFilter.of(() => false)] : []),
          history(),
          orderedListRenumbering,
          indentUnit.of('  '),
          keymap.of(readOnly ? foldKeymap : [
            { key: 'Mod-b', run: (current) => wrapSelection(current, '**', '**', '粗体文字') },
            { key: 'Mod-i', run: (current) => wrapSelection(current, '*', '*', '斜体文字') },
            { key: 'Mod-Shift-7', run: (current) => formatLines(current, 'number') },
            { key: 'Mod-Shift-8', run: (current) => formatLines(current, 'bullet') },
            { key: 'Mod-Shift-9', run: (current) => formatLines(current, 'task') },
            ...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
          ]),
          foldService.of((state, lineStart) => markdownFoldRange(state, lineStart)),
          foldGutter({ markerDOM: (open) => {
            const marker = document.createElement('span');
            marker.className = 'wt-cm-fold-marker';
            marker.dataset.open = String(open);
            marker.title = open ? '收起内容' : '展开内容';
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 16 16');
            icon.setAttribute('aria-hidden', 'true');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M5.5 3L10.5 8L5.5 13');
            icon.appendChild(path);
            marker.appendChild(icon);
            return marker;
          } }),
          collapseOnSelectionFacet.of(!readOnly),
          mouseSelectingField,
          livePreviewPlugin,
          markdownStylePlugin,
          listPreview,
          foldMarkerAlignment,
          imageField(),
          tableField,
          codeBlockField({ copyButton: true }),
          linkPlugin(),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setValue(update.state.doc.toString());
          }),
        ],
      }),
      parent: mount.current,
    });
    view.contentDOM.setAttribute('aria-label', readOnly ? '工作日志正文，可折叠查看' : '日志正文');
    if (readOnly) view.contentDOM.setAttribute('tabindex', '0');
    view.contentDOM.addEventListener('mousedown', () => view.dispatch({ effects: setMouseSelecting.of(true) }));
    const stopSelecting = () => requestAnimationFrame(() => { if (viewRef.current === view) view.dispatch({ effects: setMouseSelecting.of(false) }); });
    document.addEventListener('mouseup', stopSelecting);
    viewRef.current = view;
    setReady(true);
    return () => {
      document.removeEventListener('mouseup', stopSelecting);
      viewRef.current = null;
      view.destroy();
      for (const image of pastedImages.current) URL.revokeObjectURL(image.source);
    };
  }, [initialValue, readOnly]);

  function syncPastedImages(images: PastedImage[]) {
    pastedImages.current = images;
    const transfer = new DataTransfer();
    for (const image of images) transfer.items.add(image.file);
    if (fileInput.current) fileInput.current.files = transfer.files;
    setImageSources(images.map((image) => image.source));
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const view = viewRef.current;
    if (!view) return;
    const items = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!items.length) return;
    event.preventDefault();
    const files = items.map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (pastedImages.current.length + files.length > maxPastedImages) { setPasteError('本次最多粘贴 5 张图片。'); return; }
    if (files.some((file) => !supportedImages.has(file.type))) { setPasteError('仅支持 PNG、JPEG、WebP 和 GIF 图片。'); return; }
    if (files.some((file) => file.size === 0 || file.size > maxImageBytes)) { setPasteError('每张图片不能超过 5 MB。'); return; }
    const added = files.map((file, index) => {
      const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
      const named = file.name.trim() ? file : new File([file], `pasted-image-${Date.now()}-${index}.${extension}`, { type: file.type });
      return { file: named, source: URL.createObjectURL(named) };
    });
    syncPastedImages([...pastedImages.current, ...added]);
    const selection = view.state.selection.main;
    const images = added.map(({ file, source }) => `![${file.name.replace(/[\[\]\r\n]/g, '') || '粘贴的图片'}](${source})`);
    const { insert, anchor } = imagePasteInsertion(view.state.doc.toString(), selection.from, selection.to, images);
    view.dispatch({ changes: { from: selection.from, to: selection.to, insert }, selection: { anchor }, userEvent: 'input.paste' });
    view.focus();
    setPasteError('');
  }

  function apply(style: LineStyle) { const view = viewRef.current; if (view) formatLines(view, style); }
  function wrap(before: string, after: string, fallback: string) { const view = viewRef.current; if (view) wrapSelection(view, before, after, fallback); }
  function addLink() {
    const view = viewRef.current;
    if (!view) return;
    const href = window.prompt('输入链接地址', 'https://');
    if (!href?.trim()) return;
    wrapSelection(view, '[', `](${href.trim()})`, '链接文字');
  }

  return <div className={`wt-markdown-editor${readOnly ? ' wt-markdown-reader' : ''}`}>
    {readOnly && !ready && children}
    {!readOnly && <div className="wt-markdown-toolbar" role="toolbar" aria-label="日志格式">
      <span className="wt-markdown-toolbar-label">排版</span>
      <span className="wt-markdown-toolbar-group">
        <button type="button" onClick={() => apply('h1')} title="一级标题">H1</button>
        <button type="button" onClick={() => apply('h2')} title="二级标题">H2</button>
        <button type="button" onClick={() => wrap('**', '**', '粗体文字')} title="粗体 Ctrl/Cmd+B"><strong>B</strong></button>
        <button type="button" onClick={() => wrap('*', '*', '斜体文字')} title="斜体 Ctrl/Cmd+I"><em>I</em></button>
        <button type="button" onClick={addLink} title="链接">链接</button>
      </span>
      <span className="wt-markdown-toolbar-divider" aria-hidden="true" />
      <span className="wt-markdown-toolbar-group">
        <button type="button" onClick={() => apply('bullet')} title="选中多行后批量转为无序列表">• 列表</button>
        <button type="button" onClick={() => apply('number')} title="选中多行后批量转为有序列表">1. 列表</button>
        <button type="button" onClick={() => apply('task')} title="选中多行后批量转为待办列表">☐ 待办</button>
        <button type="button" onClick={() => apply('quote')} title="引用">引用</button>
        <button type="button" onClick={() => wrap('`', '`', '代码')} title="行内代码">代码</button>
      </span>
    </div>}
    <div className="wt-markdown-writing" hidden={readOnly && !ready} onPasteCapture={readOnly ? undefined : handlePaste}>
      <div className="wt-markdown-codemirror">
        {!readOnly && !value && <span className="wt-markdown-placeholder" aria-hidden="true">从这里开始记录今天的工作…</span>}
        <div ref={mount} />
      </div>
    </div>
    {!readOnly && <>
    <input type="hidden" name="markdownContent" value={value} readOnly />
    <input ref={fileInput} type="file" name="pastedImages" multiple accept="image/png,image/jpeg,image/webp,image/gif" hidden tabIndex={-1} />
    <input type="hidden" name="pastedImageSources" value={JSON.stringify(imageSources)} readOnly />
    {pasteError && <p className="wt-form-error wt-markdown-paste-error" role="alert">{pasteError}</p>}
    <div className="wt-markdown-editor-help"><span><strong>Markdown</strong><span aria-hidden="true"> · </span>点击文字显示原文<span aria-hidden="true"> · </span>标题或缩进旁可折叠<span aria-hidden="true"> · </span>Ctrl+V 粘贴图片</span><span className={value.length > maxMarkdownCharacters ? 'wt-markdown-over-limit' : ''}>{value.length} / {maxMarkdownCharacters} 字符</span></div>
    </>}
  </div>;
}
