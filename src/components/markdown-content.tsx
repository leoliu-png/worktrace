import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageZoom } from './image-zoom';

export function MarkdownContent({ value }: { value: string }) {
  return <ImageZoom><div className="wt-rich-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown></div></ImageZoom>;
}
