import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypePrism from "rehype-prism-plus";
// Prism theme (choose one available in prismjs/themes)
import "prismjs/themes/prism-coy.css";
// Prism line numbers plugin CSS
import "prismjs/plugins/line-numbers/prism-line-numbers.css";

/**
 * JsonSafeField
 * A small developer helper component: paste a text (can contain Markdown/code blocks)
 * and get a JSON-valid string value (JSON.stringify output) ready to paste in quiz files.
 *
 * Usage: <JsonSafeField />
 */
export default function JsonSafeField() {
  const [input, setInput] = useState<string>("");

  const jsonValue = useMemo(() => {
    try {
      return JSON.stringify(input);
    } catch {
      return "";
    }
  }, [input]);

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
            <div className="mt-1 p-2 border rounded bg-white max-h-48 overflow-auto">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                // enable prism with line numbers
                rehypePlugins={[[rehypePrism, { showLineNumbers: true }]]}
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
