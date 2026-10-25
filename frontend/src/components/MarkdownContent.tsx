import ReactMarkdown from 'react-markdown';
import { remarkPlugins, rehypePlugins } from '../lib/markdownPlugins';

import '../prism-themes.css';

interface Props {
  children: string;
  className?: string;
  compact?: boolean;
}

function cleanMarkdown(text: string) {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function MarkdownContent({ children, className = '', compact = false }: Props) {
  return (
    <div
      className={`prose prose-sm max-w-none dark:prose-invert prose-pre:max-w-full prose-pre:overflow-x-auto ${compact ? 'prose-p:my-1 prose-pre:my-2' : ''} ${className}`}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {cleanMarkdown(children || '')}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownContent;
