import { parseWorkLogMarkdown } from '@/lib/worktrace-data';

export function WorkLogMarkdown({ value }: { value: string }) {
  return <div className="wt-log-markdown">{parseWorkLogMarkdown(value).map((block, index) => {
    if (block.type === 'paragraph') return <p key={`paragraph-${index}`}>{block.text}</p>;
    const List = block.type === 'ordered-list' ? 'ol' : 'ul';
    return <List key={`${block.type}-${index}`}>{block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</List>;
  })}</div>;
}
