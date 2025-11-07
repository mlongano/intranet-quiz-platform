import { useState, useMemo, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import Prism from "prismjs";
// Prism theme (choose one available in prismjs/themes)
import "prismjs/themes/prism-coy.css";
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
  const previewRef = useRef<HTMLDivElement>(null);

  const jsonValue = useMemo(() => {
    try {
      return JSON.stringify(input);
    } catch {
      return "";
    }
  }, [input]);

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

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // small visual feedback could be added
    } catch {
      console.error("Copy failed");
      alert("Copy to clipboard failed. Select and copy manually.");
    }
  };

  return (
    <div className="p-4 bg-white rounded shadow">
      <h3 className="font-semibold mb-2">JSON-safe text generator</h3>
      <p className="text-sm text-gray-600 mb-3">Incolla qui la domanda o il blocco di testo (Markdown / code). Verrà generato il valore JSON valido (con escape di newline e virgolette).</p>

      <label className="block text-xs font-medium text-gray-700">Input (raw)</label>
      <textarea
        className="w-full border rounded p-2 mt-1 mb-3 font-mono"
        rows={8}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={`Scrivi o incolla la domanda con blocchi di codice qui...`}
      />

      <div className="flex items-start gap-3">
        <div style={{ flex: 1 }}>
          <label className="block text-xs font-medium text-gray-700">Output (JSON value)</label>
          <textarea
            className="w-full border rounded p-2 mt-1 mb-2 font-mono bg-gray-50"
            rows={8}
            readOnly
            value={jsonValue}
          />
          <div className="mt-2">
            <label className="block text-xs font-medium text-gray-700">Preview (Markdown)</label>
            <div
              ref={previewRef}
              className="mt-1 p-3 border rounded bg-white max-h-48 overflow-auto prose prose-sm max-w-none"
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

        <div className="flex flex-col gap-2">
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded"
            onClick={() => copy(jsonValue)}
            title="Copy JSON value"
          >
            Copy JSON
          </button>
          <button
            className="px-3 py-1 bg-gray-200 rounded"
            onClick={() => copy(input)}
            title="Copy raw"
          >
            Copy raw
          </button>
          <button
            className="px-3 py-1 bg-red-100 rounded text-sm"
            onClick={() => setInput("")}
            title="Clear"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
