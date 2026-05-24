import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import rehypePrism from 'rehype-prism-plus';
import Prism from 'prismjs';

import '../prism-themes.css';
import 'prismjs/plugins/line-numbers/prism-line-numbers.css';
import 'prismjs/plugins/line-numbers/prism-line-numbers';

import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';

interface Props {
  children: string;
  className?: string;
  compact?: boolean;
}

function cleanMarkdown(text: string) {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

const components: Components = {
  pre: ({ children, ...props }: any) => {
    const codeElement = React.Children.toArray(children).find(
      (child): child is React.ReactElement =>
        React.isValidElement(child) && child.type === 'code',
    ) as React.ReactElement<{ className?: string }> | undefined;

    const className = codeElement?.props?.className || '';
    const languageMatch = className.match(/language-(\w+)/);
    const language = languageMatch ? languageMatch[1] : '';
    const preClassName = `line-numbers ${language ? `language-${language}` : ''} ${props.className || ''}`.trim();

    return (
      <pre {...props} className={preClassName}>
        {children}
      </pre>
    );
  },
};

function MarkdownContent({ children, className = '', compact = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        if (containerRef.current) Prism.highlightAllUnder(containerRef.current);
      } catch (error) {
        console.warn('Prism highlighting error (ignored):', error);
      }
    }, 50);

    return () => window.clearTimeout(timeoutId);
  }, [children]);

  return (
    <div
      ref={containerRef}
      className={`prose prose-sm max-w-none dark:prose-invert prose-pre:max-w-full prose-pre:overflow-x-auto ${compact ? 'prose-p:my-1 prose-pre:my-2' : ''} ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSanitize,
          [rehypePrism as any, { showLineNumbers: true }],
        ]}
        components={components}
      >
        {cleanMarkdown(children || '')}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownContent;
