import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import Prism from "prismjs";
import "../prism-themes.css";
// Prism line numbers plugin CSS
import "prismjs/plugins/line-numbers/prism-line-numbers.css";
// Prism line numbers plugin JavaScript
import "prismjs/plugins/line-numbers/prism-line-numbers";

// Import common languages to reduce unknown language errors
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup"; // HTML/XML
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-sql";

/**
 * JsonSafeField
 * A small developer helper component: paste a text (can contain Markdown/code blocks)
 * and get a JSON-valid string value (JSON.stringify output) ready to paste in quiz files.
 *
 * Usage: <JsonSafeField />
 */
export default function JsonSafeField() {
  const [input, setInput] = useState<string>("");
  const [jsonInput, setJsonInput] = useState<string>("");
  const previewRef = useRef<HTMLDivElement>(null);
  const [copyStatus, setCopyStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // When input (raw) changes, update JSON output
  useEffect(() => {
    try {
      const result = JSON.stringify(input);
      setJsonInput(result);
    } catch {
      // Ignore stringify errors
    }
  }, [input]);

  // When JSON input changes manually, try to parse and update raw input
  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newJson = e.target.value;
    setJsonInput(newJson);

    try {
      // Try to parse the JSON string
      const parsed = JSON.parse(newJson);

      // Check if it's actually a string (the expected format)
      if (typeof parsed === 'string') {
        setInput(parsed);
        setParseError(null);
      } else {
        setParseError('JSON value should be a string (quoted text)');
      }
    } catch {
      // Invalid JSON - show error but don't update input
      setParseError('Invalid JSON format');
    }
  };

  // Re-run Prism highlighting when input changes
  useEffect(() => {
    if (previewRef.current) {
      try {
        // Use setTimeout to ensure DOM is ready and catch async errors
        const timeoutId = setTimeout(() => {
          try {
            if (previewRef.current) {
              Prism.highlightAllUnder(previewRef.current);
            }
          } catch (error) {
            // Silently ignore Prism errors (e.g., unknown languages, malformed code blocks)
            console.warn('Prism highlighting error (ignored):', error);
          }
        }, 100); // Small delay to let react-markdown finish rendering

        return () => clearTimeout(timeoutId);
      } catch (error) {
        console.warn('Prism setup error (ignored):', error);
      }
    }
  }, [input]);

  // Custom components for ReactMarkdown to handle code blocks safely
  const components: Components = {
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';

      if (!inline && language) {
        // Check if language is supported, fallback to 'markup' if not
        const lang = Prism.languages[language] ? language : 'markup';

        return (
          <code className={`language-${lang} ${className || ''}`} {...props}>
            {children}
          </code>
        );
      }

      return <code className={className} {...props}>{children}</code>;
    },
    pre: ({ children, ...props }: any) => {
      // Extract language from code element
      const codeElement = Array.isArray(children) ? children[0] : children;
      const className = codeElement?.props?.className || '';
      const match = /language-(\w+)/.exec(className);
      const language = match ? match[1] : '';

      return (
        <pre className={`line-numbers ${language ? `language-${language}` : ''}`} {...props}>
          {children}
        </pre>
      );
    },
  };

  const copy = async (text: string, label: string) => {
    try {
      // First try the modern Clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopyStatus({ message: `${label} copied!`, type: 'success' });
      } else {
        // Fallback for older browsers or non-HTTPS contexts
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
          setCopyStatus({ message: `${label} copied!`, type: 'success' });
        } else {
          throw new Error('execCommand failed');
        }
      }

      // Clear the status after 3 seconds
      setTimeout(() => setCopyStatus(null), 3000);
    } catch (error) {
      console.error("Copy failed:", error);
      setCopyStatus({
        message: `Failed to copy ${label.toLowerCase()}. Please select and copy manually.`,
        type: 'error'
      });

      // Clear error after 5 seconds
      setTimeout(() => setCopyStatus(null), 5000);
    }
  };

  return (
    <div className="p-4 bg-surface-container border border-outline-variant/20 rounded-xl">
      <h3 className="font-semibold mb-2 text-on-surface">JSON-safe text generator (bidirectional)</h3>
      <p className="text-sm text-on-surface-variant mb-3">
        Edit either side: paste raw text to get JSON, or paste JSON to get raw text.
        Changes sync automatically.
      </p>

      {/* Copy Status Message */}
      {copyStatus && (
        <div className={`mb-3 p-2 rounded text-sm ${copyStatus.type === 'success'
          ? 'bg-tertiary/10 text-tertiary border border-tertiary/20'
          : 'bg-error/10 text-error border border-error/20'
          }`}>
          {copyStatus.message}
        </div>
      )}

      {/* Parse Error Message */}
      {parseError && (
        <div className="mb-3 p-2 rounded text-sm bg-secondary/10 text-secondary border border-secondary/20">
          ⚠️ {parseError}
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-on-surface-variant">Input (raw Markdown/text)</label>
          <textarea
            className="w-full border border-outline-variant/20 rounded-lg bg-surface-container-low text-on-surface p-2 mt-1 mb-3 font-mono text-sm focus:outline-none focus:border-primary/50 placeholder-outline-variant"
            rows={8}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Scrivi o incolla la domanda con blocchi di codice qui...`}
          />
          <div className="mt-2">
            <label className="block text-xs font-medium text-on-surface-variant">Preview (Markdown)</label>
            <div
              ref={previewRef}
              className="mt-1 p-3 border border-outline-variant/20 rounded-lg bg-surface-container-low max-h-48 overflow-auto prose prose-sm dark:prose-invert max-w-none"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
                components={components}
              >
                {input || ""}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-6">
          <button
            className="px-3 py-1 bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface rounded text-2xl font-bold transition-colors"
            onClick={() => {
              // Swap direction hint - just visual feedback
              setCopyStatus({ message: 'Edit either side to convert!', type: 'success' });
            }}
            title="Bidirectional conversion"
          >
            ⇄
          </button>
        </div>

        <div className="flex-1">
          <label className="block text-xs font-medium text-on-surface-variant">Output (JSON-safe string)</label>
          <textarea
            className="w-full border border-outline-variant/20 rounded-lg bg-surface-container-low text-on-surface p-2 mt-1 mb-3 font-mono text-sm focus:outline-none focus:border-primary/50 placeholder-outline-variant"
            rows={8}
            value={jsonInput}
            onChange={handleJsonChange}
            placeholder={`Incolla JSON qui per decodificare...`}
          />
        </div>
      </div>

      <div className="flex justify-between items-center mt-4 gap-2">
        <div className="flex gap-2">
          <button
            className="px-4 py-2 bg-primary text-on-primary font-semibold rounded-lg hover:bg-primary/80 transition-colors text-sm"
            onClick={() => copy(jsonInput, "JSON")}
            title="Copy JSON value"
          >
            📋 Copy JSON
          </button>
          <button
            className="px-4 py-2 bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60 rounded-lg transition-colors text-sm"
            onClick={() => copy(input, "Raw text")}
            title="Copy raw"
          >
            📋 Copy Raw
          </button>
        </div>
        <button
          className="px-4 py-2 bg-error/10 text-error border border-error/20 rounded-lg hover:bg-error/20 transition-colors text-sm"
          onClick={() => {
            setInput("");
            setJsonInput("");
            setParseError(null);
          }}
          title="Clear all"
        >
          🗑️ Clear All
        </button>
      </div>
    </div>
  );
}
