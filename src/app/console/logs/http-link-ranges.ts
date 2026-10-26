import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export type HttpLinkRange = { from: number; to: number; href: string };

export function isHttpLink(href: string): boolean {
  if (!/^https?:\/\//i.test(href) || /[\s<>"`\\\u0000-\u0020]/u.test(href)) return false;
  try {
    const url = new URL(href);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

// Decode Markdown escapes and entities without normalizing the destination URL.
function markdownDestination(value: string): string {
  const unwrapped = value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
  return unwrapped.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);/g, (match, escaped: string | undefined) => {
    if (escaped) return escaped;
    // Editor decorations run in the browser. Decode one entity in an inert
    // textarea so entity text can never introduce markup or execute scripts.
    if (typeof document !== 'undefined') {
      const element = document.createElement('textarea');
      element.innerHTML = match;
      return element.value;
    }
    const common: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (common[match]) return common[match];
    if (/^&#/.test(match)) {
      const hexadecimal = /^&#x/i.test(match);
      const point = Number.parseInt(match.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd';
    }
    return match;
  });
}

// Lezer gives comments and processing instructions their own node types,
// including inline variants. Their contents must stay inert just like HTML/code.
const opaqueNode = /^(?:Image|InlineCode|FencedCode|CodeBlock|HTMLBlock|HTMLTag|CommentBlock|Comment|ProcessingInstructionBlock|ProcessingInstruction|LinkReference)$/;

// Explicit Markdown links need a clickable label even while their source is
// exposed for editing. Let the Markdown tree handle nesting, titles and code.
export function markdownHttpLinkRanges(state: EditorState): HttpLinkRange[] {
  const links: HttpLinkRange[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (opaqueNode.test(node.name)) return false;
      if (node.name !== 'Link' && node.name !== 'Autolink') return;
      if (!syntaxTreeAvailable(state, node.to)) return false;
      const url = node.node.getChild('URL');
      if (!url) return false;
      const destination = state.doc.sliceString(url.from, url.to);
      // Autolinks treat entities literally; only explicit Markdown destinations
      // decode escapes/entities. Decoding an autolink would change its query.
      const href = node.name === 'Autolink' ? destination : markdownDestination(destination);
      if (!isHttpLink(href)) return false;
      if (node.name === 'Autolink') {
        links.push({ from: url.from, to: url.to, href });
      } else {
        const marks = node.node.getChildren('LinkMark');
        const opening = marks.find((mark) => state.doc.sliceString(mark.from, mark.to) === '[');
        const closing = marks.find((mark) => mark.from > (opening?.from ?? node.to) && state.doc.sliceString(mark.from, mark.to).startsWith(']'));
        if (opening && closing && opening.to < closing.from) {
          links.push({ from: opening.to, to: closing.from, href });
        }
        // Keep the destination clickable when Markdown markers are exposed.
        links.push({ from: url.from, to: url.to, href });
      }
      return false;
    },
  });
  return links;
}

// Decorations leave the source unchanged, including saved Markdown and undo history.
export function httpLinkRanges(state: EditorState): HttpLinkRange[] {
  const excluded: { from: number; to: number }[] = [];
  const formatting: { from: number; to: number; parentFrom: number }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (opaqueNode.test(node.name) || /^(?:Link|Autolink)$/.test(node.name)) {
        excluded.push({ from: node.from, to: node.to });
        return false;
      }
      if (/^(?:EmphasisMark|StrikethroughMark)$/.test(node.name)) {
        formatting.push({ from: node.from, to: node.to, parentFrom: node.node.parent?.from ?? node.from });
      }
    },
  });

  const source = state.doc.toString();
  const links: HttpLinkRange[] = [];
  const pattern = /https?:\/\/[^\s<>"`\\\u0000-\u0020]+/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const from = match.index;
    // Resume after an opaque/explicit Markdown node rather than letting a
    // greedy URL token swallow it and any subsequent adjacent bare link.
    const containing = excluded.find((range) => from >= range.from && from < range.to);
    if (containing) {
      pattern.lastIndex = containing.to;
      continue;
    }
    // Only trim a delimiter belonging to formatting that encloses the URL.
    // Asterisks and underscores inside a destination remain part of that URL.
    const tokenEnd = from + match[0].length;
    const ending = formatting.find((mark) => mark.parentFrom < from && mark.from > from && mark.from < tokenEnd);
    const nextNode = excluded.find((range) => range.from > from && range.from < tokenEnd);
    const to = Math.min(ending?.from ?? tokenEnd, nextNode?.from ?? tokenEnd);
    pattern.lastIndex = to;
    // Inspect a full code point; supplementary Han can also precede a URL.
    if (from > 0 && !formatting.some((mark) => mark.to === from) &&
        !excluded.some((range) => range.to === from) &&
        !/[\s([{（【「『，。；：、\p{Script=Han}]$/u.test(source.slice(Math.max(0, from - 2), from))) continue;
    // Preserve punctuation in paths, queries and fragments exactly as entered.
    const href = source.slice(from, to);
    // Never temporarily activate code or Markdown destinations in an unparsed tail.
    if (!syntaxTreeAvailable(state, to)) continue;
    if (excluded.some((range) => from < range.to && to > range.from)) continue;
    if (!isHttpLink(href)) continue;
    links.push({ from, to, href });
  }
  return links;
}
