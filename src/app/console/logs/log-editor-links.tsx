'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { syntaxTree } from '@codemirror/language';
import { Compartment, StateEffect, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { httpLinkRanges, isHttpLink, markdownHttpLinkRanges } from './http-link-ranges';

function linkDecorations(state: EditorState) {
  const marks = [
    ...httpLinkRanges(state).map((link) => ({ ...link, markdown: false })),
    ...markdownHttpLinkRanges(state).map((link) => ({ ...link, markdown: true })),
  ];
  return Decoration.set(marks.map(({ from, to, href, markdown }) => {
    const attributes: Record<string, string> = {
      title: state.readOnly ? '点击打开链接' : '点击打开链接；拖动选择文字可编辑',
      tabindex: state.readOnly ? '0' : '-1',
      style: 'color: var(--wt-accent, #2563eb); text-decoration: underline; cursor: pointer',
    };
    if (markdown) {
      attributes['data-wt-log-href'] = href;
      attributes.role = 'link';
    } else {
      attributes.href = href;
      attributes.target = '_blank';
      attributes.rel = 'noopener noreferrer';
    }
    return Decoration.mark({
      // The live Markdown preview may already wrap the label in an anchor.
      // Use a span for Markdown labels to avoid nesting anchors.
      tagName: markdown ? 'span' : 'a',
      class: 'wt-log-http-link',
      attributes,
    }).range(from, to);
  }), true);
}

export class HttpLinkDecorations {
  decorations: DecorationSet;
  constructor(view: Pick<EditorView, 'state'>) { this.decorations = linkDecorations(view.state); }
  update(update: Pick<ViewUpdate, 'docChanged' | 'viewportChanged' | 'startState' | 'state'>) {
    // Background parsing and read-only reconfiguration can change links
    // without a text or viewport change.
    if (update.docChanged || update.viewportChanged ||
        update.startState.readOnly !== update.state.readOnly ||
        syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = linkDecorations(update.state);
    }
  }
}

const httpLinks = ViewPlugin.fromClass(HttpLinkDecorations, { decorations: (plugin) => plugin.decorations });

type LinkClick = Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey' | 'preventDefault' | 'stopImmediatePropagation'>;
type OpenLink = (href: string) => void;

// A local opener can be supplied by tests so no external navigation is needed.
export function handleLogLinkClick(event: LinkClick, href: string, open: OpenLink): boolean {
  if (!isHttpLink(href) || (event.button !== 0 && event.button !== 1)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  open(href);
  return true;
}

// Bind the same DOM listeners in the editor and in local navigation tests.
// Resolve elements in the editor's document, including editors hosted in a frame.
export function installLogLinkNavigation(
  view: Pick<EditorView, 'dom' | 'contentDOM' | 'state'>,
  open: OpenLink = (href) => { window.open(href, '_blank', 'noopener,noreferrer'); },
): () => void {
  const target = (event: Event) => {
    const ElementType = view.dom.ownerDocument.defaultView?.Element;
    const element = ElementType && event.target instanceof ElementType
      ? event.target.closest<HTMLElement>('[data-wt-log-href], a[href]')
      : null;
    if (!element || !view.contentDOM.contains(element)) return null;
    const href = element.getAttribute('data-wt-log-href') ?? element.getAttribute('href');
    return href && isHttpLink(href) ? href : null;
  };
  const mousedown = (event: MouseEvent) => {
    if (target(event) && (event.button === 1 || (event.button === 0 && (view.state.readOnly || event.ctrlKey || event.metaKey)))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const click = (event: MouseEvent) => {
    const href = target(event);
    if (!href) return;
    // A normal mousedown still places the caret or starts text selection.
    // Do not turn a drag used to edit/copy a link into navigation.
    if (!view.state.readOnly && event.button === 0 && !event.ctrlKey && !event.metaKey &&
        !view.state.selection.main.empty) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    handleLogLinkClick(event, href, open);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    const href = target(event);
    if (!href) return;
    // Cancel native anchor activation on repeats as well, so holding Enter
    // cannot bypass this handler and open additional tabs.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) open(href);
  };
  // Capture before the shared live-preview plugin handles its own anchors.
  const options = { capture: true };
  view.dom.addEventListener('mousedown', mousedown, options);
  view.dom.addEventListener('click', click, options);
  view.dom.addEventListener('auxclick', click, options);
  view.dom.addEventListener('keydown', keydown, options);
  return () => {
    view.dom.removeEventListener('mousedown', mousedown, options);
    view.dom.removeEventListener('click', click, options);
    view.dom.removeEventListener('auxclick', click, options);
    view.dom.removeEventListener('keydown', keydown, options);
  };
}

const linkNavigation = ViewPlugin.define((view) => ({ destroy: installLogLinkNavigation(view) }));

// Keep this behavior local to log creation/editing and the log detail reader.
export function LogEditorLinks({ children, readOnly = false }: { children: ReactNode; readOnly?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const installed = new Map<EditorView, Compartment>();
    const attach = () => {
      for (const element of container.querySelectorAll<HTMLElement>('.cm-editor')) {
        const view = EditorView.findFromDOM(element);
        if (!view || installed.has(view)) continue;
        const compartment = new Compartment();
        // The per-view cleanup also handles editor recreation when props change.
        const lifecycle = ViewPlugin.define(() => ({ destroy: () => { installed.delete(view); } }));
        installed.set(view, compartment);
        view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of([httpLinks, linkNavigation, lifecycle])) });
      }
    };
    const observer = new MutationObserver(attach);
    observer.observe(container, { childList: true, subtree: true });
    attach();
    return () => {
      observer.disconnect();
      for (const [view, compartment] of installed) {
        // Destroyed views remove themselves through lifecycle. Clean up every
        // remaining live view, even if its DOM was moved out of this wrapper.
        view.dispatch({ effects: compartment.reconfigure([]) });
      }
      installed.clear();
    };
  }, []);

  return <div ref={root}>
    {!readOnly && <p className="wt-description">HTTP/HTTPS 链接自动识别；点击链接打开，拖动选择文字后可编辑。</p>}
    {children}
  </div>;
}
