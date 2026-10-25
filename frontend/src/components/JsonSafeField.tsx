import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { remarkPlugins, rehypePlugins } from "../lib/markdownPlugins";
import "../prism-themes.css";

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
      setParseError('Il testo JSON non è valido');
    }
  };


  const copy = async (text: string, label: string) => {
    try {
      // First try the modern Clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopyStatus({ message: `${label} copiato!`, type: 'success' });
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
          setCopyStatus({ message: `${label} copiato!`, type: 'success' });
        } else {
          throw new Error('execCommand failed');
        }
      }

      // Clear the status after 3 seconds
      setTimeout(() => setCopyStatus(null), 3000);
    } catch (error) {
      console.error("Copy failed:", error);
      setCopyStatus({
        message: `Copia di ${label.toLowerCase()} non riuscita: selezionalo e copialo a mano.`,
        type: 'error'
      });

      // Clear error after 5 seconds
      setTimeout(() => setCopyStatus(null), 5000);
    }
  };

  return (
    <div className="p-4 bg-surface-container border border-outline-variant/20 rounded-xl">
      <h3 className="font-semibold mb-2 text-on-surface">Da testo a stringa JSON, e viceversa</h3>
      <p className="text-sm text-on-surface-variant mb-3">
        Scrivi a sinistra il testo così come vuoi che appaia: a capo, virgolette, blocchi di codice e formule
        LaTeX (<code>{'$\\frac{1}{2}$'}</code> nel testo, <code>$$…$$</code> su una riga a sé), con le barre rovesciate scritte una volta sola.
        A destra trovi la stringa JSON da incollare nel campo "text" o in un'opzione, con a capo e barre già
        convertite (<code>\n</code>, <code>\\frac</code>); oppure incolla una stringa JSON per rileggerla come testo.
        Le due parti si aggiornano a vicenda.
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
          <label className="block text-xs font-medium text-on-surface-variant">Testo (Markdown, blocchi di codice, formule LaTeX)</label>
          <textarea
            className="w-full border border-outline-variant/20 rounded-lg bg-surface-container-low text-on-surface p-2 mt-1 mb-3 font-mono text-sm focus:outline-none focus:border-primary/50 placeholder-outline-variant"
            rows={8}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"Scrivi o incolla qui la domanda, per esempio:\n\nQuanto vale $\\frac{1}{2} + \\frac{1}{4}$?\n\n```python\nprint(1/2 + 1/4)\n```"}
          />
          <div className="mt-2">
            <label className="block text-xs font-medium text-on-surface-variant">Anteprima</label>
            <div
              className="mt-1 p-3 border border-outline-variant/20 rounded-lg bg-surface-container-low max-h-48 overflow-auto prose prose-sm dark:prose-invert max-w-none"
            >
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
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
              setCopyStatus({ message: 'Modifica uno dei due lati per convertire', type: 'success' });
            }}
            title="Conversione nei due sensi"
          >
            ⇄
          </button>
        </div>

        <div className="flex-1">
          <label className="block text-xs font-medium text-on-surface-variant">Stringa JSON da incollare nel quiz</label>
          <textarea
            className="w-full border border-outline-variant/20 rounded-lg bg-surface-container-low text-on-surface p-2 mt-1 mb-3 font-mono text-sm focus:outline-none focus:border-primary/50 placeholder-outline-variant"
            rows={8}
            value={jsonInput}
            onChange={handleJsonChange}
            placeholder={`Oppure incolla qui una stringa JSON da rileggere come testo...`}
          />
        </div>
      </div>

      <div className="flex justify-between items-center mt-4 gap-2">
        <div className="flex gap-2">
          <button
            className="px-4 py-2 bg-primary text-on-primary font-semibold rounded-lg hover:bg-primary/80 transition-colors text-sm"
            onClick={() => copy(jsonInput, "JSON")}
            title="Copia valore JSON"
          >
            📋 Copia JSON
          </button>
          <button
            className="px-4 py-2 bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60 rounded-lg transition-colors text-sm"
            onClick={() => copy(input, "Testo")}
            title="Copia il testo"
          >
            📋 Copia testo
          </button>
        </div>
        <button
          className="px-4 py-2 bg-error/10 text-error border border-error/20 rounded-lg hover:bg-error/20 transition-colors text-sm"
          onClick={() => {
            setInput("");
            setJsonInput("");
            setParseError(null);
          }}
          title="Svuota tutto"
        >
          🗑️ Svuota
        </button>
      </div>
    </div>
  );
}
